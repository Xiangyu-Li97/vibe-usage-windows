import { describe, expect, it } from "vitest";
import {
  isZCodeConfigured,
  quotaProductStatusText,
  visibleQuotaProviders,
} from "../src/lib/quotaProducts";
import { ProviderRateLimit, QuotaProduct } from "../src/lib/types";

describe("quota product presentation", () => {
  it("keeps an explicitly selected Cursor visible while its protocol is pending", () => {
    expect(visibleQuotaProviders(["cursor"], [], false)).toEqual(["cursor"]);
  });

  it("keeps both selected slots in their persisted order once one is actionable", () => {
    const snapshots: ProviderRateLimit[] = [
      { provider: "grok", status: { kind: "retryableError" } },
    ];
    expect(visibleQuotaProviders(["kimi-code", "grok"], snapshots, false)).toEqual([
      "kimi-code",
      "grok",
    ]);
  });

  it("collapses selected products when every result is ordinary no-data", () => {
    const snapshots: ProviderRateLimit[] = [
      { provider: "kimi-code", status: { kind: "noData" } },
      { provider: "grok", status: { kind: "noData" } },
    ];
    expect(visibleQuotaProviders(["kimi-code", "grok"], snapshots, false)).toEqual([]);
  });

  it("describes discovery separately from protocol readiness", () => {
    const pending: QuotaProduct = {
      provider: "cursor",
      availability: "pendingProtocol",
      isDetected: true,
    };
    expect(quotaProductStatusText(pending)).toBe("已检测 · 待接入");
  });

  it("tracks ZCode regional credentials independently", () => {
    const status = { bigModelConfigured: true, zAiConfigured: false };
    expect(isZCodeConfigured(status, "bigModel")).toBe(true);
    expect(isZCodeConfigured(status, "zAI")).toBe(false);
  });
});
