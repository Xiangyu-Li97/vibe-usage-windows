// Human-readable messages for Tauri invoke rejections (and similar thrown values).
// `String(err)` becomes "[object Object]" for IPC error payloads.

export function formatInvokeError(err: unknown): string {
  if (err == null) return "未知错误";
  if (typeof err === "string") {
    const trimmed = err.trim();
    return trimmed || "未知错误";
  }
  if (err instanceof Error && err.message.trim()) return err.message;

  if (typeof err === "object") {
    const rec = err as Record<string, unknown>;
    for (const key of ["message", "error", "msg"] as const) {
      const value = rec[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}" && json !== "[]" && json !== "null") return json;
    } catch {
      // ignore circular / unserializable payloads
    }
  }

  const fallback = String(err);
  return fallback === "[object Object]" ? "未知错误" : fallback;
}
