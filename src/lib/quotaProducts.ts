import {
  ProviderRateLimit,
  QuotaProduct,
  RateLimitMeter,
  RateLimitProvider,
  ZCodeCredentialStatus,
  ZCodeQuotaRegion,
} from "./types";

type PeriodPresentation = {
  label: string;
  seconds: number;
  inferredWindowDuration?: number;
};

function periodPresentation(meter: RateLimitMeter): PeriodPresentation | null {
  const compact = meter.label.trim().toLowerCase().replace(/\s+/g, "");
  const day = 24 * 60 * 60;
  const aliases: Record<string, PeriodPresentation> = {
    daily: { label: "1d", seconds: day, inferredWindowDuration: day },
    day: { label: "1d", seconds: day, inferredWindowDuration: day },
    weekly: { label: "7d", seconds: 7 * day, inferredWindowDuration: 7 * day },
    week: { label: "7d", seconds: 7 * day, inferredWindowDuration: 7 * day },
    monthly: { label: "Month", seconds: 30 * day },
    month: { label: "Month", seconds: 30 * day },
  };
  const alias = aliases[compact];
  if (alias) {
    return { ...alias, seconds: meter.windowDuration ?? alias.seconds };
  }

  const match = /^(\d+(?:\.\d+)?)(m|h|d|w)$/.exec(compact);
  if (!match) return null;
  const unit = match[2] as "m" | "h" | "d" | "w";
  const multiplier: Record<typeof unit, number> = {
    m: 60,
    h: 3600,
    d: day,
    w: 7 * day,
  };
  const seconds = meter.windowDuration ?? Number(match[1]) * multiplier[unit];
  return {
    label: compact === "1w" ? "7d" : compact,
    seconds,
    inferredWindowDuration: seconds,
  };
}

/** Generic time windows lead from shortest to longest. Provider-specific
 * meters keep their original relative order after those common windows. */
export function canonicalQuotaMeters(meters: RateLimitMeter[]): RateLimitMeter[] {
  return meters
    .map((original, index) => {
      const meter = { ...original };
      const period = periodPresentation(meter);
      if (period) {
        meter.label = period.label;
        if (meter.windowDuration == null && period.inferredWindowDuration != null) {
          meter.windowDuration = period.inferredWindowDuration;
        }
      }
      return { meter, periodSeconds: period?.seconds, index };
    })
    .sort((left, right) => {
      const leftIsPeriod = left.periodSeconds != null;
      const rightIsPeriod = right.periodSeconds != null;
      if (leftIsPeriod !== rightIsPeriod) return leftIsPeriod ? -1 : 1;
      if (left.periodSeconds != null && right.periodSeconds != null &&
          left.periodSeconds !== right.periodSeconds) {
        return left.periodSeconds - right.periodSeconds;
      }
      return left.index - right.index;
    })
    .map(({ meter }) => meter);
}

export function providerLabel(provider: RateLimitProvider, products: QuotaProduct[]): string {
  return products.find((product) => product.provider === provider)?.displayName ?? provider;
}

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

/**
 * Settings rows show the one fact the row can act on instead of the full
 * selector status line. Mirrors SettingsView.compactQuotaStatus: wording this
 * map does not recognize passes through untouched instead of being invented.
 */
export function compactQuotaStatus(status: string): string {
  if (status.includes("已配置")) return "已配置";
  if (status.includes("需配置") || status.includes("未检测到")) return "待配置";
  return status;
}

/**
 * Status line for an enabled product whose card has no meters to draw. Only
 * ever states what the data channel actually reported: the live Codex
 * endpoint's own verdict (`emptyReason`), local detection, or — when neither
 * exists — that nothing has been read yet. Never invents 「已用满」 for a source
 * that cannot tell, and never says 「未检测到」 while a refresh is still in flight.
 */
export function quotaEmptyStateText(
  snapshot: ProviderRateLimit,
  isDetected: boolean,
  isRefreshing = false,
): string {
  if (isRefreshing) return "正在读取订阅配额…";
  switch (snapshot.emptyReason) {
    case "limitReached":
      return "本期订阅配额已用满 · 等待额度重置";
    case "noWindow":
      return "当前没有生效的额度窗口";
    default:
      return isDetected ? "暂未读取到订阅配额数据" : "未检测到本机安装或登录";
  }
}
