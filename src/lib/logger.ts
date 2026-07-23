// Tiny structured logger. Prefixes lines with an ISO instant + scope.
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, scope: string, msg: string, extra?: unknown) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} (${scope}) ${msg}`;
  const args = extra === undefined ? [line] : [line, extra];
  if (level === "error") console.error(...args);
  else if (level === "warn") console.warn(...args);
  else console.log(...args);
}

export function logger(scope: string) {
  return {
    debug: (m: string, e?: unknown) =>
      process.env.DEBUG ? emit("debug", scope, m, e) : undefined,
    info: (m: string, e?: unknown) => emit("info", scope, m, e),
    warn: (m: string, e?: unknown) => emit("warn", scope, m, e),
    error: (m: string, e?: unknown) => emit("error", scope, m, e),
  };
}
