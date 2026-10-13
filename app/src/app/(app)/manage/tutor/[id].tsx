import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { NoHeader, VETTING_TAG } from '@/components/admin-people/kit';
import { AdminIcsResetActions } from '@/components/calendar-sync';
import { HistorySection } from '@/components/history';
import { LoginHint } from '@/components/login-hint';
import { useComplianceFor, useToday } from '@/components/vetting';
import { Actions, Button, Columns, EmptyState, Figure, Figures, Group, GroupRow, Loading, Notice, PageHeader, Screen } from '@/components/ui';
import { ViewAsActions } from '@/components/view-as';
import { useEnrolments, useLessons, useLoginEmails, useLookup, useSettings, useTutors } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED, tutorEarnings } from '@/domain/billing';
import { isClosed } from '@/domain/closed-accounts';
import { addDays, formatDate, formatDay, formatMonth, formatTime, minutesBetween, startOfMonth } from '@/domain/dates';
import type { Tutor } from '@/domain/types';
import { onboardingChecklist, onboardingProgress, vettingSummary } from '@/domain/vetting';
import { useTheme } from '@/hooks/use-theme';

/**
 * Admin: one tutor, read only. This month's teaching and pay, police clearance and onboarding, what they teach,
 * View as, the calendar link and the history. "Edit profile and pay" opens the form.
 */
export default function TutorProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const tutors = useTutors();
  if (tutors.isLoading) return <Loading />;
  const tutor = tutors.data?.find((t) => t.id === id);
  if (me.role !== 'admin' || !tutor) {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/manage/tutors' }} kicker="Team" title="Tutor not found" />
        <EmptyState icon="people" title="Tutor not found" message="They may have been removed, or this page is only available to the Elite Education office." />
      </Screen>
    );
  }
  if (isClosed(tutor)) return <ClosedTutor tutor={tutor} />;
  return <Profile tutor={tutor} />;
}

/**
 * A closed tutor is kept only for past lessons and pay records: nothing to edit and no login to send. Their upcoming
 * lessons are listed so the office can open each one and reassign it.
 */
function ClosedTutor({ tutor }: { tutor: Tutor }) {
  const [range] = useState(() => {
    const from = new Date();
    return { from, to: addDays(from, 366) };
  });
  const lessons = useLessons(range.from, range.to);
  const lookup = useLookup();
  const upcoming = (lessons.data ?? []).filter((l) => l.tutorId === tutor.id && l.status === 'scheduled').sort((a, b) => a.start.localeCompare(b.start));
  const count = upcoming.length;
  return (
    <Screen topInset>
      <NoHeader title={tutor.fullName} />
      <PageHeader back={{ fallback: '/manage/tutors' }} kicker="Closed account" title={tutor.fullName} />
      <Notice tone="info" icon="person">
        {`This tutor’s account was closed on ${formatDate(tutor.deletedAt!)}. Their name, contact details, availability and bank details have been removed. Past lessons and pay records are kept.`}
      </Notice>
      {lessons.isLoading ? (
        <Loading />
      ) : (
        <>
          {count ? (
            <Notice tone="warn" icon="calendar">
              {`${count} upcoming ${count === 1 ? 'lesson needs' : 'lessons need'} another tutor. Open each lesson to reassign it.`}
            </Notice>
          ) : null}
          <Group title="Upcoming lessons" note={count ? undefined : 'No upcoming lessons need another tutor.'}>
            {upcoming.map((l) => (
              <GroupRow
                key={l.id}
                icon="event"
                title={`${formatDay(l.start)} at ${formatTime(l.start)}`}
                note={[l.subject, l.studentIds.map((sid) => lookup.student(sid)?.fullName).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: l.id } })}
              />
            ))}
          </Group>
        </>
      )}
    </Screen>
  );
}

