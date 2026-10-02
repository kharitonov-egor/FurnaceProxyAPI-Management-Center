import type { RoutingLimitsAccount } from '@/services/api/routingLimits';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

export type UsageTone = 'unknown' | 'ok' | 'warn' | 'limit';

export function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return value > 0 && value < 1 ? `${value.toFixed(1)}%` : `${Math.round(value)}%`;
}

/** Compact duration such as "2d 3h", "14h", "45m", or "<1m". */
export function formatDurationShort(ms: number): string {
  const total = Math.max(0, ms);
  if (total < MINUTE_MS) return '<1m';
  const days = Math.floor(total / DAY_MS);
  const hours = Math.floor((total % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((total % HOUR_MS) / MINUTE_MS);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 && hours < 6 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export type ResetCountdown =
  { kind: 'none' } | { kind: 'future'; duration: string } | { kind: 'past'; duration: string };

export function resetCountdown(resetsAt: string | null, now: number): ResetCountdown {
  if (!resetsAt) return { kind: 'none' };
  const target = Date.parse(resetsAt);
  if (!Number.isFinite(target)) return { kind: 'none' };
  const delta = target - now;
  return delta >= 0
    ? { kind: 'future', duration: formatDurationShort(delta) }
    : { kind: 'past', duration: formatDurationShort(-delta) };
}

/** Absolute reset time in the browser's local time zone, e.g. "Fri, Oct 3, 2:00 PM". */
export function formatLocalTime(iso: string | null, locale?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function usageTone(used: number | null, threshold: number): UsageTone {
  if (used === null) return 'unknown';
  if (used >= threshold) return 'limit';
  if (used >= threshold * 0.8) return 'warn';
  return 'ok';
}

export interface ProviderGroup {
  provider: string;
  accounts: RoutingLimitsAccount[];
}

/** Groups accounts by provider (alphabetical) and orders each group by rank. */
export function groupAccountsByProvider(accounts: RoutingLimitsAccount[]): ProviderGroup[] {
  const groups = new Map<string, RoutingLimitsAccount[]>();
  for (const account of accounts) {
    const list = groups.get(account.provider) ?? [];
    list.push(account);
    groups.set(account.provider, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, list]) => ({
      provider,
      accounts: [...list].sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity)),
    }));
}
