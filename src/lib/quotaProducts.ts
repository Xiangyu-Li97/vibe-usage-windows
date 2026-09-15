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
  snapshot?: ProviderRateLimit,
): string {
  const detected = product.isDetected ? "已检测" : "未检测到";
  if (product.provider === "zcode" && product.availability === "ready" && zCodeStatus) {
    const configured = isZCodeConfigured(zCodeStatus, zCodeRegion);
    if (!configured) return `${detected} · 需配置 API Key`;
  }
  if (product.availability === "pendingProtocol") {
    return product.isDetected ? "已检测 · 待接入" : "待接入";
  }
  // Never-requested products and another provider's snapshot are not no-data.
  const result = snapshot?.provider === product.provider ? snapshot : undefined;
  const reading = result ? {
    ok: "读取成功",
    noData: "无数据",
    disabled: "未启用",
    unauthorized: "需重新登录",
    retryableError: "读取失败 · 可重试",
    error: "读取失败",
  }[result.status.kind] : "未读取";
  const configured = product.provider === "zcode" && zCodeStatus && isZCodeConfigured(zCodeStatus, zCodeRegion);
  return `${detected}${configured ? " · API Key 已配置" : ""} · ${reading}`;
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
