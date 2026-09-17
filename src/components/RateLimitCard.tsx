// Subscription quota selector and provider-neutral cards.

import { useState } from "react";
import { Check, ChevronDown, Info, RefreshCw } from "lucide-react";
import { AppStateValue, useAppState } from "../state/AppStateContext";
import {
  ProviderRateLimit,
  RateLimitMeter,
  RateLimitProvider,
  RateLimitWindow,
} from "../lib/types";
import {
  providerLabel,
  quotaEmptyStateText,
  quotaProductStatusText,
} from "../lib/quotaProducts";
import { elapsedPercent, utilizationColor } from "../lib/aggregate";
import { formatPercent, formatTimeUntil } from "../lib/formatters";
import { ProviderIcon } from "./ProviderIcon";

/**
 * Fixed card width. Two cards plus the 8 px gap fill the panel's content box
 * exactly ((520 − 2×16 padding − 8) / 2), so the familiar two-card row is
 * unchanged; a third product scrolls instead of squeezing every card narrower
 * than its meters and labels can render.
 */
const CARD_WIDTH = 240;

export function RateLimitCards() {
  const state = useAppState();
  const selected = state.settings.selectedQuotaProductIds;

  const snapshot = (provider: RateLimitProvider): ProviderRateLimit =>
    state.rateLimits.find((item) => item.provider === provider) ?? {
      provider,
      status: { kind: provider === "cursor" ? "disabled" : "noData" },
    };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold" style={{ color: "#B8B8B8" }}>
          订阅配额
        </span>
        <div className="grow" />
        <ProductSelector />
      </div>

      {/* One card per enabled product, in selection order, inside a horizontal
          scroller. An enabled product must always show its own state: a
          collapsed section reads as "this feature is off" precisely when the
          user wants to know why nothing is shown. */}
      {selected.length === 0 ? (
        <NoticeBar />
      ) : (
        <div className="no-scrollbar flex items-stretch gap-2 overflow-x-auto">
          {selected.map((provider) => (
            <div key={provider} className="shrink-0" style={{ width: CARD_WIDTH }}>
              <ProviderCard snapshot={snapshot(provider)} />
            </div>
          ))}
        </div>
      )}

      {state.quotaSelectionError && (
        <div className="text-[11px] text-red-400">{state.quotaSelectionError}</div>
      )}
    </section>
  );
}

function ProductSelector() {
  const state = useAppState();
  const [open, setOpen] = useState(false);
  const selected = state.settings.selectedQuotaProductIds;

  return (
    <div className="relative z-50">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1 rounded px-2 py-1 text-[10.5px] font-medium"
        style={{ color: "#B8B8B8", background: "#1C1C1C", border: "1px solid #333333" }}
        onClick={() => setOpen((value) => !value)}
      >
        选择 {selected.length}
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+5px)] w-[238px] overflow-hidden rounded-md border border-white/15 bg-[#202022] py-1 shadow-xl"
        >
          {state.quotaProducts.map((product) => {
            const checked = selected.includes(product.provider);
            return (
              <button
                key={product.provider}
                role="menuitemcheckbox"
                aria-checked={checked}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-white/10"
                onClick={() => {
                  setOpen(false);
                  void state.setQuotaProductSelected(product.provider, !checked);
                }}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/20">
                  {checked && <Check size={11} color="#34C759" strokeWidth={3} />}
                </span>
                <span className="min-w-0 grow">
                  <span className="block text-xs text-white">{product.displayName}</span>
                  <span className="block truncate text-[10px] text-neutral-500">
                    {quotaProductStatusText(
                      product,
                      state.zCodeCredentialStatus,
                      state.settings.zCodeQuotaRegion,
                      state.rateLimits.find((snapshot) => snapshot.provider === product.provider),
                    )}
                  </span>
                </span>
              </button>
            );
          })}
          <div className="my-1 h-px bg-white/10" />
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] text-neutral-300 hover:bg-white/10"
            onClick={() => {
              setOpen(false);
              void state.rediscoverQuotaProducts();
            }}
          >
            <RefreshCw size={12} />
            重新检测本机产品
          </button>
        </div>
      )}
    </div>
  );
}

function NoticeBar() {
  return (
    <div className="flex items-center gap-1.5" style={{ color: "#666666" }}>
      <Info size={10} />
      <span className="text-[11px]">自动识别本机产品；请选择要显示的产品</span>
    </div>
  );
}

const ROW_HEIGHT = 16;
const ROW_SPACING = 6;

type RowItem =
  | { kind: "live"; label: string; window: RateLimitWindow }
  | { kind: "placeholder"; label: string; message: string };

function meterWindow(meter: RateLimitMeter): RateLimitWindow {
  return {
    utilization: meter.utilization,
    resetsAt: meter.resetsAt,
    windowDuration: meter.windowDuration,
  };
}

