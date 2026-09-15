import { describe, expect, it } from "vitest";
import {
  isZCodeConfigured,
  quotaProductStatusText,
  visibleQuotaProviders,
} from "../src/lib/quotaProducts";
import { ProviderRateLimit, QuotaProduct } from "../src/lib/types";

describe("quota product presentation", () => {
  const grok: QuotaProduct = { provider: "grok", displayName: "Grok", availability: "ready", isDetected: true };

  it("distinguishes a discovered unread product from a known no-data result", () => {
    expect(quotaProductStatusText(grok)).toBe("已检测 · 未读取");
    expect(quotaProductStatusText(grok, undefined, "bigModel", { provider: "grok", status: { kind: "noData" } })).toBe("已检测 · 无数据");
  });

  it.each([
    ["ok", "读取成功"], ["disabled", "未启用"], ["unauthorized", "需重新登录"],
    ["retryableError", "读取失败 · 可重试"], ["error", "读取失败"],
  ] as const)("shows %s independently from discovery", (kind, label) => {
    const status = kind === "error" ? { kind, message: "must not be displayed" } : { kind };
    expect(quotaProductStatusText(grok, undefined, "bigModel", { provider: "grok", status })).toBe(`已检测 · ${label}`);
  });

  it("does not borrow another card's status", () => {
    expect(quotaProductStatusText(grok, undefined, "bigModel", { provider: "codex", status: { kind: "noData" } })).toBe("已检测 · 未读取");
  });

  it("separates regional credentials from discovery", () => {
    const product: QuotaProduct = { provider: "zcode", displayName: "ZCode", availability: "ready", isDetected: false };
    const credentials = { bigModelConfigured: true, zAiConfigured: false };
    expect(quotaProductStatusText(product, credentials, "zAI")).toBe("未检测到 · 需配置 API Key");
    expect(quotaProductStatusText(product, credentials, "bigModel")).toBe("未检测到 · API Key 已配置 · 未读取");
  });

  it("keeps pending protocol distinct from a disabled snapshot", () => {
    expect(quotaProductStatusText({ ...grok, provider: "cursor", availability: "pendingProtocol" }, undefined, "bigModel", { provider: "cursor", status: { kind: "disabled" } })).toBe("已检测 · 待接入");
  });

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
      displayName: "Cursor",
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
