import { router, Stack, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { font, Spacing } from '@/constants/theme';
import { useAuditActors, useAuditHistory, useLookup, type Lookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import {
  AUDIT_TYPE_GROUPS,
  actorLabeller,
  describeAuditEvent,
  type AuditActor,
  type AuditEvent,
  type AuditFilter,
  type AuditNames,
} from '@/domain/audit';
import { addDays, formatDate, formatTime, relativeDay, startOfDay } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
import { Actions, Button, Card, Chip, EmptyState, Field, Group, IconCircle, Loading, PageHeader, Row, Screen, Segmented, Txt } from './ui';

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

type AuditTarget = { pathname: '/lesson/[id]' | '/invoice/[id]' | '/students/[id]' | '/manage/family/[id]' | '/manage/tutor/[id]'; id: string };

/** The record whose screen shows an event, if there is one. */
function auditTarget(e: AuditEvent): AuditTarget | null {
  const own = e.rowId && e.action !== 'delete' ? e.rowId : undefined;
  const at = (pathname: AuditTarget['pathname'], id: string | undefined): AuditTarget | null => (id ? { pathname, id } : null);
  switch (e.table) {
    case 'lessons':
      return at('/lesson/[id]', own);
    case 'lesson_notes':
    case 'homework':
      return at('/lesson/[id]', rowValue(e, 'lesson_id') ?? e.relatedIds[0]);
    case 'charges':
      // A charge's related ids can also hold its invoice or package, so only its own lesson_id names the lesson.
      return at('/lesson/[id]', rowValue(e, 'lesson_id'));
    case 'invoices':
      return at('/invoice/[id]', own);
    case 'payments':
      return at('/invoice/[id]', rowValue(e, 'invoice_id') ?? e.relatedIds[0]);
    case 'students':
      return at('/students/[id]', own);
    case 'families':
      return at('/manage/family/[id]', own);
    case 'tutors':
      return at('/manage/tutor/[id]', own);
    default:
      return null;
  }
}

/** The screen that shows the record an event belongs to, if there is one. */
export function auditHref(e: AuditEvent): Href | null {
  const t = auditTarget(e);
  return t ? ({ pathname: t.pathname, params: { id: t.id } } as Href) : null;
}

/** The icon for an event's kind of record. */
function auditIcon(table: string): IconName {
  if (table.startsWith('lesson') || table === 'homework') return 'event';
  if (['invoices', 'payments', 'charges', 'packages', 'credit_notes', 'refunds'].includes(table)) return 'receipt_long';
  if (['families', 'family_contacts', 'students', 'enrolments'].includes(table)) return 'group';
  if (table.startsWith('tutor') || table === 'opportunities') return 'person';
  if (table === 'settings' || table === 'services') return 'settings';
  if (table === 'student_reports') return 'description';
  if (table === 'admissions_cases') return 'travel_explore';
  return 'history';
}

/** Everything a row says, for screen readers: the sentence, the record, each change, when and who. */
export function auditA11yLabel(e: AuditEvent, d: { summary: string; context?: string; changes: string[] }): string {
  const parts = [d.summary, d.context, ...d.changes, `${formatDate(e.at)}, ${formatTime(e.at)}`, auditRoleLabel(e)];
  return parts
    .filter((p): p is string => !!p)
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join(' ');
}

/** Names for the descriptions, with actors told apart when two share a first name. */
function useAuditNames(enabled: boolean): AuditNames {
  const lookup = useLookup();
  const actors = useAuditActors(enabled);
  return useMemo(() => ({ ...auditNamesFrom(lookup), actorLabel: actorLabeller(actors.data ?? []) }), [lookup, actors.data]);
}

function pluralChanges(n: number, more: boolean): string {
  if (more) return `Showing the latest ${n} ${n === 1 ? 'change' : 'changes'}`;
  return `Showing ${n} ${n === 1 ? 'change' : 'changes'}`;
}

// ---------------------------------------------------------------------------
// One event
// ---------------------------------------------------------------------------

export function AuditEventRow({
  event,
  names,
  showLink,
  showContext = true,
  timeOnly,
}: {
  event: AuditEvent;
  names: AuditNames;
  showLink?: boolean;
  /** Show which record the event is about (off on that record's own screen). */
  showContext?: boolean;
  /** Only the time on the meta line, under a heading that already gives the day. */
  timeOnly?: boolean;
}) {
  const theme = useTheme();
  const d = useMemo(() => describeAuditEvent(event, names), [event, names]);
  const context = showContext ? d.context : undefined;
  const href = showLink ? auditHref(event) : null;
  const body = (
    <Row gap={14} style={{ alignItems: 'flex-start', flex: 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body">{d.summary}</Txt>
        {context ? <Txt variant="small">{context}</Txt> : null}
        {d.changes.map((c, i) => (
          <Txt key={i} variant="muted">
            {c}
          </Txt>
        ))}
        <Row gap={Spacing.one} wrap style={{ marginTop: 2 }}>
          <Txt variant="small">{timeOnly ? `${formatTime(event.at)} ·` : `${formatDate(event.at)}, ${formatTime(event.at)} ·`}</Txt>
          <Txt variant="label">{auditRoleLabel(event)}</Txt>
        </Row>
      </View>
      {href ? (
        <View style={{ paddingTop: 9 }}>
          <Icon name="chevron_right" size={20} color={theme.chevron} />
        </View>
      ) : null}
    </Row>
  );
  // The icon sits outside the link, so the link's text (and its accessible name) starts with the sentence.
  const icon = <IconCircle icon={auditIcon(event.table)} tone={event.actorId || event.actorRole ? 'gold' : 'neutral'} />;
  if (!href) {
    return (
      <View style={[styles.row, styles.withIcon]}>
        {icon}
        {body}
      </View>
    );
  }
  return (
    <View style={[styles.withIcon, { paddingLeft: 18 }]}>
      <View style={{ paddingTop: 14 }}>{icon}</View>
      <Pressable
        onPress={() => router.push(href)}
        accessibilityRole="link"
        accessibilityLabel={auditA11yLabel(event, { ...d, context })}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.row,
          { flex: 1, paddingLeft: 0 },
          (pressed || hovered) && { backgroundColor: theme.rowHover },
        ]}>
        {body}
      </Pressable>
    </View>
  );
}

/** Events in one list card (a Group), separated by row dividers, under an optional day heading. */
function EventList({
  events,
  names,
  showLink,
  showContext,
  timeOnly,
  title,
}: {
  events: AuditEvent[];
  names: AuditNames;
  showLink: (e: AuditEvent) => boolean;
  showContext: (e: AuditEvent) => boolean;
  timeOnly?: boolean;
  title?: string;
}) {
  return (
    <Group title={title}>
      {events.map((e) => (
        <AuditEventRow key={e.id} event={e} names={names} showLink={showLink(e)} showContext={showContext(e)} timeOnly={timeOnly} />
      ))}
    </Group>
  );
}

const always = () => true;

// ---------------------------------------------------------------------------
// History on a record's screen (admins only)
// ---------------------------------------------------------------------------

/** The latest changes to one record, at the foot of its screen. Renders nothing for anyone but an admin. */
export function HistorySection({ filter, title = 'History' }: { filter: AuditFilter; title?: string }) {
  const me = useMe();
  const isAdmin = me.role === 'admin';
  const names = useAuditNames(isAdmin);
  const history = useAuditHistory(filter, 5, isAdmin);
  if (!isAdmin) return null;
  const events = history.data?.pages.flatMap((p) => p.events) ?? [];
  // The record this screen shows: its own events need no link or context; anything else (a lesson on a family's
  // screen, say) links to its own screen and says which record it is about.
  const screenId = filter.entityId ?? filter.familyId ?? filter.studentId ?? filter.tutorId;
  const entity = filter.entityId;
  const showLink = (e: AuditEvent) => {
    const t = auditTarget(e);
    return !!t && t.id !== screenId;
  };
  const showContext = (e: AuditEvent) => !entity || (e.rowId !== entity && !e.relatedIds.includes(entity));
  return (
    <View style={{ gap: 12 }}>
      {history.isLoading ? (
        <Loading />
      ) : history.isError ? (
        <Group title={title} note="The history could not be loaded just now." />
      ) : events.length === 0 ? (
        <Group title={title} note="No changes have been recorded yet." />
      ) : (
        <>
          <EventList title={title} events={events} names={names} showLink={showLink} showContext={showContext} />
          {history.hasNextPage ? (
            <View style={{ flexDirection: 'row' }}>
              <Button title="Show earlier changes" variant="secondary" size="sm" loading={history.isFetchingNextPage} onPress={() => history.fetchNextPage()} />
            </View>
          ) : null}
        </>
      )}
    </View>
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

/** Who the Activity log is filtered to: everyone, one person, or automatic changes. */
export type PersonFilter = { kind: 'everyone' } | { kind: 'actor'; id: string; name: string } | { kind: 'system' };

const ROLE_GROUPS: { role: string; label: string }[] = [
  { role: 'admin', label: 'Staff' },
  { role: 'tutor', label: 'Tutors' },
  { role: 'parent', label: 'Families' },
  { role: 'student', label: 'Students' },
];
/** People shown per group before a search narrows the list. */
const GROUP_PREVIEW = 6;

/** The people in the trail grouped by role, matching `query` (case-insensitive, any part of the name). */
export function groupAuditActors(actors: readonly AuditActor[], query: string) {
  const q = query.trim().toLowerCase();
  const known = new Set(ROLE_GROUPS.map((g) => g.role));
  return [...ROLE_GROUPS, { role: 'other', label: 'Others' }]
    .map((g) => ({
      ...g,
      people: actors
        .filter((a) => (g.role === 'other' ? !known.has(a.role) : a.role === g.role))
        .filter((a) => !q || a.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.people.length > 0);
}

function personLabel(p: PersonFilter): string {
  return p.kind === 'everyone' ? 'Everyone' : p.kind === 'system' ? 'The system' : p.name;
}

/** A compact person filter: one control that opens a searchable list grouped by role. */
function PersonPicker({ value, onChange, actors }: { value: PersonFilter; onChange: (p: PersonFilter) => void; actors: AuditActor[] }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupAuditActors(actors, query), [actors, query]);
  const searching = query.trim().length > 0;
  const choose = (p: PersonFilter) => {
    onChange(p);
    setOpen(false);
    setQuery('');
  };
  const option = (key: string, label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.option, { borderColor: selected ? theme.gold : 'transparent' }, pressed && { opacity: 0.75 }]}>
      <Txt variant="body" style={selected ? font('sans', 'bold') : undefined}>
        {label}
      </Txt>
      {selected ? <Icon name="check" size={16} color={theme.gold} /> : null}
    </Pressable>
  );
  return (
    <View style={{ gap: Spacing.two }}>
      <FilterButton label="Person" value={personLabel(value)} open={open} onPress={() => setOpen(!open)} />
      {open ? (
        <Card style={{ gap: Spacing.two }}>
          <Field label="Search people" placeholder="Type a name" value={query} onChangeText={setQuery} autoCorrect={false} />
          <View>
            {option('everyone', 'Everyone', value.kind === 'everyone', () => choose({ kind: 'everyone' }))}
            {option('system', 'The system (automatic changes)', value.kind === 'system', () => choose({ kind: 'system' }))}
          </View>
          {groups.map((g) => {
            const shown = searching ? g.people : g.people.slice(0, GROUP_PREVIEW);
            const hidden = g.people.length - shown.length;
            return (
              <View key={g.role} style={{ gap: 2 }}>
                <Txt variant="label">{g.label}</Txt>
                {shown.map((a) =>
                  option(a.id, a.name, value.kind === 'actor' && value.id === a.id, () => choose({ kind: 'actor', id: a.id, name: a.name })),
                )}
                {hidden > 0 ? <Txt variant="small">{`${hidden} more. Type a name to find them.`}</Txt> : null}
              </View>
            );
          })}
          {searching && groups.length === 0 ? <Txt variant="muted">Nobody by that name has made a change.</Txt> : null}
        </Card>
      ) : null}
    </View>
  );
}

/** A labelled control showing the current choice, with a chevron that turns when open. */
function FilterButton({ label, value, open, onPress }: { label: string; value: string; open: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [
        styles.filterButton,
        { borderColor: open ? theme.gold : theme.border, backgroundColor: theme.surface },
        pressed && { borderColor: theme.gold },
      ]}>
      <Txt variant="label">{label}</Txt>
      <Txt variant="body" numberOfLines={1} style={{ flex: 1 }}>
        {value}
      </Txt>
      <View style={{ transform: [{ rotate: open ? '270deg' : '90deg' }] }}>
        <Icon name="chevron" size={16} color={theme.textMuted} />
      </View>
    </Pressable>
  );
}

/** Wide enough to show the Type and Date filters without folding them away. */
const WIDE = 760;

export function ActivityLog() {
  const me = useMe();
  const isAdmin = me.role === 'admin';
  const names = useAuditNames(isAdmin);
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const [now] = useState(() => new Date());
  const [person, setPerson] = useState<PersonFilter>({ kind: 'everyone' });
  const [group, setGroup] = useState<string | undefined>();
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState<string | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filter = useMemo<AuditFilter>(
    () => ({
      actorId: person.kind === 'actor' ? person.id : undefined,
      actorRole: person.kind === 'system' ? 'system' : undefined,
      tables: group ? AUDIT_TYPE_GROUPS.find((g) => g.key === group)?.tables : undefined,
      from,
    }),
    [person, group, from],
  );
  const actors = useAuditActors(isAdmin);
  const history = useAuditHistory(filter, 30, isAdmin);

  if (!isAdmin) {
    return (
      <Screen topInset>
        <Stack.Screen options={{ headerShown: false }} />
        <PageHeader back={{ fallback: '/' }} kicker="Business" title="Activity log" />
        <EmptyState icon="alert" title="Administrators only" message="The activity log is available to administrators of Elite Education." />
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

  const typeLabel = AUDIT_TYPE_GROUPS.find((g) => g.key === group)?.label ?? 'All types';
  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? 'All time';
  const typeAndDate = (
    <View style={{ gap: Spacing.three }}>
      <View style={{ gap: Spacing.two }}>
        <Txt variant="label">Type</Txt>
        <Row gap={Spacing.two} wrap>
          <Chip label="All" selected={!group} onPress={() => setGroup(undefined)} />
          {AUDIT_TYPE_GROUPS.map((g) => (
            <Chip key={g.key} label={g.label} selected={group === g.key} onPress={() => setGroup(group === g.key ? undefined : g.key)} />
          ))}
        </Row>
      </View>
      <View style={{ gap: Spacing.two }}>
        <Txt variant="label">Date</Txt>
        <Segmented
          value={period}
          options={PERIODS}
          onChange={(p) => {
            setPeriod(p);
            setFrom(periodStart(p, new Date()));
          }}
        />
      </View>
    </View>
  );

  return (
    <Screen topInset onRefresh={() => history.refetch()} refreshing={history.isRefetching && !history.isFetchingNextPage}>
      <Stack.Screen options={{ headerShown: false, title: 'Activity log' }} />
      <PageHeader
        back={{ fallback: '/admin' }}
        kicker="Business"
        title="Activity log"
        sub="Who changed what, and when: every change to lessons, billing, families and tutors, newest first."
      />

      <View style={{ gap: Spacing.two }}>
        <PersonPicker value={person} onChange={setPerson} actors={actors.data ?? []} />
        {wide ? (
          typeAndDate
        ) : (
          <>
            <FilterButton
              label="Filters"
              value={`${typeLabel} · ${periodLabel}`}
              open={filtersOpen}
              onPress={() => setFiltersOpen(!filtersOpen)}
            />
            {filtersOpen ? <Card>{typeAndDate}</Card> : null}
          </>
        )}
      </View>

      {history.isLoading ? (
        <Loading />
      ) : history.isError ? (
        <EmptyState icon="alert" title="The activity log could not be loaded" message="Please pull down to try again." />
      ) : events.length === 0 ? (
        <EmptyState icon="clock" title="Nothing matches these filters" message="Try a wider date range or another person." />
      ) : (
        <View style={{ gap: 26 }}>
          <Txt variant="note">{pluralChanges(events.length, !!history.hasNextPage)}</Txt>
          {days.map((d) => (
            <EventList key={d.key} title={d.label} events={d.events} names={names} showLink={always} showContext={always} timeOnly />
          ))}
          {history.hasNextPage ? (
            <Actions>
              <Button title="Load more" variant="secondary" loading={history.isFetchingNextPage} onPress={() => history.fetchNextPage()} />
            </Actions>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 14, paddingHorizontal: 18 },
  withIcon: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderLeftWidth: 2,
    minHeight: 44,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
  },
});
