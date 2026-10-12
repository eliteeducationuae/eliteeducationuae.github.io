import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { font, Spacing } from '@/constants/theme';
import { useAppErrors, useFunctionErrors, useSystemHealth } from '@/data/hooks';
import { formatDate, formatTime } from '@/domain/dates';
import { attentionCount, firstLine, jobStatus, jobSummary, overallHeadline, sinceLabel, statusLabel } from '@/domain/system-health';
import type { AppErrorRow, FunctionErrorRow } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

import { Button, Columns, ErrorNote, Figure, Figures, Group, GroupRow, Loading, Notice, PageHeader, Row, Screen, Txt } from './ui';

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

function ErrorRow({ title, subtitle, detail, badge }: { title: string; subtitle: string; detail?: string; badge?: string }) {
  const theme = useTheme();
  return (
    <GroupRow
      icon="report"
      tone="bad"
      title={title}
      note={subtitle}
      value={badge}
      valueSize={12.5}
      body={
        detail ? (
          <View style={{ backgroundColor: theme.surfaceAlt, borderRadius: 12, padding: 12 }}>
            <Txt variant="small" selectable style={{ ...font('sans'), fontVariant: ['tabular-nums'] }}>
              {detail}
            </Txt>
          </View>
        ) : undefined
      }
    />
  );
}

function AppErrorItem({ e }: { e: AppErrorRow }) {
  const where = [e.platform, e.route, e.appVersion ? `v${e.appVersion}` : undefined].filter(Boolean).join(' · ');
  return <ErrorRow title={firstLine(e.message)} subtitle={`${when(e.createdAt)} · ${where}`} detail={e.stack || e.message} badge={ERROR_SOURCES[e.source] ?? e.source} />;
}

function FunctionErrorItem({ e }: { e: FunctionErrorRow }) {
  const detail = [e.message, e.context ? JSON.stringify(e.context, null, 2) : ''].filter(Boolean).join('\n\n');
  return (
    <ErrorRow
      title={firstLine(e.message)}
      subtitle={`${when(e.createdAt)} · ${JOB_NAMES[e.functionName] ?? e.functionName}${e.status ? ` · ${e.status}` : ''}`}
      detail={detail}
    />
  );
}

/** Admin: whether notifications, payments, calendars and backups are working, plus recent errors. */
export function SystemHealthScreen() {
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

  const failingJobs = data ? data.jobs.filter((j) => jobStatus(j) === 'failing').length : 0;
  const tone = (st: string) => (st === 'ok' ? 'good' : st === 'warning' ? 'warn' : st === 'never' ? 'muted' : 'bad') as 'good' | 'warn' | 'bad' | 'muted';

  return (
    <Screen topInset onRefresh={refresh} refreshing={health.isRefetching}>
      <Stack.Screen options={{ headerShown: false, title: 'System health' }} />
      <PageHeader back={{ fallback: '/admin' }} kicker="Business" title="System health" sub="The services the app relies on: checks, scheduled jobs, the database version and recent errors." />
      <ErrorNote error={health.error} />
      {data ? (
        <>
          <Notice tone={attention ? 'warn' : 'good'} title={overallHeadline(data)}>
            {`Checked ${sinceLabel(data.checkedAt, nowMs).toLowerCase()} (${when(data.checkedAt)}). ${attention ? 'The items marked below explain what to do.' : 'Nothing needs your attention.'}`}
          </Notice>
          <View style={{ flexDirection: 'row' }}>
            <Button title="Refresh" icon="refresh" size="sm" variant="secondary" onPress={refresh} />
          </View>

          <Figures>
            <Figure label="Checks" value={`${data.checks.length - attention} of ${data.checks.length}`} hint="working" tone={attention ? 'warn' : 'good'} />
            <Figure label="Scheduled jobs" value={String(data.jobs.length)} hint={failingJobs ? `${failingJobs} failing` : 'none failing'} tone={failingJobs ? 'bad' : undefined} />
            <Figure label="App errors" value={appErrors.isLoading ? '…' : String((appErrors.data ?? []).length)} hint="most recent 50" />
            <Figure label="Server errors" value={functionErrors.isLoading ? '…' : String((functionErrors.data ?? []).length)} hint="most recent 50" />
          </Figures>

          <Columns>
            <Group title="Checks">
              {data.checks.map((c) => (
                <GroupRow
                  key={c.key}
                  icon={c.status === 'ok' ? 'check_circle' : 'alert'}
                  tone={c.status === 'ok' ? 'good' : c.status === 'warning' ? 'warn' : 'bad'}
                  title={c.label}
                  note={c.detail}
                  value={statusLabel(c.status)}
                  valueTone={tone(c.status) === 'muted' ? 'muted' : tone(c.status)}
                  valueSize={12.5}
                />
              ))}
            </Group>
            <Group title="Scheduled jobs" note={data.jobs.length ? undefined : 'No scheduled jobs have reported yet.'}>
              {data.jobs.map((j) => {
                const state = jobStatus(j);
                return (
                  <GroupRow
                    key={j.name}
                    icon="schedule"
                    tone={state === 'ok' ? 'good' : state === 'never' ? 'neutral' : 'bad'}
                    title={JOB_NAMES[j.name] ?? j.name}
                    note={jobSummary(j, nowMs)}
                    value={state === 'never' ? 'Not run yet' : statusLabel(state)}
                    valueTone={tone(state) === 'muted' ? 'muted' : tone(state)}
                    valueSize={12.5}
                  />
                );
              })}
            </Group>
          </Columns>

          <Group
            title="Database version"
            link={data.database.migrations.length ? { label: showMigrations ? 'Hide applied migrations' : 'Show applied migrations', onPress: () => setShowMigrations((v) => !v) } : undefined}>
            <GroupRow
              icon="inventory_2"
              title={data.database.latest || 'Unknown'}
              note={`${data.database.latestName ? `${data.database.latestName} · ` : ''}${data.database.count} ${data.database.count === 1 ? 'migration' : 'migrations'} applied`}
            />
            {showMigrations ? (
              <View style={{ paddingVertical: 12, paddingHorizontal: 18, gap: 6 }}>
                {data.database.migrations.map((m) => (
                  <Row key={m.version} gap={Spacing.two} style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <Txt variant="small" style={{ ...font('sans'), fontVariant: ['tabular-nums'] }}>
                      {m.version}
                    </Txt>
                    <Txt variant="small" style={{ flexShrink: 1 }}>
                      {m.name}
                      {m.appliedAt ? ` · ${formatDate(m.appliedAt)}` : ''}
                    </Txt>
                  </Row>
                ))}
              </View>
            ) : null}
          </Group>
        </>
      ) : null}

      <ErrorNote error={appErrors.error} />
      {appErrors.isLoading ? (
        <Loading />
      ) : (
        <Group title="Recent app errors" note={(appErrors.data ?? []).length ? 'Without the personal details of whoever met them. Tap one for the detail.' : 'No app errors. Errors people meet in the app will be listed here, without their personal details.'}>
          {(appErrors.data ?? []).map((e) => (
            <AppErrorItem key={e.id} e={e} />
          ))}
        </Group>
      )}

      <ErrorNote error={functionErrors.error} />
      {functionErrors.isLoading ? (
        <Loading />
      ) : (
        <Group title="Recent server errors" note={(functionErrors.data ?? []).length ? undefined : 'No server errors. Failures in notifications, payments and calendar sync will be listed here.'}>
          {(functionErrors.data ?? []).map((e) => (
            <FunctionErrorItem key={e.id} e={e} />
          ))}
        </Group>
      )}
    </Screen>
  );
}
