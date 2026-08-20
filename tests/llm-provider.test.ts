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
