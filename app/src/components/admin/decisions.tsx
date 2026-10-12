/**
 * Today's "For your decision": every item the old "Needs attention" list showed, as cards. A card carries an action
 * only where the data layer already has one (approve or decline a lesson request, approve tutor invoices, approve a
 * student report); everything else opens the right screen. Nothing here sends reminders, snoozes or undoes.
 */
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { font } from '@/constants/theme';
import { source } from '@/data';
import {
  useAbsences,
  useAction,
  useApplications,
  useBids,
  useBusyBlocks,
  useEnquiries,
  useInvoices,
  useLessons,
  useLookup,
  useOpportunities,
  usePackages,
  useRequests,
  useStudentReports,
  useTutorCompliance,
  useTutorInvoices,
} from '@/data/hooks';
import { useViewing } from '@/data/session';
import { displayStatus, formatAED, invoiceTotals, packageRemaining } from '@/domain/billing';
import { addDays, formatDay, formatTime, relativeDay, startOfDay, toDateKey } from '@/domain/dates';
import { joinNames } from '@/domain/greeting';
import { findBusyClashes, findClashes, lessonsDuringAbsence } from '@/domain/scheduling';
import { withoutSpam } from '@/domain/spam';
import { tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { LessonRequest, StudentReport, TutorCompliance } from '@/domain/types';
import { needsAttention } from '@/domain/vetting';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { plural } from '@/lib/id';

import { Icon } from '../icon';
import { useAtRisk } from '../insights';
import { ErrorNote, useToast } from '../ui';
import { PillButton } from './kit';

type Tone = 'bad' | 'warn' | 'gold' | 'neutral';

interface DecisionAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  /** Changes data (hidden while viewing as someone else). Links are always shown. */
  writes?: boolean;
}

export interface Decision {
  key: string;
  kind: string;
  tone: Tone;
  when?: string;
  title: string;
  body?: string;
  primary: DecisionAction;
  secondary?: DecisionAction;
}

/** Show up to this many cards of one kind, then a single "and N more" card. */
const PER_KIND = 3;