function ProviderCard({ snapshot }: { snapshot: ProviderRateLimit }) {
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const state = useAppState();
  const plan = snapshot.planLabel?.toLowerCase();
  const expectsFiveHour =
    snapshot.provider === "codex" &&
    (plan === "plus" || plan === "pro" || plan === "prolite" || plan === "business");

  const rows: RowItem[] = (snapshot.meters ?? []).map((meter) => ({
    kind: "live",
    label: meter.label,
    window: meterWindow(meter),
  }));
  if (rows.length === 0) {
    if (snapshot.fiveHour) {
      rows.push({ kind: "live", label: "5h", window: snapshot.fiveHour });
    } else if (expectsFiveHour) {
      rows.push({
        kind: "placeholder",
        label: "5h",
        message: snapshot.fiveHourNotEnforced ? "官方当前未启用" : "近 5 小时无活动",
      });
    }
    if (snapshot.sevenDay) rows.push({ kind: "live", label: "7d", window: snapshot.sevenDay });
  }
  const visibleRows = rows.slice(0, 2);
  const extraMeterCount = Math.max(0, rows.length - visibleRows.length);

  return (
    <div className="flex h-full min-w-0 flex-col gap-2.5 rounded-card border border-card-border bg-card px-3 py-[11px]">
      <div className="flex items-center gap-1.5">
        <ProviderIcon provider={snapshot.provider} />
        <span className="truncate text-[13px] font-semibold text-white">
          {providerLabel(snapshot.provider, state.quotaProducts)}
        </span>
        <div className="grow" />
        {state.isRefreshingRateLimits && <div className="spinner h-3 w-3 shrink-0" />}
        {snapshot.planLabel && (
          <span
            className="max-w-[80px] truncate rounded-full px-[7px] py-0.5 text-[10px] font-medium"
            style={{ background: "rgba(255,255,255,0.16)", color: "#8C8C8C" }}
          >
            {snapshot.planLabel}
          </span>
        )}
      </div>

      {snapshot.status.kind === "ok" && (
        <QuotaRows
          rows={visibleRows}
          hoveredLabel={hoveredLabel}
          setHoveredLabel={setHoveredLabel}
        />
      )}
      {snapshot.status.kind === "disabled" && snapshot.provider !== "cursor" && (
        <MessageContent text="订阅配额未启用" />
      )}
      {(snapshot.status.kind === "noData" ||
        (snapshot.status.kind === "disabled" && snapshot.provider === "cursor")) && (
        <QuietText text={emptyStateText(snapshot, state)} />
      )}
      {snapshot.status.kind === "unauthorized" && (
        <MessageContent text={unauthorizedText(snapshot.provider, state.settings.zCodeQuotaRegion, providerLabel(snapshot.provider, state.quotaProducts))} />
      )}
      {snapshot.status.kind === "retryableError" && (
        <MessageContent text="暂时无法读取订阅配额" />
      )}
      {snapshot.status.kind === "error" && <MessageContent text={snapshot.status.message} />}
      {snapshot.status.kind === "ok" && (
        <FreshnessNote snapshot={snapshot} additionalMeterCount={extraMeterCount} />
      )}
    </div>
  );
}

function unauthorizedText(provider: RateLimitProvider, region: "bigModel" | "zAI", label: string): string {
  if (provider === "zcode") {
    return `请在设置中配置 ${region === "bigModel" ? "BigModel" : "Z.ai"} API Key`;
  }
  if (provider === "kimi-code") return "请重新登录 Kimi Code 后重试";
  return `请打开 ${label} 使用一次后重试`;
}

/** Local discovery result only — never a credential or network read. It
 *  separates "installed but nothing to show yet" from "not on this machine". */
function emptyStateText(snapshot: ProviderRateLimit, state: AppStateValue): string {
  if (state.isRefreshingRateLimits) return "正在读取订阅配额…";
  if (snapshot.provider === "cursor") {
    const detected = state.quotaProducts.find((item) => item.provider === "cursor")?.isDetected;
    return detected
      ? "已识别 Cursor · 等待官方配额接口"
      : "未检测到 Cursor · 等待官方配额接口";
  }
  const detected =
    state.quotaProducts.find((item) => item.provider === snapshot.provider)?.isDetected === true;
  return quotaEmptyStateText(snapshot, detected);
}

function QuietText({ text }: { text: string }) {
  return <span className="text-[11px] leading-snug text-neutral-500">{text}</span>;
}

function QuotaRows({
  rows,
  hoveredLabel,
  setHoveredLabel,
}: {
  rows: RowItem[];
  hoveredLabel: string | null;
  setHoveredLabel: (label: string | null) => void;
}) {
  const hoveredIndex = rows.findIndex((row) => row.label === hoveredLabel);
  const hoveredRow = hoveredIndex >= 0 ? rows[hoveredIndex] : null;
  const hoveredWindow = hoveredRow?.kind === "live" ? hoveredRow.window : null;

  return (
    <div className="relative flex flex-col" style={{ gap: ROW_SPACING }}>
      {rows.map((row, index) =>
        row.kind === "live" ? (
          <QuotaRow
            key={`${row.label}-${index}`}
            label={row.label}
            window={row.window}
            onHover={(hovering) => setHoveredLabel(hovering ? row.label : null)}
          />
        ) : (
          <EmptyQuotaRow key={`${row.label}-${index}`} label={row.label} message={row.message} />
        ),
      )}
      {rows.length === 0 && <span className="text-[11px] text-neutral-500">暂无订阅配额数据</span>}

      {hoveredWindow && hoveredIndex >= 0 && (
        <div
          className="pointer-events-none absolute left-0 z-40"
          style={{ top: (hoveredIndex + 1) * ROW_HEIGHT + hoveredIndex * ROW_SPACING + 6 }}
        >
          <Tooltip label={rows[hoveredIndex].label} window={hoveredWindow} />
        </div>
      )}
    </div>
  );
}

