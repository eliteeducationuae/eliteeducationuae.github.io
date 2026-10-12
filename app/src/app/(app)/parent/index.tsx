import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { useLessonSubject } from '@/components/lessons';
import { AdmissionsHomeGroup } from '@/components/parent/admissions-group';
import { chipFor, dayMonth, firstName, longDay, placeLabel, shortWhen } from '@/components/parent/format';
import { NextLessonPanel, QuickTiles } from '@/components/parent/home';
import { openMessages, payableInvoices } from '@/components/parent/hooks';
import { Actions, Avatar, Button, Columns, ErrorNote, Group, GroupRow, Hero, Loading, Notice, Screen, useWide } from '@/components/ui';
import { source } from '@/data';
import { useAction, useAnnouncements, useFamilies, useHomework, useInvoices, useLessons, useLookup, useNotes, useRequests, useStudents, type Lookup } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { formatAED, invoiceTotals } from '@/domain/billing';
import { withoutClosed } from '@/domain/closed-accounts';
import { addDays, formatTime, relativeDay, startOfDay, toDateKey } from '@/domain/dates';
import { greetingLine, joinNames } from '@/domain/greeting';
import { autopayHoldsInvoice } from '@/domain/payments';
import { byStart } from '@/domain/scheduling';
import type { Lesson, LessonNote, LessonRequest } from '@/domain/types';
import { isPlaceholderName } from '@/lib/social-auth';

const today = startOfDay(new Date());
const FROM = addDays(today, -60);
const TO = addDays(today, 21);

