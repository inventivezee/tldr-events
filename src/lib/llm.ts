// LLM client for editorial scoring + speaker-research synthesis (PRD §11).
//
// Two providers, chosen with LLM_PROVIDER:
//   anthropic         — Claude, via the official SDK (default)
//   openai-compatible — anything speaking OpenAI's /chat/completions: DeepSeek,
//                       Qwen (DashScope compatible mode), OpenRouter, Together,
//                       Groq, a local vLLM/Ollama, and OpenAI itself.
//
// The second is deliberately a plain fetch rather than another SDK dependency:
// the request shape is stable across all of those hosts, and the only thing this
// codebase needs from it is one forced tool call.
//
// Structured output is forced via tool_choice on BOTH paths, so callers always
// get a parseable object and never a prose reply that has to be salvaged.
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";

const log = logger("llm");

export type Provider = "anthropic" | "openai-compatible";

export function provider(): Provider {
  const p = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  if (p === "anthropic") return "anthropic";
  // "openai", "deepseek", "qwen", "openrouter" etc. all speak the same protocol;
  // treating them as aliases means switching host is a base-URL change, not a
  // code change.
  return "openai-compatible";
}

/** Base URL for the OpenAI-compatible host. Known providers get a default so a
 *  key and a name are enough to switch. */
export function baseUrl(): string {
  const explicit = process.env.LLM_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const known: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    deepseek: "https://api.deepseek.com/v1",
    qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    dashscope: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    openrouter: "https://openrouter.ai/api/v1",
    together: "https://api.together.xyz/v1",
    groq: "https://api.groq.com/openai/v1",
  };
  const name = (process.env.LLM_PROVIDER || "").toLowerCase();
  const url = known[name];
  if (!url) {
    throw new Error(
      `LLM_PROVIDER='${name}' has no built-in base URL — set LLM_BASE_URL to the host's OpenAI-compatible endpoint.`,
    );
  }
  return url;
}

let _client: Anthropic | null = null;

function client(): Anthropic {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY is not set");
  if (!_client) _client = new Anthropic({ apiKey });
  return _client;
}

