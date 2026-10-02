import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeRoutingLimits } from '../src/services/api/routingLimits';
import {
  formatDurationShort,
  formatPercent,
  groupAccountsByProvider,
  resetCountdown,
  usageTone,
} from '../src/features/limits/format';

// Synthetic payload shaped like GET /v8/management/routing/limits.
const SAMPLE = {
  enabled: true,
  strategy: 'reset-aware',
  generated_at: '2027-01-01T00:00:00Z',
  five_hour_threshold: 98,
  weekly_threshold: 95,
  refresh_interval_seconds: 900,
  accounts: [
    {
      auth_index: 'b2',
      provider: 'CODEX',
      label: 'so•••@ex•••.test',
      status: 'active',
      rank: 2,
      rank_of: 2,
      eligible: false,
      ineligible_reasons: ['five_hour', 7],
      has_data: true,
      five_hour: { used_percent: 120, resets_at: '2027-01-01T02:00:00Z', affects_routing: true },
      weekly: { used_percent: 40, resets_at: '0001-01-01T00:00:00Z', affects_routing: true },
      buckets: [
        {
          name: 'Fable',
          used_percent: 17,
          resets_at: '2027-01-03T14:00:00Z',
          affects_routing: true,
          applies_to: 'fable',
        },
        { name: '', used_percent: 1 },
        'junk',
      ],
      projected_unused_percent: 12.5,
    },
    { auth_index: 'a1', provider: 'codex', rank: 1, has_data: false, five_hour: {}, weekly: {} },
    { provider: '' },
    null,
  ],
};

describe('normalizeRoutingLimits', () => {
  test('normalizes and validates the limits payload', () => {
    const report = normalizeRoutingLimits(SAMPLE);
    expect(report.enabled).toBe(true);
    expect(report.weeklyThreshold).toBe(95);
    expect(report.refreshIntervalSeconds).toBe(900);
    expect(report.accounts).toHaveLength(2);

    const [limited] = report.accounts;
    expect(limited.provider).toBe('codex');
    expect(limited.ineligibleReasons).toEqual(['five_hour']);
    expect(limited.fiveHour.usedPercent).toBe(100);
    expect(limited.weekly.resetsAt).toBeNull();
    expect(limited.buckets.map((bucket) => bucket.name)).toEqual(['Fable']);
    expect(limited.buckets[0].appliesTo).toBe('fable');
    expect(limited.projectedUnusedPercent).toBe(12.5);
  });

  test('falls back to safe defaults for malformed input', () => {
    const report = normalizeRoutingLimits('nope');
    expect(report.enabled).toBe(false);
    expect(report.fiveHourThreshold).toBe(98);
    expect(report.accounts).toEqual([]);
  });
});

describe('limits formatting', () => {
  test('formats compact durations', () => {
    expect(formatDurationShort(30_000)).toBe('<1m');
    expect(formatDurationShort(45 * 60_000)).toBe('45m');
    expect(formatDurationShort(2 * 3_600_000 + 15 * 60_000)).toBe('2h 15m');
    expect(formatDurationShort(14 * 3_600_000)).toBe('14h');
    expect(formatDurationShort(2 * 86_400_000 + 3 * 3_600_000)).toBe('2d 3h');
  });

  test('reports future, past, and unknown resets', () => {
    const now = Date.parse('2027-01-01T00:00:00Z');
    expect(resetCountdown('2027-01-01T14:00:00Z', now)).toEqual({
      kind: 'future',
      duration: '14h',
    });
    expect(resetCountdown('2026-12-31T23:30:00Z', now)).toEqual({ kind: 'past', duration: '30m' });
    expect(resetCountdown(null, now)).toEqual({ kind: 'none' });
  });

  test('maps usage to tones against the threshold', () => {
    expect(usageTone(null, 98)).toBe('unknown');
    expect(usageTone(10, 98)).toBe('ok');
    expect(usageTone(80, 98)).toBe('warn');
    expect(usageTone(98, 98)).toBe('limit');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(0.4)).toBe('0.4%');
    expect(formatPercent(41.6)).toBe('42%');
  });

  test('groups accounts by provider in rank order', () => {
    const report = normalizeRoutingLimits({
      accounts: [
        { provider: 'codex', auth_index: 'c', rank: 2 },
        { provider: 'claude', auth_index: 'x', rank: 1 },
        { provider: 'codex', auth_index: 'd', rank: 1 },
      ],
    });
    const groups = groupAccountsByProvider(report.accounts);
    expect(groups.map((group) => group.provider)).toEqual(['claude', 'codex']);
    expect(groups[1].accounts.map((account) => account.authIndex)).toEqual(['d', 'c']);
  });
});

describe('limits page wiring', () => {
  const root = join(import.meta.dir, '..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');

  test('registers the route and sidebar entry', () => {
    expect(read('src/router/MainRoutes.tsx')).toContain(
      "{ path: '/limits', element: <LimitsPage /> }"
    );
    expect(read('src/components/layout/MainLayout.tsx')).toContain(
      "labelKey: 'nav.routing_limits'"
    );
  });

  test('every locale has the same routing_limits keys', () => {
    const locales = ['en', 'zh-CN', 'zh-TW', 'ru'].map((locale) =>
      JSON.parse(read(`src/i18n/locales/${locale}.json`))
    );
    const english = Object.keys(locales[0].routing_limits).sort();
    for (const locale of locales) {
      expect(Object.keys(locale.routing_limits).sort()).toEqual(english);
      expect(typeof locale.nav.routing_limits).toBe('string');
      expect(typeof locale.nav_meta.routing_limits).toBe('string');
    }
  });
});
