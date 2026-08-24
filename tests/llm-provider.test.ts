import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";

let server: Server | undefined;
const saved = { ...process.env };

beforeEach(() => {
  process.env.LLM_API_KEY = "test-key";
});
afterEach(() => {
  server?.close();
  process.env = { ...saved };
});

/** Stand in for DeepSeek/Qwen/OpenRouter: same /chat/completions contract. */
async function mockProvider(handler: (body: any) => { status?: number; json: unknown }) {
  let seen: any = null;
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen = JSON.parse(raw || "{}");
      const { status = 200, json } = handler(seen);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server!.listen(0, r));
  const port = (server!.address() as { port: number }).port;
  process.env.LLM_PROVIDER = "deepseek";
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  return { seen: () => seen };
}

const TOOL = {
  name: "record_score",
  description: "score it",
  input_schema: { type: "object", properties: { score: { type: "number" } } },
};

const toolReply = (args: unknown) => ({
  json: {
    choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }],
    usage: { prompt_tokens: 120, completion_tokens: 30 },
  },
});

describe("OpenAI-compatible provider (DeepSeek / Qwen / OpenRouter)", () => {
  it("sends a forced function call and returns its arguments", async () => {
    const { seen } = await mockProvider(() => toolReply({ score: 7.5, tldr: "ok" }));
    const { structuredCall, resetUsage, usage } = await import("@/lib/llm");
    resetUsage();

    const out = await structuredCall({ user: "hi", system: "sys", tool: TOOL, model: "deepseek-chat" });
    expect(out).toEqual({ score: 7.5, tldr: "ok" });

    // The request must actually pin the tool, or a cheap model will chat instead.
    const body = seen();
    expect(body.model).toBe("deepseek-chat");
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "record_score" } });
    expect(body.tools[0].function.parameters).toEqual(TOOL.input_schema);
    expect(body.messages.map((m: any) => m.role)).toEqual(["system", "user"]);
    // Token accounting has to keep working, or spend becomes invisible.
    expect(usage()).toEqual({ input: 120, output: 30 });
  });

  it("salvages a model that answers in prose instead of calling the tool", async () => {
    // Smaller/cheaper models do this; losing the event over it would be worse.
    await mockProvider(() => ({
      json: { choices: [{ message: { content: 'Sure!\n```json\n{"score": 6.1}\n```' } }] },
    }));
    const { structuredCall } = await import("@/lib/llm");
    await expect(structuredCall({ user: "hi", tool: TOOL })).resolves.toEqual({ score: 6.1 });
  });

  it("surfaces an API error rather than returning a half-built object", async () => {
    await mockProvider(() => ({ status: 402, json: { error: "insufficient balance" } }));
    const { structuredCall } = await import("@/lib/llm");
    await expect(structuredCall({ user: "hi", tool: TOOL })).rejects.toThrow(/402/);
  }, 20000);

  it("knows the well-known hosts, and demands a base URL for anything else", async () => {
    const { baseUrl, provider } = await import("@/lib/llm");
    process.env.LLM_BASE_URL = "";
    for (const [name, expected] of [
      ["deepseek", "https://api.deepseek.com/v1"],
      ["qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"],
      ["openrouter", "https://openrouter.ai/api/v1"],
    ] as const) {
      process.env.LLM_PROVIDER = name;
      expect(provider()).toBe("openai-compatible");
      expect(baseUrl()).toBe(expected);
    }
    process.env.LLM_PROVIDER = "some-new-host";
    expect(() => baseUrl()).toThrow(/LLM_BASE_URL/);
  });

  it("still treats anthropic as the default provider", async () => {
    delete process.env.LLM_PROVIDER;
    const { provider } = await import("@/lib/llm");
    expect(provider()).toBe("anthropic");
  });
});

