import {
  ProviderRateLimit,
  QuotaProduct,
  RateLimitProvider,
  ZCodeCredentialStatus,
  ZCodeQuotaRegion,
} from "./types";

export const MAX_QUOTA_SELECTION = 2;

export const PROVIDER_LABELS: Record<RateLimitProvider, string> = {
  codex: "Codex",
  claudeCode: "Claude",
  "kimi-code": "Kimi Code",
  zcode: "ZCode",
  grok: "Grok",
  cursor: "Cursor",
};

export function isZCodeConfigured(
  status: ZCodeCredentialStatus,
  region: ZCodeQuotaRegion,
): boolean {
  return region === "bigModel" ? status.bigModelConfigured : status.zAiConfigured;
}

export function quotaProductStatusText(
  product: QuotaProduct,
  zCodeStatus?: ZCodeCredentialStatus,
  zCodeRegion: ZCodeQuotaRegion = "bigModel",
): string {
  if (product.provider === "zcode" && product.availability === "ready" && zCodeStatus) {
    const configured = isZCodeConfigured(zCodeStatus, zCodeRegion);
    if (!product.isDetected) return configured ? "未检测到 · API Key 已配置" : "未检测到";
    return configured ? "已检测 · API Key 已配置" : "需配置 API Key";
  }
  if (product.availability === "pendingProtocol") {
    return product.isDetected ? "已检测 · 待接入" : "待接入";
  }
  return product.isDetected ? "已检测" : "未检测到";
}

/** Keep selection order stable. All selected cards appear once one has an
 * actionable state; an explicitly selected Cursor is itself actionable. */
export function visibleQuotaProviders(
  selected: RateLimitProvider[],
  snapshots: ProviderRateLimit[],
  refreshing: boolean,
): RateLimitProvider[] {
  const hasContent = selected.some((provider) => {
    if (provider === "cursor" || refreshing) return true;
    return (
      (snapshots.find((snapshot) => snapshot.provider === provider)?.status.kind ?? "noData") !==
      "noData"
    );
  });
  return hasContent ? selected : [];
}