export default function ParentHome() {
  const me = useMe();
  const viewing = useViewing();
  const wide = useWide();
  const lookup = useLookup();
  const students = useStudents();
  const families = useFamilies();
  const lessons = useLessons(FROM, TO);
  const notes = useNotes();
  const homework = useHomework();
  const invoices = useInvoices();
  const requests = useRequests();
  const announcements = useAnnouncements();
  const [now] = useState(() => new Date());

  if (lessons.isLoading || students.isLoading || !lookup.ready) return <Loading />;
  const family = families.data?.find((f) => f.id === me.familyId);
  const kids = withoutClosed(students.data);
  const several = kids.length > 1;
  const all = lessons.data ?? [];
  const upcoming = all.filter((l) => l.status === 'scheduled' && new Date(l.end) > now).sort(byStart);
  const next = upcoming[0];
  // Money the family is asked to pay: autopay invoices about to be paid from the saved card ask nothing of them.
  const toPay = payableInvoices(invoices.data).filter((i) => !autopayHoldsInvoice(i));
  const due = toPay.reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const allRequests = requests.data ?? [];
  const openRequests = allRequests.filter((r) => r.status === 'pending' || (r.decidedAt && new Date(r.decidedAt) > addDays(now, -3)));
  const latest = announcements.data?.[0];
  const isNew = family?.status === 'prospect' && upcoming.length === 0;
  const name = isPlaceholderName(me.fullName, me.email) ? undefined : firstName(me.fullName);
  const todayKey = toDateKey(now);
  const homeworkDue = (homework.data ?? []).filter((h) => !h.done && h.dueDate >= todayKey).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  // The hero's one line, from what is really there: the next lesson, homework due and money to pay.
  const line = (() => {
    if (!kids.length) return 'Welcome to Elite Education. Add your child and we will arrange a complimentary consultation.';
    if (isNew) return `We will be in touch within one working day to arrange ${joinNames(kids.map((k) => firstName(k.fullName)))}’s complimentary consultation.`;
    const parts: string[] = [];
    if (next) {
      const child = firstName(lookup.student(next.studentIds[0])?.fullName);
      const tutor = firstName(lookup.tutor(next.tutorId)?.fullName);
      const day = shortWhen(next.start, now);
      parts.push(
        day === 'Today'
          ? `${child} has a lesson with ${tutor} at ${formatTime(next.start)} today.`
          : `${child}’s next lesson is with ${tutor} ${day === 'Tomorrow' ? 'tomorrow' : `on ${longDay(next.start)}`} at ${formatTime(next.start)}.`,
      );
    } else parts.push(`Here is the latest for ${joinNames(kids.map((k) => firstName(k.fullName)))}.`);
    if (homeworkDue) {
      const child = firstName(lookup.student(homeworkDue.studentId)?.fullName);
      const when = relativeDay(`${homeworkDue.dueDate}T12:00:00`, now);
      parts.push(`${child}’s homework, “${homeworkDue.title}”, is due ${['Today', 'Tomorrow'].includes(when) ? when.toLowerCase() : `on ${longDay(`${homeworkDue.dueDate}T12:00:00`)}`}.`);
    }
    if (due > 0) parts.push(toPay.length === 1 ? `Invoice ${toPay[0].number} is ready to pay.` : `${toPay.length} invoices are ready to pay.`);
    return parts.join(' ');
  })();

  const avatar = wide ? undefined : (
    <Pressable onPress={() => router.navigate('/parent/account')} accessibilityRole="button" accessibilityLabel="Your account" hitSlop={4}>
      <Avatar name={me.fullName} size={36} />
    </Pressable>
  );

  return (
    <Screen topInset onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <Hero kicker={longDay(now)} title={`${greetingLine(now, name)}.`} line={line} right={avatar} />

      {next && !isNew ? <NextLessonPanel lesson={next} lookup={lookup} now={now} showChild={several} /> : null}

      {kids.length ? (
        <QuickTiles
          tiles={[
            ...(viewing ? [] : [{ icon: 'event_available' as const, label: 'Book', onPress: () => router.push('/book') }]),
            { icon: 'monitoring', label: 'Progress', onPress: () => router.navigate('/parent/progress') },
            { icon: 'credit_card', label: 'Billing', onPress: () => router.navigate('/parent/billing'), dot: due > 0, dotLabel: 'money is due' },
            { icon: 'forum', label: 'Message', onPress: () => openMessages() },
          ]}
        />
      ) : null}

      {kids.length === 0 ? (
        <>
          <Group title="Getting started" note="Please add your child and tell us what they would like support with. We will then arrange a complimentary consultation." />
          {viewing ? null : (
            <Actions>
              <Button title="Add my child" icon="person_add" onPress={() => router.push('/onboarding')} />
            </Actions>
          )}
        </>
      ) : isNew ? (
        <Notice tone="info" icon="favorite" title={`Thank you for adding ${joinNames(kids.map((k) => firstName(k.fullName)))}`}>
          We will be in touch within one working day to arrange a complimentary consultation. You are welcome to message us at any time.
        </Notice>
      ) : null}

      {due > 0 ? (
        <Notice
          tone="warn"
          icon="credit_card"
          title={`${formatAED(due)} is due on your account`}
          link={{
            label: 'View and pay',
            onPress: () => (toPay.length === 1 ? router.push({ pathname: '/invoice/[id]', params: { id: toPay[0].id } }) : router.navigate('/parent/billing')),
          }}>
          {toPay.length === 1
            ? `${toPay[0].number} ${toPay[0].dueDate < todayKey ? 'was' : 'is'} due on ${dayMonth(toPay[0].dueDate)}.`
            : `${toPay.length} invoices are waiting to be paid.`}
        </Notice>
      ) : null}

      <Columns>
        {kids.length && !isNew ? (
          <Group title="Coming up" link={viewing ? undefined : { label: 'Book or change', onPress: () => router.push('/book') }}>
            {upcoming.length ? (
              upcoming.slice(0, 5).map((l) => <ComingUpRow key={l.id} lesson={l} lookup={lookup} now={now} showChild={several} requests={allRequests} />)
            ) : (
              <GroupRow icon="event" title="No lessons booked" note="You can book an additional lesson or send us a message at any time." />
            )}
          </Group>
        ) : kids.length ? (
          <Group title="Upcoming lessons" note="Your child’s first lesson will appear here as soon as it is arranged." />
        ) : null}

        {kids.length && !isNew ? <LatestNotes notes={notes.data ?? []} lessons={all} lookup={lookup} showChild={several} now={now} /> : null}

        {kids.length ? <AdmissionsHomeGroup /> : null}

        {latest ? (
          <Group title="From Elite Education" link={{ label: 'All', onPress: () => router.push('/announcements') }}>
            <GroupRow icon="campaign" title={latest.title} note={clip(latest.body, 180)} onPress={() => router.push('/announcements')} />
          </Group>
        ) : null}

        {openRequests.length ? <RequestsGroup requests={openRequests} lookup={lookup} /> : null}
      </Columns>

      {viewing ? null : (
        <Actions>
          {kids.length ? <Button title={isNew ? 'Add another child' : 'Add a child'} icon="person_add" variant="secondary" onPress={() => router.push('/onboarding')} /> : null}
          <Button title="Message us" icon="forum" variant="secondary" onPress={() => openMessages()} />
        </Actions>
      )}
    </Screen>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s);

function ComingUpRow({ lesson, lookup, now, showChild, requests }: { lesson: Lesson; lookup: Lookup; now: Date; showChild: boolean; requests: LessonRequest[] }) {
  const subject = useLessonSubject(lesson);
  const tutor = firstName(lookup.tutor(lesson.tutorId)?.fullName);
  const child = firstName(lookup.student(lesson.studentIds[0])?.fullName);
  const asked = requests.some((r) => r.status === 'pending' && r.lessonId === lesson.id);
  return (
    <GroupRow
      date={chipFor(lesson.start)}
      title={`${formatTime(lesson.start)} · ${subject ?? 'Lesson'} with ${tutor}`}
      note={[showChild ? child : '', placeLabel(lesson), shortWhen(lesson.start, now)].filter(Boolean).join(' · ')}
      value={asked ? 'Change requested' : undefined}
      valueTone="accent"
      valueSize={12.5}
      onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: lesson.id } })}
    />
  );
}

