import { router, type Href } from 'expo-router';
import { Fragment, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useAuditActors, useAuditHistory, useLookup, type Lookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import {
  AUDIT_TYPE_GROUPS,
  describeAuditEvent,
  type AuditEvent,
  type AuditFilter,
  type AuditNames,
} from '@/domain/audit';
import { addDays, formatDate, formatTime, relativeDay, startOfDay } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';
import { Button, Card, Chip, EmptyState, Loading, Row, Screen, Section, Segmented, Txt } from './ui';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Adapts the app's lookup to the names the audit descriptions need. */
export function auditNamesFrom(lookup: Lookup): AuditNames {
  return {
    tutor: (id) => lookup.tutor(id)?.fullName,
    student: (id) => lookup.student(id)?.fullName,
    family: (id) => lookup.family(id)?.name,
    service: (id) => lookup.service(id)?.name,
  };
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  tutor: 'Tutor',
  parent: 'Parent',
  student: 'Student',
  system: 'System',
};

/** The role of whoever made the change, as shown on the meta line. */
export function auditRoleLabel(e: AuditEvent): string {
  if (!e.actorId && !e.actorRole) return 'System';
  return ROLE_LABELS[e.actorRole ?? ''] ?? 'System';
}

/** A string id held in the event's row, before or after the change. */
function rowValue(e: AuditEvent, key: string): string | undefined {
  const v = e.after?.[key] ?? e.before?.[key];
  return typeof v === 'string' && v ? v : undefined;
}

/** The screen that shows the record an event belongs to, if there is one. */
export function auditHref(e: AuditEvent): Href | null {
  switch (e.table) {
    case 'lessons':
      return e.rowId && e.action !== 'delete' ? { pathname: '/lesson/[id]', params: { id: e.rowId } } : null;
    case 'lesson_notes': {
      const lessonId = rowValue(e, 'lesson_id') ?? e.relatedIds[0];
      return lessonId ? { pathname: '/lesson/[id]', params: { id: lessonId } } : null;
    }
    case 'invoices':
      return e.rowId && e.action !== 'delete' ? { pathname: '/invoice/[id]', params: { id: e.rowId } } : null;
    case 'payments': {
      const invoiceId = rowValue(e, 'invoice_id') ?? e.relatedIds[0];
      return invoiceId ? { pathname: '/invoice/[id]', params: { id: invoiceId } } : null;
    }
    case 'students':
      return e.rowId && e.action !== 'delete' ? { pathname: '/students/[id]', params: { id: e.rowId } } : null;
    case 'families':
      return e.rowId && e.action !== 'delete' ? { pathname: '/manage/family-edit', params: { id: e.rowId } } : null;
    case 'tutors':
      return e.rowId && e.action !== 'delete' ? { pathname: '/manage/tutor-edit', params: { id: e.rowId } } : null;
    default:
      return null;
  }
}

function pluralChanges(n: number): string {
  return `Showing ${n} ${n === 1 ? 'change' : 'changes'}`;
}

// ---------------------------------------------------------------------------
// One event
// ---------------------------------------------------------------------------

export function AuditEventRow({ event, names, showLink }: { event: AuditEvent; names: AuditNames; showLink?: boolean }) {
  const theme = useTheme();
  const { summary, changes } = useMemo(() => describeAuditEvent(event, names), [event, names]);
  const href = showLink ? auditHref(event) : null;
  const body = (
    <Row gap={Spacing.two} style={{ alignItems: 'flex-start' }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body">{summary}</Txt>
        {changes.map((c, i) => (
          <Txt key={i} variant="muted">
            {c}
          </Txt>
        ))}
        <Row gap={Spacing.one} wrap style={{ marginTop: 2 }}>
          <Txt variant="small">
            {formatDate(event.at)}, {formatTime(event.at)} ·
          </Txt>
          <Txt variant="label">{auditRoleLabel(event)}</Txt>
        </Row>
      </View>
      {href ? (
        <View style={{ paddingTop: 4 }}>
          <Icon name="chevron" size={16} color={theme.textMuted} />
        </View>
      ) : null}
    </Row>
  );
  if (!href) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="link"
      accessibilityLabel={summary}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}>
      {body}
    </Pressable>
  );
}

