import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveModel, defaultModel, provider } from "@/lib/llm";

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.LLM_PROVIDER;
  delete process.env.SCORING_MODEL;
  delete process.env.RESEARCH_MODEL;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("model resolution across a provider switch", () => {
  // The outage: feeds.model pinned "claude-opus-4-8" in the DB and won over
  // SCORING_MODEL, so setting LLM_PROVIDER=deepseek sent a Claude model name to
  // DeepSeek. Every scoring call 400'd, 40 per tick, silently.
  it("ignores a Claude pin once the provider is OpenAI-compatible", () => {
    process.env.LLM_PROVIDER = "deepseek";
    expect(resolveModel("claude-opus-4-8", undefined, "scoring")).toBe("deepseek-v4-pro");
  });

  it("ignores a Claude pin even when SCORING_MODEL is also stale", () => {
    process.env.LLM_PROVIDER = "deepseek";
    expect(resolveModel("claude-opus-4-8", "claude-sonnet-5", "research")).toBe("deepseek-v4-flash");
  });

  it("falls back to a valid env value when only the pin is stale", () => {
    process.env.LLM_PROVIDER = "deepseek";
    expect(resolveModel("claude-opus-4-8", "deepseek-v4-flash", "scoring")).toBe("deepseek-v4-flash");
  });

  it("ignores a DeepSeek pin once the provider is back on Anthropic", () => {
    process.env.LLM_PROVIDER = "anthropic";
    expect(resolveModel("deepseek-v4-pro", undefined, "scoring")).toBe("claude-opus-4-8");
  });

  it("still honours a legitimate same-vendor pin", () => {
    process.env.LLM_PROVIDER = "deepseek";
    expect(resolveModel("deepseek-v4-flash", undefined, "scoring")).toBe("deepseek-v4-flash");
    process.env.LLM_PROVIDER = "anthropic";
    expect(resolveModel("claude-sonnet-5", undefined, "scoring")).toBe("claude-sonnet-5");
  });

  it("passes through an unrecognised name — a self-hosted or custom deployment", () => {
    process.env.LLM_PROVIDER = "openrouter";
    expect(resolveModel("my-finetune-v3", undefined, "scoring")).toBe("my-finetune-v3");
  });

  it("defaults per host, not one guess for every OpenAI-compatible vendor", () => {
    process.env.LLM_PROVIDER = "deepseek";
    expect(defaultModel("scoring")).toBe("deepseek-v4-pro");
    process.env.LLM_PROVIDER = "qwen";
    expect(defaultModel("scoring")).toBe("qwen3-max");
    expect(provider()).toBe("openai-compatible");
  });

  it("demands explicit model names for a host it has no defaults for", () => {
    process.env.LLM_PROVIDER = "groq";
    expect(() => defaultModel("scoring")).toThrow(/set SCORING_MODEL/);
    // ...but an explicit name is enough to work there.
    expect(resolveModel(null, "llama-3.3-70b", "scoring")).toBe("llama-3.3-70b");
  });
});