function QuotaRow({
  label,
  window: quotaWindow,
  onHover,
}: {
  label: string;
  window: RateLimitWindow;
  onHover: (hovering: boolean) => void;
}) {
  const elapsed = elapsedPercent(quotaWindow);
  return (
    <div className="flex items-center gap-1.5" style={{ height: ROW_HEIGHT }}>
      <span
        className="w-10 shrink-0 truncate font-mono text-[11px] font-medium"
        style={{ color: "#999999" }}
        title={label}
      >
        {label}
      </span>
      <div
        className="flex min-w-0 grow flex-col justify-center gap-0.5"
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        <ProgressBar value={quotaWindow.utilization} height={6} />
        {elapsed != null && (
          <ProgressBar
            value={elapsed}
            height={3}
            fill="rgba(255,255,255,0.42)"
            background="rgba(255,255,255,0.14)"
          />
        )}
      </div>
      <span
        className="w-9 shrink-0 text-right font-mono text-xs font-medium"
        style={{ color: utilizationColor(quotaWindow.utilization) }}
      >
        {formatPercent(quotaWindow.utilization)}
      </span>
    </div>
  );
}

function EmptyQuotaRow({ label, message }: { label: string; message: string }) {
  return (
    <div className="flex items-center gap-1.5" style={{ height: ROW_HEIGHT }}>
      <span className="w-10 shrink-0 truncate font-mono text-[11px]" style={{ color: "#666666" }}>
        {label}
      </span>
      <span className="min-w-0 grow truncate text-[11px] text-neutral-500">{message}</span>
    </div>
  );
}

function Tooltip({ label, window: quotaWindow }: { label: string; window: RateLimitWindow }) {
  const elapsed = elapsedPercent(quotaWindow);
  const remaining =
    quotaWindow.resetsAt != null
      ? formatTimeUntil(new Date(quotaWindow.resetsAt * 1000))
      : null;
  return (
    <div
      className="flex flex-col gap-[5px] whitespace-nowrap rounded-[5px] bg-black px-2.5 py-2 text-[11px] shadow-[0_2px_5px_rgba(0,0,0,0.5)]"
      style={{ border: "0.5px solid #383838" }}
    >
      <span className="font-semibold text-white">{label}</span>
      <span style={{ color: utilizationColor(quotaWindow.utilization) }}>
        已使用 {formatPercent(quotaWindow.utilization)}
      </span>
      <span className="text-neutral-400">
        {elapsed != null && remaining != null
          ? `已过去 ${formatPercent(elapsed)} · 剩余 ${remaining}`
          : remaining != null
            ? `重置剩余 ${remaining}`
            : "重置时间未知"}
      </span>
    </div>
  );
}

function FreshnessNote({
  snapshot,
  additionalMeterCount,
}: {
  snapshot: ProviderRateLimit;
  additionalMeterCount: number;
}) {
  const ageMinutes = snapshot.dataAsOf
    ? Math.max(0, Math.floor((Date.now() / 1000 - snapshot.dataAsOf) / 60))
    : 0;
  const notes = [
    ageMinutes >= 5 ? `数据截至 ${ageMinutes} 分钟前` : null,
    snapshot.resetCreditsCount ? `重置券 ×${snapshot.resetCreditsCount}` : null,
    additionalMeterCount > 0 ? `另有 ${additionalMeterCount} 项` : null,
  ].filter(Boolean);
  if (notes.length === 0) return null;
  return <div className="truncate text-[10px] text-neutral-500">{notes.join(" · ")}</div>;
}

function MessageContent({ text }: { text: string }) {
  const state = useAppState();
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 grow text-[11px] leading-snug text-t-muted">{text}</span>
      <button
        className="shrink-0 rounded-full px-2.5 py-[3px] text-[11px]"
        style={{ background: "rgba(255,255,255,0.16)", color: "#C7C7C7" }}
        onClick={() => void state.refreshRateLimits(true)}
      >
        重试
      </button>
    </div>
  );
}

function ProgressBar({
  value,
  height,
  fill,
  background = "rgba(255,255,255,0.18)",
}: {
  value: number;
  height: number;
  fill?: string;
  background?: string;
}) {
  const percent = Math.min(Math.max(value, 0), 100);
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background }}>
      <div
        className="h-full rounded-full"
        style={{ width: `${percent}%`, background: fill ?? utilizationColor(value) }}
      />
    </div>
  );
}
