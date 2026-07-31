import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { getJson } from "@/ingestion/luma-detail";

let server: Server | undefined;
afterEach(() => server?.close());

/** Spin up a server that fails `failures` times with `status`, then succeeds. */
async function flaky(status: number, failures: number, headers: Record<string, string> = {}) {
  let hits = 0;
  server = createServer((_req, res) => {
    hits++;
    if (hits <= failures) {
      res.writeHead(status, headers);
      res.end("nope");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => server!.listen(0, r));
  const port = (server!.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/x`, hits: () => hits };
}

describe("Luma API rate-limit handling", () => {
  it("recovers a 429 within the same run rather than losing the data", async () => {
    const { url, hits } = await flaky(429, 2, { "retry-after": "1" });
    await expect(getJson(url)).resolves.toEqual({ ok: true });
    expect(hits()).toBe(3); // two refusals, then the real answer
  }, 20000);

  it("retries transient server errors too", async () => {
    const { url, hits } = await flaky(503, 1);
    await expect(getJson(url)).resolves.toEqual({ ok: true });
    expect(hits()).toBe(2);
  }, 20000);

  it("does not retry a client error that will never succeed", async () => {
    const { url, hits } = await flaky(404, 5);
    await expect(getJson(url)).rejects.toThrow(/404/);
    expect(hits()).toBe(1);
  }, 20000);

  it("gives up after the attempt cap instead of hammering forever", async () => {
    const { url, hits } = await flaky(429, 99, { "retry-after": "1" });
    await expect(getJson(url)).rejects.toThrow(/429/);
    expect(hits()).toBe(4); // LUMA_MAX_ATTEMPTS
  }, 40000);
});
