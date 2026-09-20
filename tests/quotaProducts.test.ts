import { describe, expect, it } from "vitest";
import {
  canonicalQuotaMeters,
  compactQuotaStatus,
  isZCodeConfigured,
  quotaEmptyStateText,
  quotaProductStatusText,
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

  it("shortens a settings row to the one fact it can act on", () => {
    expect(compactQuotaStatus("未检测到 · API Key 已配置 · 未读取")).toBe("已配置");
    expect(compactQuotaStatus("已检测 · 需配置 API Key")).toBe("待配置");
    expect(compactQuotaStatus("未检测到 · 需配置 API Key")).toBe("待配置");
    expect(compactQuotaStatus("已检测 · 待接入")).toBe("已检测 · 待接入");
  });
});

describe("quota meter layout", () => {
  it("puts generic periods first from shortest to longest", () => {
    const ordered = canonicalQuotaMeters([
      { id: "mcp", label: "MCP", utilization: 4, windowDuration: 30 * 86_400 },
      { id: "weekly", label: "Weekly", utilization: 30 },
      { id: "sonnet", label: "Sonnet", utilization: 40, windowDuration: 7 * 86_400 },
      { id: "five-hour", label: "5h", utilization: 10, windowDuration: 5 * 3_600 },
      { id: "extra", label: "额外", utilization: 50 },
    ]);

    expect(ordered.map((meter) => meter.label)).toEqual([
      "5h", "7d", "MCP", "Sonnet", "额外",
    ]);
    expect(ordered[1].windowDuration).toBe(7 * 86_400);
  });
});

describe("empty quota card copy", () => {
  const noData = (extra: Partial<ProviderRateLimit>): ProviderRateLimit => ({
    provider: "codex",
    status: { kind: "noData" },
    ...extra,
  });

  it("says a refresh is in flight instead of reporting a verdict", () => {
    expect(quotaEmptyStateText(noData({ emptyReason: "limitReached" }), false, true)).toBe(
      "正在读取订阅配额…",
    );
  });

  it("repeats the live source's own verdict when it reported one", () => {
    expect(quotaEmptyStateText(noData({ emptyReason: "limitReached" }), true)).toBe(
      "本期订阅配额已用满 · 等待额度重置",
    );
    expect(quotaEmptyStateText(noData({ emptyReason: "noWindow" }), true)).toBe(
      "当前没有生效的额度窗口",
    );
  });

  it("never borrows 「已用满」 for a source that cannot tell", () => {
    for (const snapshot of [noData({}), noData({ emptyReason: null })]) {
      expect(quotaEmptyStateText(snapshot, true)).toBe("暂未读取到订阅配额数据");
      expect(quotaEmptyStateText(snapshot, false)).toBe("未检测到本机安装或登录");
      expect(quotaEmptyStateText(snapshot, true)).not.toContain("已用满");
    }
  });

  it("separates a detected product from one that is not installed", () => {
    const product: ProviderRateLimit = { provider: "grok", status: { kind: "noData" } };
    expect(quotaEmptyStateText(product, true)).toBe("暂未读取到订阅配额数据");
    expect(quotaEmptyStateText(product, false)).toBe("未检测到本机安装或登录");
  });
});
