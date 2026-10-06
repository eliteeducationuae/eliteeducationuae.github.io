import type { HealthCheck, HealthJob, HealthStatus, SystemHealth } from './types';

/** Pure helpers for the admin System health screen. */

const RANK: Record<HealthStatus, number> = { ok: 0, warning: 1, failing: 2 };

/** The most serious of the given statuses ('ok' when there are none). */
export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'ok');
}

export function statusLabel(status: HealthStatus): string {
  return status === 'ok' ? 'Working' : status === 'warning' ? 'Needs attention' : 'Failing';
}

/** Badge tone for a status: calm for ok, gold for a warning, danger for a failure. */
export function statusTone(status: HealthStatus): 'success' | 'gold' | 'danger' {
  return status === 'ok' ? 'success' : status === 'warning' ? 'gold' : 'danger';
}

/** Checks that are not 'ok'. */
export function attentionCount(checks: Pick<HealthCheck, 'status'>[] | undefined): number {
  return (checks ?? []).filter((c) => c.status !== 'ok').length;
}

export function overallHeadline(health: Pick<SystemHealth, 'checks'>): string {
  const n = attentionCount(health.checks);
  if (n === 0) return 'All systems are working normally';
  return n === 1 ? '1 item needs your attention' : `${n} items need your attention`;
}

/** "Just now", "5 minutes ago", "3 hours ago", "2 days ago", or "Never". */
export function sinceLabel(fromIso: string | undefined | null, nowMs: number): string {
  if (!fromIso) return 'Never';
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return 'Never';
  const seconds = Math.max(0, Math.round((nowMs - t) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

/** A scheduled job's state: failing when its last failure is newer than its last success, idle if it has never run. */
export function jobStatus(job: HealthJob): HealthStatus | 'never' {
  if (!job.lastStartedAt && !job.lastSucceededAt && !job.lastFailedAt) return 'never';
  if (job.lastFailedAt && (!job.lastSucceededAt || job.lastFailedAt > job.lastSucceededAt)) return 'failing';
  return 'ok';
}

/** One line describing a job's last run. */
export function jobSummary(job: HealthJob, nowMs: number): string {
  const state = jobStatus(job);
  if (state === 'never') return 'Has not run yet.';
  if (state === 'failing') return `Last failed ${sinceLabel(job.lastFailedAt, nowMs).toLowerCase()}${job.lastError ? `: ${job.lastError}` : '.'}`;
  return `Last succeeded ${sinceLabel(job.lastSucceededAt ?? job.lastStartedAt, nowMs).toLowerCase()}.`;
}

/** First line of a message or stack, for compact lists. */
export function firstLine(text: string | undefined | null, max = 160): string {
  const line = (text ?? '').split('\n')[0]?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
