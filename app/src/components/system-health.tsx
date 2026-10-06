import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { font, Spacing } from '@/constants/theme';
import { useAppErrors, useFunctionErrors, useSystemHealth } from '@/data/hooks';
import { formatDate, formatTime } from '@/domain/dates';
import { attentionCount, firstLine, jobStatus, jobSummary, overallHeadline, sinceLabel, statusLabel, statusTone } from '@/domain/system-health';
import type { AppErrorRow, FunctionErrorRow } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';
import { Badge, Button, Card, EmptyState, ErrorNote, ListItem, Loading, Row, Screen, Section, Txt } from './ui';

const when = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;

const JOB_NAMES: Record<string, string> = {
  'send-notifications': 'Emails and push notifications',
  'send-reminders': 'Lesson reminders',
  'calendar-sync': 'Google Calendar sync',
  'charge-invoice': 'Automatic card payments',
  'purge-app-errors': 'Error log tidy-up',
  backups: 'Nightly backups',
};

const ERROR_SOURCES: Record<string, string> = {
  boundary: 'Screen',
  query: 'Loading',
  mutation: 'Saving',
  global: 'App',
  manual: 'Reported',
};

function Expandable({ title, subtitle, detail, badge }: { title: string; subtitle: string; detail?: string; badge?: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Card onPress={detail ? () => setOpen((o) => !o) : undefined} accessibilityLabel={title}>
      <Row gap={Spacing.two} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3" numberOfLines={open ? undefined : 2}>
            {title}
          </Txt>
          <Txt variant="small">{subtitle}</Txt>
        </View>
        {badge ? <Badge label={badge} /> : null}
      </Row>
      {open && detail ? (
        <View style={{ backgroundColor: theme.surfaceAlt, borderRadius: 8, padding: Spacing.two }}>
          <Txt variant="small" selectable style={{ ...font('sans'), fontVariant: ['tabular-nums'] }}>
            {detail}
          </Txt>
        </View>
      ) : null}
    </Card>
  );
}

function AppErrorItem({ e }: { e: AppErrorRow }) {
  const where = [e.platform, e.route, e.appVersion ? `v${e.appVersion}` : undefined].filter(Boolean).join(' · ');
  return <Expandable title={firstLine(e.message)} subtitle={`${when(e.createdAt)} · ${where}`} detail={e.stack || e.message} badge={ERROR_SOURCES[e.source] ?? e.source} />;
}

function FunctionErrorItem({ e }: { e: FunctionErrorRow }) {
  const detail = [e.message, e.context ? JSON.stringify(e.context, null, 2) : ''].filter(Boolean).join('\n\n');
  return (
    <Expandable
      title={firstLine(e.message)}
      subtitle={`${when(e.createdAt)} · ${JOB_NAMES[e.functionName] ?? e.functionName}${e.status ? ` · ${e.status}` : ''}`}
      detail={detail}
    />
  );
}