/** Events stacked in one card, separated by hairlines. */
function EventList({ events, names, showLink }: { events: AuditEvent[]; names: AuditNames; showLink?: boolean }) {
  const theme = useTheme();
  return (
    <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
      {events.map((e, i) => (
        <Fragment key={e.id}>
          {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border }} /> : null}
          <AuditEventRow event={e} names={names} showLink={showLink} />
        </Fragment>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// History on a record's screen (admins only)
// ---------------------------------------------------------------------------

/** The latest changes to one record, at the foot of its screen. Renders nothing for anyone but an admin. */
export function HistorySection({ filter, title = 'History' }: { filter: AuditFilter; title?: string }) {
  const me = useMe();
  const isAdmin = me.role === 'admin';
  const lookup = useLookup();
  const names = useMemo(() => auditNamesFrom(lookup), [lookup]);
  const history = useAuditHistory(filter, 5, isAdmin);
  if (!isAdmin) return null;
  const events = history.data?.pages.flatMap((p) => p.events) ?? [];
  return (
    <Section title={title}>
      {history.isLoading ? (
        <Loading />
      ) : history.isError ? (
        <Txt variant="muted">The history could not be loaded just now.</Txt>
      ) : events.length === 0 ? (
        <Txt variant="muted">No changes have been recorded yet.</Txt>
      ) : (
        <View style={{ gap: Spacing.two }}>
          <EventList events={events} names={names} />
          {history.hasNextPage ? (
            <Button
              title="Show earlier changes"
              variant="ghost"
              size="sm"
              loading={history.isFetchingNextPage}
              onPress={() => history.fetchNextPage()}
            />
          ) : null}
        </View>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// The activity log screen (admins only)
// ---------------------------------------------------------------------------

type Period = 'all' | 'today' | 'week' | 'month';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
];

/** The start of a period, counted in whole days back from today. */
function periodStart(period: Period, now: Date): string | undefined {
  if (period === 'all') return undefined;
  const back = period === 'today' ? 0 : period === 'week' ? 6 : 29;
  return addDays(startOfDay(now), -back).toISOString();
}

export function ActivityLog() {
  const me = useMe();
  const isAdmin = me.role === 'admin';
  const lookup = useLookup();
  const names = useMemo(() => auditNamesFrom(lookup), [lookup]);
  const [now] = useState(() => new Date());
  const [actorId, setActorId] = useState<string | undefined>();
  const [group, setGroup] = useState<string | undefined>();
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState<string | undefined>();
  const filter = useMemo<AuditFilter>(
    () => ({
      actorId,
      tables: group ? AUDIT_TYPE_GROUPS.find((g) => g.key === group)?.tables : undefined,
      from,
    }),
    [actorId, group, from],
  );
  const actors = useAuditActors(isAdmin);
  const history = useAuditHistory(filter, 30, isAdmin);

  if (!isAdmin) {
    return (
      <Screen>
        <EmptyState icon="alert" title="Admins only" message="The activity log is available to administrators." />
      </Screen>
    );
  }

  const events = history.data?.pages.flatMap((p) => p.events) ?? [];
  const days: { key: string; label: string; events: AuditEvent[] }[] = [];
  for (const e of events) {
    const label = relativeDay(e.at, now);
    const key = formatDate(e.at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.events.push(e);
    else days.push({ key, label: label === 'Today' || label === 'Yesterday' ? `${label}, ${key}` : `${label} ${new Date(e.at).getFullYear()}`, events: [e] });
  }

  return (
    <Screen onRefresh={() => history.refetch()} refreshing={history.isRefetching && !history.isFetchingNextPage}>
      <View style={{ gap: Spacing.one }}>
        <Txt variant="h2">Who changed what, and when</Txt>
        <Txt variant="muted">Every change to lessons, billing, families and tutors, newest first.</Txt>
      </View>

      <Section title="Person">
        <Row gap={Spacing.two} wrap>
          <Chip label="Everyone" selected={!actorId} onPress={() => setActorId(undefined)} />
          {(actors.data ?? []).map((a) => (
            <Chip key={a.id} label={a.name} selected={actorId === a.id} onPress={() => setActorId(actorId === a.id ? undefined : a.id)} />
          ))}
        </Row>
      </Section>

      <Section title="Type">
        <Row gap={Spacing.two} wrap>
          <Chip label="All" selected={!group} onPress={() => setGroup(undefined)} />
          {AUDIT_TYPE_GROUPS.map((g) => (
            <Chip key={g.key} label={g.label} selected={group === g.key} onPress={() => setGroup(group === g.key ? undefined : g.key)} />
          ))}
        </Row>
      </Section>

      <Section title="Date">
        <Segmented
          value={period}
          options={PERIODS}
          onChange={(p) => {
            setPeriod(p);
            setFrom(periodStart(p, new Date()));
          }}
        />
      </Section>

      {history.isLoading ? (
        <Loading />
      ) : history.isError ? (
        <EmptyState icon="alert" title="The activity log could not be loaded" message="Please pull down to try again." />
      ) : events.length === 0 ? (
        <EmptyState icon="clock" title="Nothing matches these filters." message="Try a wider date range or another person." />
      ) : (
        <View style={{ gap: Spacing.four }}>
          <Txt variant="small">{pluralChanges(events.length)}</Txt>
          {days.map((d) => (
            <View key={d.key} style={{ gap: Spacing.two }}>
              <Txt variant="h3">{d.label}</Txt>
              <EventList events={d.events} names={names} showLink />
            </View>
          ))}
          {history.hasNextPage ? (
            <Button title="Load more" variant="outline" loading={history.isFetchingNextPage} onPress={() => history.fetchNextPage()} />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: Spacing.two + Spacing.one },
});