const open = (href: Href) => () => router.push(href);
const firstName = (name?: string) => name?.split(' ')[0] ?? '';
/** "September" for a tutor invoice's month. */
const periodLabel = (i: { periodStart: string }) => new Date(`${i.periodStart}T12:00:00`).toLocaleDateString('en-GB', { month: 'long' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const excerpt = (s: string | undefined, n = 150) => (!s ? undefined : s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s);

function checkLine(c: TutorCompliance): string {
  switch (c.vettingStatus) {
    case 'missing':
      return 'police clearance missing';
    case 'pending':
      return 'police clearance awaiting review';
    case 'expired':
      return 'police clearance expired';
    case 'expiring':
      return 'police clearance expiring soon';
    default:
      return c.documentsPending === 1 ? 'a document awaiting review' : `${c.documentsPending} documents awaiting review`;
  }
}

/** Cards for the items of one kind, the first few in full and then one card that opens the list. */
function capped<T>(items: T[], card: (t: T) => Decision, more: (rest: number) => Decision): Decision[] {
  if (items.length <= PER_KIND) return items.map(card);
  return [...items.slice(0, PER_KIND - 1).map(card), more(items.length - (PER_KIND - 1))];
}

/** Every open decision, in the order the office usually works through them. */
export function useDecisions(): { items: Decision[]; ready: boolean; error: unknown } {
  const lookup = useLookup();
  const toast = useToast();
  const [now] = useState(() => new Date());
  const today = startOfDay(now);
  const recent = useLessons(addDays(today, -30), addDays(today, 1));
  const upcoming = useLessons(today, addDays(today, 60));
  const busy = useBusyBlocks(today, addDays(today, 60));
  const requests = useRequests();
  const absences = useAbsences();
  const tutorInvoices = useTutorInvoices();
  const reports = useStudentReports();
  const compliance = useTutorCompliance();
  const enquiries = useEnquiries();
  const invoices = useInvoices();
  const packages = usePackages();
  const opportunities = useOpportunities();
  const bids = useBids();
  const applications = useApplications();
  const atRisk = useAtRisk();
  const decide = useAction(source.decideRequest);
  const review = useAction(source.reviewTutorInvoice);
  const setReport = useAction(source.setReportStatus);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const items = useMemo(() => {
    const out: Decision[] = [];
    const tutorName = (id: string) => lookup.tutor(id)?.fullName ?? 'A tutor';
    const familyName = (id: string) => lookup.family(id)?.name ?? 'A';

    // Cover: lessons booked while their tutor is away.
    const coverByTutor = new Map<string, string[]>();
    for (const a of absences.data ?? []) {
      const ls = lessonsDuringAbsence(a, upcoming.data ?? []);
      if (!ls.length) continue;
      coverByTutor.set(a.tutorId, [...(coverByTutor.get(a.tutorId) ?? []), ...ls.map((l) => l.id)]);
    }
    for (const a of absences.data ?? []) {
      const ids = coverByTutor.get(a.tutorId);
      if (!ids?.length) continue;
      coverByTutor.delete(a.tutorId);
      const lessons = (upcoming.data ?? []).filter((l) => ids.includes(l.id)).sort((x, y) => x.start.localeCompare(y.start));
      const range = a.startDate === a.endDate ? `on ${formatDay(`${a.startDate}T12:00:00`)}` : `from ${formatDay(`${a.startDate}T12:00:00`)} to ${formatDay(`${a.endDate}T12:00:00`)}`;
      out.push({
        key: `cover-${a.tutorId}`,
        kind: 'Cover needed',
        tone: 'bad',
        when: relativeDay(lessons[0].start, now),
        title: `${tutorName(a.tutorId)} is away ${range}.`,
        body: `${cap(plural(lessons.length, 'lesson'))} ${lessons.length === 1 ? 'needs' : 'need'} a cover tutor. Choose one on the lesson, where each tutor's police clearance is shown.`,
        primary: { label: 'Choose a cover tutor', onPress: open({ pathname: '/lesson/[id]', params: { id: lessons[0].id } }) },
      });
    }

    // Lesson requests: approve or decline here, with the same clash checks as the requests screen.
    const pending = (requests.data ?? []).filter((r) => r.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const requestCard = (r: LessonRequest): Decision => {
      const student = lookup.student(r.studentId)?.fullName;
      const original = r.lessonId ? (upcoming.data ?? []).find((l) => l.id === r.lessonId) : undefined;
      const clash = findClashes({ start: new Date(r.start), end: new Date(r.end), tutorId: r.tutorId, studentIds: [r.studentId], ignoreLessonId: r.lessonId }, upcoming.data ?? []);
      const gBusy = findBusyClashes({ start: new Date(r.start), end: new Date(r.end), tutorId: r.tutorId }, busy.data ?? []);
      const at = `${relativeDay(r.start, now).replace(/^(Today|Tomorrow)$/, (m) => m.toLowerCase())} at ${formatTime(r.start)}`;
      const subject = r.subject ? `${r.subject} ` : '';
      const title =
        r.kind === 'reschedule'
          ? `The ${familyName(r.familyId)} family would like to move ${firstName(student)}’s ${subject}lesson${original ? ` on ${formatDay(original.start)}` : ''} to ${at}.`
          : `The ${familyName(r.familyId)} family would like an extra ${subject}lesson for ${firstName(student)}, ${at}.`;
      const tutor = firstName(tutorName(r.tutorId));
      const body = [
        clash.length
          ? 'This now clashes with another lesson, so it cannot be approved as it stands. Decline it and suggest another time.'
          : gBusy.length
            ? `Nothing clashes in the diary, but Google Calendar shows ${tutor} as busy then. Please check with them before approving.`
            : `With ${tutor}. Nothing clashes in the diary.`,
        r.note ? `“${r.note}”` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const key = `req-${r.id}`;
      const run = (approve: boolean) => async () => {
        setBusyKey(key);
        try {
          await decide.mutateAsync([r.id, approve]);
          toast(approve ? `Approved. ${firstName(student)}’s lesson is booked for ${formatDay(r.start)} at ${formatTime(r.start)}.` : 'Request declined.');
        } finally {
          setBusyKey(null);
        }
      };
      return {
        key,
        kind: 'Lesson request',
        tone: 'warn',
        when: relativeDay(r.createdAt, now),
        title,
        body,
        primary: {
          label: r.kind === 'reschedule' ? 'Approve the change' : 'Approve',
          writes: true,
          disabled: clash.length > 0,
          busy: busyKey === key,
          onPress: () => confirm('Approve this request?', `${firstName(student)}’s lesson will be booked for ${formatDay(r.start)} at ${formatTime(r.start)}.`, run(true), 'Approve'),
        },
        secondary: {
          label: 'Decline',
          writes: true,
          busy: busyKey === key,
          onPress: () => confirm('Decline this request?', 'To suggest another time instead, open Lesson requests and add a reply.', run(false), 'Decline'),
        },
      };
    };
    out.push(
      ...capped(pending, requestCard, (rest) => ({
        key: 'req-more',
        kind: 'Lesson requests',
        tone: 'warn',
        title: `${cap(plural(rest, 'more lesson request'))} to decide.`,
        primary: { label: 'Open lesson requests', onPress: open('/manage/requests') },
      })),
    );

    // Tutor invoices submitted for approval.
    const submitted = (tutorInvoices.data ?? []).filter((i) => i.status === 'submitted');
    if (submitted.length) {
      const total = submitted.reduce((s, i) => s + tutorInvoiceTotal(i.items), 0);
      const months = [...new Set(submitted.map((i) => periodLabel(i)))];
      const one = submitted.length === 1 ? submitted[0] : undefined;
      const approveAll = async () => {
        setBusyKey('tinv');
        try {
          for (const i of submitted) await review.mutateAsync([i.id, true]);
          toast(one ? `${tutorName(one.tutorId)}’s invoice is approved for payment.` : `${submitted.length} tutor invoices approved for payment.`);
        } finally {
          setBusyKey(null);
        }
      };
      out.push({
        key: 'tinv',
        kind: 'Tutor invoices',
        tone: 'warn',
        when: relativeDay(submitted.map((i) => i.submittedAt ?? i.createdAt).sort()[0], now),
        title: one
          ? `${tutorName(one.tutorId)}’s ${periodLabel(one)} invoice for ${formatAED(tutorInvoiceTotal(one.items))}.`
          : `${cap(plural(submitted.length, `${months.length === 1 ? `${months[0]} ` : ''}invoice`))} totalling ${formatAED(total)}.`,
        body: one ? 'Check the hours against the lessons recorded, then approve it for payment.' : `${joinNames(submitted.map((i) => firstName(tutorName(i.tutorId))))}. Check the hours against the lessons recorded.`,
        primary: {
          label: one ? 'Approve' : `Approve all ${submitted.length}`,
          writes: true,
          busy: busyKey === 'tinv',
          onPress: () =>
            confirm(
              one ? 'Approve this invoice?' : `Approve ${submitted.length} invoices?`,
              submitted.map((i) => `${tutorName(i.tutorId)} · ${periodLabel(i)} · ${formatAED(tutorInvoiceTotal(i.items))}`).join('\n'),
              () => void approveAll(),
              'Approve',
            ),
        },
        secondary: one
          ? { label: 'Review', onPress: open({ pathname: '/tutor-invoices/[id]', params: { id: one.id } }) }
          : { label: 'Review each', onPress: open('/manage/tutor-invoices') },
      });
    }

    // Student reports submitted by tutors: approve here (they go to families later, from Student reports).
    const toReview = (reports.data ?? []).filter((r) => r.status === 'submitted').sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
    const reportCard = (r: StudentReport): Decision => {
      const key = `rep-${r.id}`;
      return {
        key,
        kind: 'Student report',
        tone: 'gold',
        when: r.submittedAt ? relativeDay(r.submittedAt, now) : undefined,
        title: `${tutorName(r.tutorId)}’s ${r.subject ? `${r.subject} ` : ''}report for ${lookup.student(r.studentId)?.fullName ?? 'a student'}.`,
        body: excerpt(r.comment || r.strengths) ?? 'Read it before approving; families see it once the round is sent.',
        primary: {
          label: 'Approve',
          writes: true,
          busy: busyKey === key,
          onPress: () =>
            confirm('Approve this report?', 'It waits in Student reports until you send the round to families.', async () => {
              setBusyKey(key);
              try {
                await setReport.mutateAsync([r.id, 'approved']);
                toast('Report approved. Send it to the family from Student reports.');
              } finally {
                setBusyKey(null);
              }
            }, 'Approve'),
        },
        secondary: { label: 'Read in full', onPress: open({ pathname: '/reports/[id]', params: { id: r.id } }) },
      };
    };
    out.push(
      ...capped(toReview, reportCard, (rest) => ({
        key: 'rep-more',
        kind: 'Student reports',
        tone: 'gold',
        title: `${cap(plural(rest, 'more report'))} to review.`,
        body: 'Approve them before they are sent to families.',
        primary: { label: 'Review reports', onPress: open('/manage/reports') },
      })),
    );

    // Tutor checks (police clearance and documents).
    const checks = needsAttention(compliance.data ?? []);
    if (checks.length) {
      out.push({
        key: 'checks',
        kind: 'Tutor checks',
        tone: checks.some((c) => c.vettingStatus === 'expired' || c.vettingStatus === 'missing') ? 'bad' : 'warn',
        title: `${cap(plural(checks.length, 'tutor check'))} to review.`,
        body: checks.map((c) => `${tutorName(c.tutorId)}: ${checkLine(c)}`).join(' · '),
        primary: { label: 'Review checks', onPress: open('/manage/vetting') },
      });
    }

    // New enquiries (possible spam is held back and mentioned separately).
    const newEnquiries = withoutSpam(enquiries.data ?? [])
      .filter((e) => e.status === 'new')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    out.push(
      ...capped(
        newEnquiries,
        (e) => ({
          key: `enq-${e.id}`,
          kind: 'New enquiry',
          tone: 'gold',
          when: relativeDay(e.lastSubmittedAt ?? e.createdAt, now),
          title: `${e.parentName}${e.studentName ? `, for ${e.studentName}` : ''}.`,
          body:
            [[e.subject, e.curriculum, e.yearGroup ?? e.phase].filter(Boolean).join(' · '), e.preferredTimes, e.repeatCount ? `Received ${e.repeatCount + 1} times.` : '']
              .filter(Boolean)
              .join('. ') || undefined,
          primary: { label: 'Open enquiry', onPress: open({ pathname: '/manage/enquiry/[id]', params: { id: e.id } }) },
        }),
        (rest) => ({
          key: 'enq-more',
          kind: 'Enquiries',
          tone: 'gold',
          title: `${cap(plural(rest, 'more new enquiry', 'more new enquiries'))}.`,
          primary: { label: 'Open enquiries', onPress: open('/manage/enquiries') },
        }),
      ),
    );

    // Enquiries due a follow-up today.
    const followUps = withoutSpam(enquiries.data ?? []).filter(
      (e) => e.nextActionAt && e.nextActionAt <= toDateKey(now) && (e.status === 'contacted' || e.status === 'trial-booked'),
    );
    if (followUps.length) {
      out.push({
        key: 'follow',
        kind: 'Follow up',
        tone: 'warn',
        when: 'Today',
        title: `${cap(plural(followUps.length, 'enquiry', 'enquiries'))} to follow up today.`,
        body: joinNames(followUps.map((e) => e.parentName)),
        primary: {
          label: followUps.length === 1 ? `Open ${firstName(followUps[0].parentName)}’s enquiry` : 'Open the first',
          onPress: open({ pathname: '/manage/enquiry/[id]', params: { id: followUps[0].id } }),
        },
        secondary: followUps.length > 1 ? { label: 'All enquiries', onPress: open('/manage/enquiries') } : undefined,
      });
    }

    // Overdue invoices: record a payment (amount and method) on the invoice itself.
    const overdue = (invoices.data ?? [])
      .filter((i) => i.status === 'sent' && displayStatus(i, now) === 'overdue')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    out.push(
      ...capped(
        overdue,
        (i) => {
          const days = Math.max(1, Math.round((today.getTime() - startOfDay(new Date(`${i.dueDate}T12:00:00`)).getTime()) / 86_400_000));
          return {
            key: `od-${i.id}`,
            kind: 'Overdue',
            tone: 'bad',
            when: plural(days, 'day'),
            title: `${i.number} for the ${familyName(i.familyId)} family is ${plural(days, 'day')} overdue.`,
            body: `${formatAED(invoiceTotals(i).balance)} outstanding.`,
            primary: { label: 'Open invoice', onPress: open({ pathname: '/invoice/[id]', params: { id: i.id } }) },
          };
        },
        (rest) => ({
          key: 'od-more',
          kind: 'Overdue',
          tone: 'bad',
          title: `${cap(plural(rest, 'more overdue invoice'))}.`,
          primary: { label: 'Open the ledger', onPress: () => router.navigate({ pathname: '/admin/billing', params: { filter: 'overdue' } }) },
        }),
      ),
    );

    // Packages nearly used.
    const low = (packages.data ?? []).filter((p) => packageRemaining(p) <= 2);
    out.push(
      ...capped(
        low,
        (p) => {
          const left = packageRemaining(p);
          return {
            key: `pkg-${p.id}`,
            kind: 'Package',
            tone: 'neutral',
            when: left === 0 ? 'Used up' : `${plural(left, 'lesson')} left`,
            title: `The ${familyName(p.familyId)} family’s ${p.name} is ${left === 0 ? 'used up' : 'nearly used'}.`,
            body: 'Offer a top-up before the next lesson.',
            primary: { label: 'Sell a top-up', onPress: open({ pathname: '/manage/package-new', params: { familyId: p.familyId } }) },
          };
        },
        (rest) => ({
          key: 'pkg-more',
          kind: 'Packages',
          tone: 'neutral',
          title: `${cap(plural(rest, 'more package'))} nearly used.`,
          primary: { label: 'Open families', onPress: open('/manage/families') },
        }),
      ),
    );

    // Lessons that ended without attendance and notes.
    const needsNotes = (recent.data ?? []).filter((l) => l.status === 'scheduled' && new Date(l.end) < now).sort((a, b) => a.start.localeCompare(b.start));
    if (needsNotes.length) {
      out.push({
        key: 'notes',
        kind: 'Lesson notes',
        tone: 'warn',
        when: relativeDay(needsNotes[0].start, now),
        title: `${cap(plural(needsNotes.length, 'lesson'))} awaiting notes.`,
        body: 'Record attendance and notes so that families are updated and lessons are billed.',
        primary: { label: 'Open the earliest', onPress: open({ pathname: '/lesson/[id]', params: { id: needsNotes[0].id } }) },
      });
    }

    // Roles with tutors interested.
    const rolesWithBids = (opportunities.data ?? []).filter((o) => o.status === 'open' && (bids.data ?? []).some((b) => b.opportunityId === o.id && b.status === 'pending'));
    if (rolesWithBids.length) {
      out.push({
        key: 'roles',
        kind: 'Roles for tutors',
        tone: 'gold',
        title: `${cap(plural(rolesWithBids.length, 'role'))} with tutors interested.`,
        body: rolesWithBids.map((o) => o.title).join(' · '),
        primary: {
          label: 'Choose a tutor',
          onPress: open(rolesWithBids.length === 1 ? { pathname: '/manage/opportunity/[id]', params: { id: rolesWithBids[0].id } } : '/manage/opportunities'),
        },
      });
    }

    // Tutor applications.
    const newApplications = withoutSpam(applications.data ?? []).filter((a) => a.status === 'applied');
    if (newApplications.length) {
      out.push({
        key: 'apps',
        kind: 'Hiring',
        tone: 'gold',
        title: `${cap(plural(newApplications.length, 'tutor application'))} to review.`,
        body: joinNames(newApplications.map((a) => a.fullName)),
        primary: {
          label: newApplications.length === 1 ? 'Open the application' : 'Review applications',
          onPress: open(newApplications.length === 1 ? { pathname: '/manage/application/[id]', params: { id: newApplications[0].id } } : '/manage/applications'),
        },
      });
    }

    // Students to check on (attendance, homework, progress or unpaid invoices).
    if (atRisk.list.length) {
      const top = atRisk.list.slice(0, 3);
      out.push({
        key: 'risk',
        kind: 'Students to check on',
        tone: atRisk.list.some((r) => r.score >= 60) ? 'bad' : 'warn',
        title: `${cap(plural(atRisk.list.length, 'student'))} to check on.`,
        body: top.map((r) => `${r.student.fullName}: ${r.signals.map((s) => s.label.toLowerCase()).join(', ')}`).join(' · '),
        primary: { label: `Open ${firstName(top[0].student.fullName)}`, onPress: open({ pathname: '/students/[id]', params: { id: top[0].student.id } }) },
        secondary: { label: 'See all in Insights', onPress: open('/manage/insights') },
      });
    }
    return out;
  }, [
    lookup,
    now,
    today,
    absences.data,
    upcoming.data,
    busy.data,
    requests.data,
    tutorInvoices.data,
    reports.data,
    compliance.data,
    enquiries.data,
    invoices.data,
    packages.data,
    recent.data,
    opportunities.data,
    bids.data,
    applications.data,
    atRisk.list,
    busyKey,
    decide,
    review,
    setReport,
    toast,
  ]);

  const ready = lookup.ready && !!requests.data && !!invoices.data && !!tutorInvoices.data && !!recent.data;
  return { items, ready, error: decide.error ?? review.error ?? setReport.error };
}

/** The Today tab's badge: how many decisions are waiting. */
export function useDecisionCount(): number {
  return useDecisions().items.length;
}

/** One decision: tone dot, kind, when, Georgia title, body and up to two pill actions. */
export function DecisionCard({ d }: { d: Decision }) {
  const theme = useTheme();
  const viewing = useViewing();
  const dot = { bad: theme.danger, warn: theme.warning, gold: theme.gold, neutral: theme.textMuted }[d.tone];
  const show = (a?: DecisionAction) => (a && !(a.writes && viewing) ? a : undefined);
  const primary = show(d.primary);
  const secondary = show(d.secondary);
  return (
    <View style={[dc.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={dc.top}>
        <View style={[dc.dot, { backgroundColor: dot }]} />
        <Text style={[font('sans', 'bold'), dc.kind, { color: theme.textMuted }]}>{d.kind}</Text>
        <View style={{ flex: 1 }} />
        {d.when ? <Text style={[font('sans'), { fontSize: 12.5, color: theme.textMuted }]}>{d.when}</Text> : null}
      </View>
      <View style={{ gap: 4 }}>
        <Text style={[font('serif'), { fontSize: 18.5, lineHeight: 24, color: theme.text }]}>{d.title}</Text>
        {d.body ? <Text style={[font('sans'), { fontSize: 14.5, lineHeight: 21, color: theme.textMuted }]}>{d.body}</Text> : null}
      </View>
      {primary || secondary ? (
        <View style={dc.actions}>
          {primary ? <PillButton label={primary.label} onPress={primary.onPress} disabled={primary.disabled} busy={primary.busy} accessibilityLabel={primary.accessibilityLabel} /> : null}
          {secondary ? (
            <PillButton label={secondary.label} variant="secondary" onPress={secondary.onPress} disabled={secondary.disabled} busy={secondary.busy} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** The whole "For your decision" column. */
export function DecisionList({ decisions, error }: { decisions: Decision[]; error?: unknown }) {
  const theme = useTheme();
  if (!decisions.length) {
    return (
      <View style={[dc.clear, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Icon name="check_circle" size={30} color={theme.accent} />
          <Text style={[font('serif'), { fontSize: 21, color: theme.text, textAlign: 'center' }]}>Everything is in order.</Text>
          <Text style={[font('sans'), { fontSize: 14.5, color: theme.textMuted, textAlign: 'center' }]}>No decisions are waiting. New ones will appear here.</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={{ gap: 18 }}>
      <ErrorNote error={error} />
      {decisions.map((d) => (
        <DecisionCard key={d.key} d={d} />
      ))}
    </View>
  );
}

const dc = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  kind: { fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  clear: { borderWidth: 1, borderRadius: 16, paddingVertical: 32, paddingHorizontal: 24 },
});