/** Admin: whether notifications, payments, calendars and backups are working, plus recent errors. */
export function SystemHealthScreen() {
  const theme = useTheme();
  const health = useSystemHealth();
  const appErrors = useAppErrors(50);
  const functionErrors = useFunctionErrors(50);
  const [showMigrations, setShowMigrations] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());

  const refresh = () => {
    setRefreshedAt(Date.now());
    health.refetch();
    appErrors.refetch();
    functionErrors.refetch();
  };

  if (health.isLoading) return <Loading />;
  const data = health.data;
  // Relative times are measured from when the report was produced, so they never depend on render time.
  const nowMs = data ? Math.max(Date.parse(data.checkedAt) || 0, refreshedAt) : refreshedAt;
  const attention = data ? attentionCount(data.checks) : 0;

  return (
    <Screen onRefresh={refresh} refreshing={health.isRefetching}>
      <ErrorNote error={health.error} />
      {data ? (
        <>
          <Card variant="hero" style={{ gap: Spacing.two }}>
            <Txt variant="label">Overall</Txt>
            <View style={{ width: 28, height: 2, backgroundColor: theme.gold }} />
            <Txt variant="h2">{overallHeadline(data)}</Txt>
            <Txt variant="small">
              Checked {sinceLabel(data.checkedAt, nowMs).toLowerCase()} ({when(data.checkedAt)}).{' '}
              {attention ? 'The items marked below explain what to do.' : 'Nothing needs your attention.'}
            </Txt>
            <Row>
              <Button title="Refresh" variant="outline" size="sm" icon="repeat" onPress={refresh} />
            </Row>
          </Card>

          <Section title="Checks">
            {data.checks.map((c) => (
              <ListItem
                key={c.key}
                title={c.label}
                subtitle={c.detail}
                left={<Icon name={c.status === 'ok' ? 'check' : 'alert'} size={22} color={c.status === 'ok' ? theme.success : c.status === 'warning' ? theme.accent : theme.danger} />}
                below={<Badge label={statusLabel(c.status)} tone={statusTone(c.status)} />}
              />
            ))}
          </Section>

          <Section title="Scheduled jobs">
            {data.jobs.length ? (
              data.jobs.map((j) => {
                const state = jobStatus(j);
                return (
                  <ListItem
                    key={j.name}
                    title={JOB_NAMES[j.name] ?? j.name}
                    subtitle={jobSummary(j, nowMs)}
                    below={<Badge label={state === 'never' ? 'Not run yet' : statusLabel(state)} tone={state === 'never' ? 'neutral' : statusTone(state)} />}
                  />
                );
              })
            ) : (
              <Card>
                <Txt variant="muted">No scheduled jobs have reported yet.</Txt>
              </Card>
            )}
          </Section>

          <Section title="Database version">
            <Card style={{ gap: Spacing.two }}>
              <Txt variant="label">Latest migration</Txt>
              <Txt variant="number" selectable>
                {data.database.latest || 'Unknown'}
              </Txt>
              <Txt variant="muted">
                {data.database.latestName ? `${data.database.latestName} · ` : ''}
                {data.database.count} {data.database.count === 1 ? 'migration' : 'migrations'} applied
              </Txt>
              {data.database.migrations.length ? (
                <Pressable onPress={() => setShowMigrations((v) => !v)} accessibilityRole="button" style={{ paddingVertical: 4 }}>
                  <Txt style={{ color: theme.accent }}>{showMigrations ? 'Hide applied migrations' : 'Show applied migrations'}</Txt>
                </Pressable>
              ) : null}
              {showMigrations
                ? data.database.migrations.map((m) => (
                    <Row key={m.version} gap={Spacing.two} style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                      <Txt variant="small" style={{ ...font('sans'), fontVariant: ['tabular-nums'] }}>
                        {m.version}
                      </Txt>
                      <Txt variant="small" style={{ flexShrink: 1 }}>
                        {m.name}
                        {m.appliedAt ? ` · ${formatDate(m.appliedAt)}` : ''}
                      </Txt>
                    </Row>
                  ))
                : null}
            </Card>
          </Section>
        </>
      ) : null}

      <Section title="Recent app errors">
        <ErrorNote error={appErrors.error} />
        {appErrors.isLoading ? (
          <Loading />
        ) : (appErrors.data ?? []).length ? (
          (appErrors.data ?? []).map((e) => <AppErrorItem key={e.id} e={e} />)
        ) : (
          <EmptyState icon="check" title="No app errors" message="Errors people meet in the app will be listed here, without their personal details." />
        )}
      </Section>

      <Section title="Recent server errors">
        <ErrorNote error={functionErrors.error} />
        {functionErrors.isLoading ? (
          <Loading />
        ) : (functionErrors.data ?? []).length ? (
          (functionErrors.data ?? []).map((e) => <FunctionErrorItem key={e.id} e={e} />)
        ) : (
          <EmptyState icon="check" title="No server errors" message="Failures in notifications, payments and calendar sync will be listed here." />
        )}
      </Section>
    </Screen>
  );
}
