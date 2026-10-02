/**
 * Reset-aware routing limits: GET /v8/management/routing/limits (FurnaceProxyAPI).
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export interface LimitWindowView {
  usedPercent: number | null;
  resetsAt: string | null;
  windowSeconds: number | null;
  estimated: boolean;
  affectsRouting: boolean;
}

export interface LimitBucketView extends LimitWindowView {
  name: string;
  appliesTo: string;
}

export interface RoutingLimitsAccount {
  authIndex: string;
  provider: string;
  label: string;
  status: string;
  rank: number;
  rankOf: number;
  eligible: boolean;
  ineligibleReasons: string[];
  hasData: boolean;
  source: string;
  observedAt: string | null;
  usageObservedAt: string | null;
  fiveHour: LimitWindowView;
  weekly: LimitWindowView;
  buckets: LimitBucketView[];
  projectedUnusedPercent: number | null;
  lastResetDetectedAt: string | null;
  lastRefreshError: string;
}

export interface RoutingLimitsReport {
  enabled: boolean;
  strategy: string;
  generatedAt: string | null;
  fiveHourThreshold: number;
  weeklyThreshold: number;
  refreshIntervalSeconds: number;
  accounts: RoutingLimitsAccount[];
}

const DEFAULT_THRESHOLD = 98;

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const toNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Go zero times ("0001-01-01T00:00:00Z") and unparsable values mean "unknown". */
export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

function normalizeWindow(value: unknown): LimitWindowView {
  const entry = isRecord(value) ? value : {};
  const used = toNumber(entry.used_percent);
  return {
    usedPercent: used === null ? null : Math.max(0, Math.min(100, used)),
    resetsAt: normalizeTimestamp(entry.resets_at),
    windowSeconds: toNumber(entry.window_seconds),
    estimated: entry.estimated === true,
    affectsRouting: entry.affects_routing === true,
  };
}

function normalizeBucket(value: unknown): LimitBucketView | null {
  if (!isRecord(value)) return null;
  const name = toText(value.name);
  if (!name) return null;
  return { ...normalizeWindow(value), name, appliesTo: toText(value.applies_to) };
}

function normalizeAccount(value: unknown): RoutingLimitsAccount | null {
  if (!isRecord(value)) return null;
  const provider = toText(value.provider).toLowerCase();
  if (!provider) return null;
  const reasons = Array.isArray(value.ineligible_reasons)
    ? value.ineligible_reasons.filter((reason): reason is string => typeof reason === 'string')
    : [];
  const buckets = Array.isArray(value.buckets)
    ? value.buckets.map(normalizeBucket).filter((bucket): bucket is LimitBucketView => !!bucket)
    : [];
  return {
    authIndex: toText(value.auth_index),
    provider,
    label: toText(value.label),
    status: toText(value.status) || 'active',
    rank: toNumber(value.rank) ?? 0,
    rankOf: toNumber(value.rank_of) ?? 0,
    eligible: value.eligible !== false,
    ineligibleReasons: reasons,
    hasData: value.has_data === true,
    source: toText(value.source),
    observedAt: normalizeTimestamp(value.observed_at),
    usageObservedAt: normalizeTimestamp(value.usage_observed_at),
    fiveHour: normalizeWindow(value.five_hour),
    weekly: normalizeWindow(value.weekly),
    buckets,
    projectedUnusedPercent: toNumber(value.projected_unused_percent),
    lastResetDetectedAt: normalizeTimestamp(value.last_reset_detected_at),
    lastRefreshError: toText(value.last_refresh_error),
  };
}

export function normalizeRoutingLimits(value: unknown): RoutingLimitsReport {
  const entry = isRecord(value) ? value : {};
  const accounts = Array.isArray(entry.accounts)
    ? entry.accounts
        .map(normalizeAccount)
        .filter((account): account is RoutingLimitsAccount => !!account)
    : [];
  return {
    enabled: entry.enabled === true,
    strategy: toText(entry.strategy),
    generatedAt: normalizeTimestamp(entry.generated_at),
    fiveHourThreshold: toNumber(entry.five_hour_threshold) ?? DEFAULT_THRESHOLD,
    weeklyThreshold: toNumber(entry.weekly_threshold) ?? DEFAULT_THRESHOLD,
    refreshIntervalSeconds: toNumber(entry.refresh_interval_seconds) ?? 0,
    accounts,
  };
}

export const routingLimitsApi = {
  async get(): Promise<RoutingLimitsReport> {
    const data = await apiClient.get<unknown>('/routing/limits');
    return normalizeRoutingLimits(data);
  },
};