describe("reasoning models that refuse a forced tool call", () => {
  // DeepSeek's v4-pro answers a forced tool_choice with
  // 400 "Thinking mode does not support this tool_choice". Forcing stays the
  // default (it is what guarantees a parseable object on ordinary models), so
  // the client has to notice the refusal and drop to tool_choice=auto rather
  // than failing every event — which is exactly what it did on 2026-08-23.
  const THINKING_400 = {
    status: 400,
    json: {
      error: {
        message: "Thinking mode does not support this tool_choice",
        type: "invalid_request_error",
      },
    },
  };

  it("retries unforced and still returns the object", async () => {
    const bodies: any[] = [];
    const { seen } = await mockProvider((body) => {
      bodies.push(body);
      if (body.tool_choice && body.tool_choice !== "auto") return THINKING_400;
      return toolReply({ score: 8.1 });
    });
    const { structuredCall } = await import("@/lib/llm");

    const out = await structuredCall({ user: "hi", tool: TOOL, model: "deepseek-v4-pro" });
    expect(out).toEqual({ score: 8.1 });

    expect(bodies).toHaveLength(2);
    expect(bodies[0].tool_choice).toEqual({ type: "function", function: { name: "record_score" } });
    expect(bodies[1].tool_choice).toBe("auto");
    expect(seen().model).toBe("deepseek-v4-pro");
  });

  it("gives the retry more room, since thinking spends tokens before the answer", async () => {
    const bodies: any[] = [];
    await mockProvider((body) => {
      bodies.push(body);
      if (body.tool_choice && body.tool_choice !== "auto") return THINKING_400;
      return toolReply({ score: 6 });
    });
    const { structuredCall } = await import("@/lib/llm");
    await structuredCall({ user: "hi", tool: TOOL, model: "deepseek-v4-pro", maxTokens: 900 });

    expect(bodies[0].max_tokens).toBe(900);
    expect(bodies[1].max_tokens).toBeGreaterThan(900);
  });

  it("salvages JSON from content when the unforced model answers in prose", async () => {
    await mockProvider((body) => {
      if (body.tool_choice && body.tool_choice !== "auto") return THINKING_400;
      return {
        json: {
          choices: [{ message: { content: '```json\n{"score": 5.5}\n```' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
      };
    });
    const { structuredCall } = await import("@/lib/llm");
    expect(await structuredCall({ user: "hi", tool: TOOL, model: "deepseek-v4-pro" })).toEqual({
      score: 5.5,
    });
  });

  it("reads the answer out of reasoning_content when a host puts it there", async () => {
    await mockProvider((body) => {
      if (body.tool_choice && body.tool_choice !== "auto") return THINKING_400;
      return {
        json: {
          choices: [{ message: { content: "", reasoning_content: '{"score": 9.1}' } }],
          usage: {},
        },
      };
    });
    const { structuredCall } = await import("@/lib/llm");
    expect(await structuredCall({ user: "hi", tool: TOOL, model: "deepseek-v4-pro" })).toEqual({
      score: 9.1,
    });
  });

  it("does not swallow an unrelated 400", async () => {
    await mockProvider(() => ({
      status: 400,
      json: { error: { message: "Insufficient Balance", type: "invalid_request_error" } },
    }));
    const { structuredCall } = await import("@/lib/llm");
    await expect(
      structuredCall({ user: "hi", tool: TOOL, model: "deepseek-v4-pro" }),
    ).rejects.toThrow(/Insufficient Balance/);
  });
});

describe("json_object mode requirements", () => {
  const THINKING_400 = {
    status: 400,
    json: { error: { message: "Thinking mode does not support this tool_choice" } },
  };

  it("names JSON and the schema in the unforced prompt", async () => {
    // DeepSeek refuses response_format:json_object unless the word "json"
    // appears in the messages: 400 "Prompt must contain the word 'json'".
    const bodies: any[] = [];
    await mockProvider((body) => {
      bodies.push(body);
      if (body.tool_choice && body.tool_choice !== "auto") return THINKING_400;
      return toolReply({ score: 7 });
    });
    const { structuredCall } = await import("@/lib/llm");
    await structuredCall({ user: "rate it", tool: TOOL, model: "deepseek-v4-pro" });

    const forced = bodies[0].messages.at(-1).content;
    const unforced = bodies[1].messages.at(-1).content;
    expect(forced).toBe("rate it"); // forced mode leaves the prompt alone
    expect(unforced).toMatch(/json/i);
    expect(unforced).toContain("record_score");
    expect(bodies[1].response_format).toEqual({ type: "json_object" });
  });

  it("drops response_format for a host that does not implement it", async () => {
    const bodies: any[] = [];
    await mockProvider((body) => {
      bodies.push(body);
      if (body.tool_choice && body.tool_choice !== "auto") return THINKING_400;
      if (body.response_format)
        return { status: 400, json: { error: { message: "response_format is not supported" } } };
      return toolReply({ score: 4.2 });
    });
    const { structuredCall } = await import("@/lib/llm");
    expect(await structuredCall({ user: "hi", tool: TOOL, model: "some-model" })).toEqual({
      score: 4.2,
    });
    expect(bodies).toHaveLength(3);
    expect(bodies[2].response_format).toBeUndefined();
    // The prompt still carries the instruction, so the object is still asked for.
    expect(bodies[2].messages.at(-1).content).toMatch(/json/i);
  });
});

