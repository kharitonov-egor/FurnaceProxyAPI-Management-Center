import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import {
  routingLimitsApi,
  type LimitBucketView,
  type LimitWindowView,
  type RoutingLimitsAccount,
  type RoutingLimitsReport,
} from '@/services/api/routingLimits';
import { getErrorMessage } from '@/utils/helpers';
import {
  formatLocalTime,
  formatPercent,
  groupAccountsByProvider,
  resetCountdown,
  usageTone,
} from './format';
import styles from './LimitsPage.module.scss';

const AUTO_REFRESH_MS = 60_000;

function ResetLabel({
  resetsAt,
  estimated,
  now,
}: {
  resetsAt: string | null;
  estimated: boolean;
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const countdown = resetCountdown(resetsAt, now);
  if (countdown.kind === 'none') {
    return <span className={styles.muted}>{t('routing_limits.reset_unknown')}</span>;
  }
  const relative =
    countdown.kind === 'future'
      ? t('routing_limits.resets_in', { duration: countdown.duration })
      : t('routing_limits.reset_ago', { duration: countdown.duration });
  return (
    <span className={styles.reset}>
      <span>
        {relative}
        {estimated ? ` ${t('routing_limits.estimated')}` : ''}
      </span>
      <span className={styles.muted}>{formatLocalTime(resetsAt, i18n.language)}</span>
    </span>
  );
}

function WindowCell({
  window,
  threshold,
  now,
}: {
  window: LimitWindowView;
  threshold: number;
  now: number;
}) {
  const tone = usageTone(window.usedPercent, threshold);
  return (
    <div className={styles.windowCell}>
      <div className={styles.usageLine}>
        <span className={`${styles.percent} ${styles[`tone_${tone}`]}`}>
          {formatPercent(window.usedPercent)}
        </span>
        <span className={styles.bar} aria-hidden="true">
          <span
            className={`${styles.barFill} ${styles[`fill_${tone}`]}`}
            style={{ width: `${window.usedPercent ?? 0}%` }}
          />
        </span>
      </div>
      {window.usedPercent !== null && (
        <ResetLabel resetsAt={window.resetsAt} estimated={window.estimated} now={now} />
      )}
    </div>
  );
}

function BucketChip({
  bucket,
  threshold,
  now,
}: {
  bucket: LimitBucketView;
  threshold: number;
  now: number;
}) {
  const { t } = useTranslation();
  const countdown = resetCountdown(bucket.resetsAt, now);
  const tone = usageTone(bucket.usedPercent, threshold);
  const title = bucket.affectsRouting
    ? t('routing_limits.bucket_routing', { models: bucket.appliesTo })
    : t('routing_limits.bucket_not_routing');
  return (
    <span
      className={`${styles.chip} ${bucket.affectsRouting ? '' : styles.chipMuted}`}
      title={title}
    >
      <span className={styles.chipName}>{bucket.name}</span>
      <span className={styles[`tone_${tone}`]}>{formatPercent(bucket.usedPercent)}</span>
      {countdown.kind === 'future' && (
        <span className={styles.muted}>
          {t('routing_limits.resets_in', { duration: countdown.duration })}
        </span>
      )}
    </span>
  );
}

function AccountRow({
  account,
  report,
  now,
}: {
  account: RoutingLimitsAccount;
  report: RoutingLimitsReport;
  now: number;
}) {
  const { t } = useTranslation();
  const reasons = account.ineligibleReasons
    .map((reason) =>
      reason.startsWith('bucket:')
        ? t('routing_limits.reason_bucket', { name: reason.slice('bucket:'.length) })
        : t(`routing_limits.reason_${reason}`, { defaultValue: reason })
    )
    .join(', ');
  return (
    <tr className={account.status !== 'active' ? styles.rowInactive : undefined}>
      <td className={styles.rankCell}>
        <span className={styles.rank}>{account.rank > 0 ? `#${account.rank}` : '—'}</span>
        {account.rank === 1 && account.eligible && account.status === 'active' && (
          <span className={styles.next}>{t('routing_limits.next_up')}</span>
        )}
      </td>
      <td>
        <div className={styles.account}>{account.label || account.authIndex}</div>
        <div className={styles.muted}>
          {account.status !== 'active'
            ? t(`routing_limits.status_${account.status}`, { defaultValue: account.status })
            : !account.hasData
              ? t('routing_limits.no_data')
              : account.eligible
                ? t('routing_limits.eligible')
                : t('routing_limits.limited', { reasons })}
        </div>
        {account.lastRefreshError && (
          <div className={styles.errorText}>
            {t('routing_limits.refresh_error', { error: account.lastRefreshError })}
          </div>
        )}
      </td>
      <td>
        <WindowCell window={account.fiveHour} threshold={report.fiveHourThreshold} now={now} />
      </td>
      <td>
        <WindowCell window={account.weekly} threshold={report.weeklyThreshold} now={now} />
      </td>
      <td>
        {account.buckets.length === 0 ? (
          <span className={styles.muted}>—</span>
        ) : (
          <div className={styles.chips}>
            {account.buckets.map((bucket) => (
              <BucketChip
                key={bucket.name}
                bucket={bucket}
                threshold={report.weeklyThreshold}
                now={now}
              />
            ))}
          </div>
        )}
      </td>
      <td>
        {account.projectedUnusedPercent === null ? (
          <span className={styles.muted}>—</span>
        ) : (
          <span className={account.projectedUnusedPercent > 0 ? styles.tone_warn : styles.tone_ok}>
            {formatPercent(account.projectedUnusedPercent)}
          </span>
        )}
      </td>
    </tr>
  );
}

export function LimitsPage() {
  const { t } = useTranslation();
  const now = useNow();
  const [report, setReport] = useState<RoutingLimitsReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const next = await routingLimitsApi.get();
      if (seq !== requestSeq.current) return;
      setReport(next);
      setError('');
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(getErrorMessage(err, t('routing_limits.load_failed')));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      requestSeq.current += 1;
    };
  }, [load]);

  useHeaderRefresh(load);

  const groups = useMemo(() => groupAccountsByProvider(report?.accounts ?? []), [report]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('routing_limits.title')}</h1>
          <p className={styles.subtitle}>{t('routing_limits.subtitle')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          {t('routing_limits.refresh')}
        </Button>
      </div>

      {report && (
        <div className={styles.summary}>
          <span className={report.enabled ? styles.badgeOn : styles.badgeOff}>
            {report.enabled
              ? t('routing_limits.strategy_on')
              : t('routing_limits.strategy_off', { strategy: report.strategy || 'round-robin' })}
          </span>
          <span>
            {t('routing_limits.thresholds', {
              fiveHour: report.fiveHourThreshold,
              weekly: report.weeklyThreshold,
            })}
          </span>
          {report.enabled && (
            <span>
              {report.refreshIntervalSeconds > 0
                ? t('routing_limits.polling', {
                    minutes: Math.round(report.refreshIntervalSeconds / 60),
                  })
                : t('routing_limits.polling_off')}
            </span>
          )}
        </div>
      )}

      {error && <div className={styles.errorBox}>{error}</div>}

      {!report && loading && <div className={styles.muted}>{t('routing_limits.loading')}</div>}

      {report && report.accounts.length === 0 && (
        <EmptyState
          title={t('routing_limits.empty_title')}
          description={t('routing_limits.empty_desc')}
        />
      )}

      {report &&
        groups.map((group) => (
          <Card
            key={group.provider}
            className={styles.card}
            title={t(`routing_limits.provider_${group.provider}`, { defaultValue: group.provider })}
          >
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('routing_limits.col_rank')}</th>
                    <th scope="col">{t('routing_limits.col_account')}</th>
                    <th scope="col">{t('routing_limits.col_five_hour')}</th>
                    <th scope="col">{t('routing_limits.col_weekly')}</th>
                    <th scope="col">{t('routing_limits.col_buckets')}</th>
                    <th scope="col">{t('routing_limits.col_projected')}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.accounts.map((account) => (
                    <AccountRow
                      key={account.authIndex || account.label}
                      account={account}
                      report={report}
                      now={now}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}

      {report && report.accounts.length > 0 && (
        <p className={styles.footnote}>{t('routing_limits.footnote')}</p>
      )}
    </div>
  );
}
