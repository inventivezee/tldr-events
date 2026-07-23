// LLM client for editorial scoring + speaker-research synthesis (PRD §11).
// Anthropic is implemented for Phase 1 (LLM_PROVIDER=anthropic). Structured
// output is forced via tool_choice so we always get parseable JSON.
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";

const log = logger("llm");

let _client: Anthropic | null = null;

function client(): Anthropic {
  const provider = process.env.LLM_PROVIDER || "anthropic";
  if (provider !== "anthropic") {
    throw new Error(
      `LLM_PROVIDER='${provider}' is not implemented in Phase 1. Set LLM_PROVIDER=anthropic.`,
    );
  }
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY is not set");
  if (!_client) _client = new Anthropic({ apiKey });
  return _client;
}

export function llmConfigured(): boolean {
  return (
    (process.env.LLM_PROVIDER || "anthropic") === "anthropic" &&
    !!process.env.LLM_API_KEY?.trim()
  );
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
  temperature?: number;
}

/**
 * Force the model to emit a single tool call matching `tool.input_schema`, and
 * return the tool input object. Retries once on transient failures.
 */
export async function structuredCall<T = unknown>(opts: StructuredOpts): Promise<T> {
  const model = opts.model || process.env.SCORING_MODEL || "claude-opus-4-8";
  const maxTokens = opts.maxTokens ?? 1024;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await client().messages.create({
        model,
        max_tokens: maxTokens,
        temperature: opts.temperature ?? 0.2,
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

      const block = resp.content.find((c) => c.type === "tool_use");
      if (!block || block.type !== "tool_use") {
        throw new Error("model did not return a tool_use block");
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

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