function LatestNotes({ notes, lessons, lookup, showChild, now }: { notes: LessonNote[]; lessons: Lesson[]; lookup: Lookup; showChild: boolean; now: Date }) {
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const latest = notes
    .filter((n) => byId.has(n.lessonId) && n.summary.trim())
    .sort((a, b) => byId.get(b.lessonId)!.start.localeCompare(byId.get(a.lessonId)!.start))
    .slice(0, 2);
  const tutors = [...new Set(latest.map((n) => byId.get(n.lessonId)!.tutorId))];
  const title = tutors.length === 1 ? `Latest from ${firstName(lookup.tutor(tutors[0])?.fullName) || 'your tutor'}` : 'Latest lesson notes';
  const toNotes = () => router.navigate({ pathname: '/parent/progress', params: { tab: 'notes' } });
  if (!latest.length) return <Group title="Latest lesson notes" note="Notes from each lesson will appear here as soon as they are written." />;
  return (
    <Group title={title} link={{ label: 'All notes', onPress: toNotes }}>
      {latest.map((n) => {
        const l = byId.get(n.lessonId)!;
        const tutor = lookup.tutor(l.tutorId)?.fullName ?? 'Tutor';
        const child = firstName(lookup.student(l.studentIds[0])?.fullName);
        return (
          <GroupRow
            key={n.lessonId}
            avatar={tutor}
            title={[showChild ? child : '', shortWhen(l.start, now), l.subject].filter(Boolean).join(' · ')}
            note={clip(n.summary, 200)}
            onPress={toNotes}
          />
        );
      })}
    </Group>
  );
}

const REQUEST_WORDS: Record<LessonRequest['status'], string> = {
  pending: 'Waiting for the office to confirm',
  approved: 'Confirmed',
  declined: 'Not possible',
  withdrawn: 'Withdrawn',
};

function RequestsGroup({ requests, lookup }: { requests: LessonRequest[]; lookup: Lookup }) {
  const viewing = useViewing();
  const withdraw = useAction(source.withdrawRequest);
  return (
    <Group title="Your requests">
      {requests.map((r) => {
        const child = firstName(lookup.student(r.studentId)?.fullName);
        const when = `${relativeDay(r.start)} at ${formatTime(r.start)}`;
        return (
          <GroupRow
            key={r.id}
            icon={r.status === 'pending' ? 'hourglass_top' : r.status === 'approved' ? 'check_circle' : 'close'}
            tone={r.status === 'approved' ? 'good' : r.status === 'pending' ? 'gold' : 'neutral'}
            title={`${r.kind === 'reschedule' ? 'Move a lesson' : 'Additional lesson'} · ${child} · ${when}`}
            note={[REQUEST_WORDS[r.status], r.response ? `“${r.response}”` : ''].filter(Boolean).join(' · ')}
            action={
              r.status === 'pending' && !viewing
                ? { label: 'Withdraw', onPress: () => withdraw.mutate([r.id]), accessibilityLabel: `Withdraw the request for ${when}` }
                : undefined
            }
          />
        );
      })}
      {withdraw.error ? <ErrorNote error={withdraw.error} /> : null}
    </Group>
  );
}