export function llmConfigured(): boolean {
  return !!process.env.LLM_API_KEY?.trim();
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// Token-spend accounting for a run (PRD §11.4 "token spend logged per run").
let _in = 0;
let _out = 0;
export function resetUsage() {
  _in = 0;
  _out = 0;
}
export function usage(): { input: number; output: number } {
  return { input: _in, output: _out };
}

export interface StructuredOpts {
  model?: string;
  system?: string;
  user: string;
  tool: ToolDef;
  maxTokens?: number;
}

/**
 * Force the model to emit a single tool call matching `tool.input_schema`, and
 * return the tool input object. Retries once on transient failures.
 */
export async function structuredCall<T = unknown>(opts: StructuredOpts): Promise<T> {
  const model = opts.model || process.env.SCORING_MODEL || defaultModel();
  const maxTokens = opts.maxTokens ?? 1024;

  if (provider() === "openai-compatible") {
    return structuredCallOpenAI<T>(opts, model, maxTokens);
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await client().messages.create({
        model,
        max_tokens: maxTokens,
        // NOTE: `temperature` is intentionally omitted — it is deprecated/rejected
        // by newer models (e.g. claude-opus-4-8). Rely on the model default.
        system: opts.system,
        tools: [
          {
            name: opts.tool.name,
            description: opts.tool.description,
            input_schema: opts.tool.input_schema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: opts.tool.name },
        messages: [{ role: "user", content: opts.user }],
      });

      _in += resp.usage?.input_tokens ?? 0;
      _out += resp.usage?.output_tokens ?? 0;

      // A max_tokens stop means the tool JSON may be truncated → retry, don't
      // accept a half-built object.
      if (resp.stop_reason === "max_tokens") {
        throw new Error("response truncated (max_tokens) — tool call may be incomplete");
      }

      const block = resp.content.find((c) => c.type === "tool_use");
      if (!block || block.type !== "tool_use") {
        throw new Error("model did not return a tool_use block");
      }
      if (!block.input || typeof block.input !== "object") {
        throw new Error("tool_use input was not an object");
      }
      return block.input as T;
    } catch (e) {
      lastErr = e;
      log.warn(`structuredCall attempt ${attempt + 1} failed`, describe(e));
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

/**
 * Sensible default per provider and task, so switching host doesn't also require
 * remembering a model name that doesn't exist there.
 *
 * Research is the cheaper tier on purpose: it summarises a person from search
 * snippets, which is a much easier job than the editorial score.
 */
export function defaultModel(kind: "scoring" | "research" = "scoring"): string {
  if (provider() === "anthropic") {
    return kind === "scoring" ? "claude-opus-4-8" : "claude-sonnet-5";
  }
  return kind === "scoring" ? "deepseek-chat" : "deepseek-chat";
}

/**
 * OpenAI-compatible structured call: one forced function call, arguments parsed
 * as the result.
 *
 * Some hosts ignore a forced tool_choice and answer in prose instead, so the
 * raw content is parsed as a fallback rather than failing the event outright —
 * a smaller/cheaper model is exactly where that happens.
 */
async function structuredCallOpenAI<T>(
  opts: StructuredOpts,
  model: string,
  maxTokens: number,
): Promise<T> {
  const url = `${baseUrl()}/chat/completions`;
  const messages: { role: string; content: string }[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const body = {
    model,
    max_tokens: maxTokens,
    messages,
    tools: [
      {
        type: "function",
        function: {
          name: opts.tool.name,
          description: opts.tool.description,
          parameters: opts.tool.input_schema,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: opts.tool.name } },
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.LLM_API_KEY ?? ""}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) {
        throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string; tool_calls?: { function?: { arguments?: string } }[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      _in += json.usage?.prompt_tokens ?? 0;
      _out += json.usage?.completion_tokens ?? 0;

      const msg = json.choices?.[0]?.message;
      const args = msg?.tool_calls?.[0]?.function?.arguments;
      if (args) return JSON.parse(args) as T;

      const salvaged = parseLooseJson(msg?.content ?? "");
      if (salvaged) return salvaged as T;
      throw new Error("model returned neither a tool call nor parseable JSON");
    } catch (e) {
      lastErr = e;
      log.warn(`structuredCall (openai-compatible) attempt ${attempt + 1} failed`, describe(e));
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

/** Pull a JSON object out of a prose reply, including one fenced in markdown. */
function parseLooseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], trimmed, trimmed.slice(trimmed.indexOf("{"))];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c.trim());
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * What this runtime is actually configured to talk to — safe to return over an
 * authenticated endpoint. Never includes the key itself, only its shape, which
 * is enough to tell "wrong key" from "no key" from "key for the other vendor".
 *
 * This exists because a provider switch fails silently otherwise: the scorer
 * catches per-event errors, so a misconfigured host returns `scored: 0` with a
 * 200 and looks like "nothing to do".
 */
export function configSummary() {
  const key = process.env.LLM_API_KEY?.trim() ?? "";
  let base: string | null = null;
  let baseError: string | null = null;
  if (provider() === "openai-compatible") {
    try {
      base = baseUrl();
    } catch (e) {
      baseError = describe(e);
    }
  }
  return {
    llmProvider: process.env.LLM_PROVIDER || "(unset → anthropic)",
    resolvedProtocol: provider(),
    baseUrl: base,
    baseUrlError: baseError,
    scoringModel: process.env.SCORING_MODEL || defaultModel("scoring"),
    researchModel: process.env.RESEARCH_MODEL || defaultModel("research"),
    apiKey: key
      ? { present: true, prefix: key.slice(0, 6), length: key.length }
      : { present: false },
  };
}

/** One minimal live call, so a broken provider reports its real error instead of
 *  being swallowed into a zero-score run. */
export async function selfTest(): Promise<{ ok: boolean; error?: string; sample?: unknown }> {
  try {
    const sample = await structuredCall({
      system: "You are a connectivity check. Always call the tool.",
      user: "Call the tool with ok=true.",
      maxTokens: 128,
      tool: {
        name: "report",
        description: "Report that the call succeeded.",
        input_schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
      },
    });
    return { ok: true, sample };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}