function Profile({ tutor }: { tutor: Tutor }) {
  const theme = useTheme();
  const today = useToday();
  const settings = useSettings();
  const enrolments = useEnrolments();
  const lookup = useLookup();
  const logins = new Set(useLoginEmails().data ?? []);
  const { compliance: c } = useComplianceFor(tutor.id);
  const [month] = useState(() => {
    const from = startOfMonth(new Date());
    return { from, to: new Date(from.getFullYear(), from.getMonth() + 1, 1) };
  });
  const lessons = useLessons(month.from, month.to);
  const mine = (lessons.data ?? []).filter((l) => l.tutorId === tutor.id && l.status !== 'cancelled' && l.status !== 'late-cancel');
  const booked = mine.reduce((n, l) => n + minutesBetween(new Date(l.start), new Date(l.end)), 0) / 60;
  const earned = settings.data ? tutorEarnings(tutor, lessons.data ?? [], settings.data, enrolments.data ?? []) : undefined;
  const students = [...new Set((enrolments.data ?? []).filter((e) => e.active && e.tutorId === tutor.id).map((e) => e.studentId))];
  const items = c ? onboardingChecklist(c, today) : [];
  const progress = c ? onboardingProgress(items) : undefined;
  const canSignIn = !!tutor.email && logins.has(tutor.email.toLowerCase());
  const first = tutor.fullName.split(' ')[0];
  const vet = c ? VETTING_TAG[c.vettingStatus] : undefined;
  const edit = () => router.push({ pathname: '/manage/tutor-edit', params: { id: tutor.id, edit: '1' } });
  const checks = () => router.push({ pathname: '/manage/vetting/[tutorId]', params: { tutorId: tutor.id } });

  return (
    <Screen topInset>
      <NoHeader title={tutor.fullName} />
      <PageHeader
        back={{ fallback: '/manage/tutors' }}
        kicker={[...new Set(tutor.phases)].join(' · ') || 'Tutor'}
        title={tutor.fullName}
        sub={[tutor.email, tutor.phone].filter(Boolean).join(' · ') || undefined}
      />

      {c && c.vettingStatus !== 'cleared' ? (
        <Notice tone={c.vettingStatus === 'expiring' || c.vettingStatus === 'pending' ? 'warn' : 'danger'} title="Police clearance" link={{ label: 'Open tutor checks', onPress: checks }}>
          {`${vettingSummary(c, today)}.${c.enforced && c.vettingStatus !== 'expiring' ? ` ${first} cannot be given new lessons, students or roles until it is verified, unless you record an override.` : c.vettingStatus === 'expiring' ? ` Ask ${first} to upload the renewed certificate.` : ''}`}
        </Notice>
      ) : null}

      <Figures>
        <Figure label="Booked" value={`${Math.round(booked * 10) / 10}`} hint={`hours in ${formatMonth(month.from)}`} />
        <Figure label="Pay rate" value={formatAED(tutor.hourlyPay ?? 0)} hint="an hour" />
        <Figure label="Earned so far" value={earned ? formatAED(earned.amount) : '…'} hint={earned ? `${earned.lessons} lessons taught this month` : undefined} />
        {progress ? (
          <Figure
            label="Onboarding"
            value={`${progress.done} of ${progress.total}`}
            hint="steps complete"
            tone={progress.complete ? 'good' : 'warn'}
            onPress={checks}
          />
        ) : null}
      </Figures>

      {canSignIn ? null : tutor.email ? <LoginHint email={tutor.email} who="tutor" name={tutor.fullName} /> : null}

      <Columns>
        <Group title="Checks" link={{ label: 'Tutor checks', onPress: checks }} note={c ? undefined : 'Police clearance and onboarding appear once the profile is saved.'}>
          {c ? <GroupRow icon="verified_user" tone={vet?.tone === 'good' ? 'good' : vet?.tone === 'bad' ? 'bad' : 'warn'} title="Police clearance" note={vettingSummary(c, today)} value={vet?.tag} valueTone={vet?.tone === 'good' ? 'good' : vet?.tone === 'bad' ? 'bad' : 'warn'} /> : null}
          {items
            .filter((i) => i.key !== 'clearance')
            .map((i) => (
              <GroupRow
                key={i.key}
                icon={i.done ? 'check_circle' : 'radio_button_unchecked'}
                tone={i.done ? 'good' : 'neutral'}
                title={i.label}
                note={[i.optional ? 'Optional' : null, i.detail].filter(Boolean).join(' · ') || undefined}
                value={i.done ? 'Done' : 'Outstanding'}
                valueTone={i.done ? 'good' : i.optional ? 'muted' : 'warn'}
              />
            ))}
        </Group>
        <View style={{ gap: 26 }}>
          <Group title="Teaches">
            <GroupRow icon="school" title={tutor.subjects.join(', ') || 'No subjects yet'} note={[tutor.curricula.join(', '), tutor.phases.join(', ')].filter(Boolean).join(' · ') || undefined} />
            <GroupRow
              icon="group"
              title={`${students.length} ${students.length === 1 ? 'student' : 'students'}`}
              note={students.map((sid) => lookup.student(sid)?.fullName).filter(Boolean).join(', ') || 'No students yet'}
            />
          </Group>
          <Group title="Account">
            <GroupRow icon="person" title={canSignIn ? 'Can sign in' : 'Not signed up yet'} note={canSignIn ? `Signs in with ${tutor.email}` : 'They create their account in the app'} />
            <GroupRow
              icon="calendar_month"
              title="Calendar colour"
              note="Used for this tutor in the calendar and on lesson cards."
              right={<View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: tutor.color, borderWidth: 1, borderColor: theme.hairline }} accessibilityLabel={`Colour ${tutor.color}`} />}
            />
          </Group>
        </View>
      </Columns>

      <Actions>
        <Button title="Schedule a lesson" icon="calendar_month" onPress={() => router.push({ pathname: '/lesson/new', params: { tutorId: tutor.id } })} />
        <Button title="Availability and time off" icon="schedule" variant="secondary" onPress={() => router.push({ pathname: '/availability', params: { tutorId: tutor.id } })} />
        <Button title="Edit profile and pay" icon="edit" variant="secondary" onPress={edit} />
      </Actions>

      <ViewAsActions tutorId={tutor.id} />
      <AdminIcsResetActions tutorId={tutor.id} />
      <HistorySection filter={{ tutorId: tutor.id }} />
    </Screen>
  );
}
