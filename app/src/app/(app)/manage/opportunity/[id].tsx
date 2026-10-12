import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { subjectLine } from '@/components/catalogue-choice';
import { FactsGroup, NoHeader, RowMeta, VETTING_TAG } from '@/components/admin-people/kit';
import { BID_STATUS, fitNote, opportunityTone, tutorFits } from '@/components/opportunities';
import { awardPaySentence } from '@/components/rates';
import { useComplianceMap } from '@/components/vetting';
import { Actions, Button, ChipField, EmptyState, ErrorNote, FieldsCard, Group, GroupRow, Loading, Notice, PageHeader, Screen, Txt } from '@/components/ui';
import { useViewing } from '@/data/session';
import { source } from '@/data';
import { useAction, useAvailability, useBids, useEnrolments, useLessons, useLookup, useOpportunities, useTutors } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { isClosed } from '@/domain/closed-accounts';
import { addDays, formatDate, minutesBetween, relativeDay, startOfWeek } from '@/domain/dates';
import { awardSubjectChoices } from '@/domain/enrolments';
import type { Tutor } from '@/domain/types';
import { confirm } from '@/lib/confirm';

const weekStart = startOfWeek(new Date());

/** One role and everyone who put themselves forward, side by side. */
export default function OpportunityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const opportunities = useOpportunities();
  const bids = useBids();
  const vetting = useComplianceMap();
  const tutors = useTutors();
  const availability = useAvailability();
  const lessons = useLessons(weekStart, addDays(weekStart, 14));
  const enrolments = useEnrolments();
  const lookup = useLookup();
  const viewing = useViewing();
  const award = useAction(source.awardOpportunity);
  const save = useAction(source.saveOpportunity);
  // A role with no subject, for a student with several subjects: the admin says which subject the tutor takes on.
  const [subject, setSubject] = useState<string>();
  if (opportunities.isLoading || bids.isLoading || tutors.isLoading || enrolments.isLoading) return <Loading />;
  const o = opportunities.data?.find((x) => x.id === id);
  if (!o) {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/manage/opportunities' }} kicker="Roles" title="Role not found" />
        <EmptyState title="Role not found" />
      </Screen>
    );
  }
  const choices = o.status === 'open' ? awardSubjectChoices(enrolments.data ?? [], o) : [];
  const chosen = choices.find((c) => c === subject);
  const firstName = (o.studentId && lookup.student(o.studentId)?.fullName.split(' ')[0]) || 'The student';
  const tutor = (tid: string) => tutors.data?.find((t) => t.id === tid);
  // A closed tutor's bid can no longer be chosen, so it is not offered (the server withdraws it too).
  const theirs = (bids.data ?? []).filter((b) => b.opportunityId === o.id && b.status !== 'withdrawn' && !(b.status === 'pending' && isClosed(tutor(b.tutorId))));
  const winner = o.awardedTutorId ? tutor(o.awardedTutorId) : undefined;
  const s = opportunityTone(o);

  /** Context for choosing: current teaching load, weekly hours offered and curriculum fit. */
  const stats = (t: Tutor) => {
    const taught = (lessons.data ?? []).filter((l) => l.tutorId === t.id && l.status !== 'cancelled' && l.status !== 'late-cancel');
    const hours = taught.reduce((n, l) => n + minutesBetween(new Date(l.start), new Date(l.end)), 0) / 60 / 2;
    const offered = (availability.data ?? [])
      .filter((a) => a.tutorId === t.id)
      .reduce((n, a) => n + (Number(a.end.slice(0, 2)) * 60 + Number(a.end.slice(3)) - Number(a.start.slice(0, 2)) * 60 - Number(a.start.slice(3))) / 60, 0);
    return { hours: Math.round(hours * 10) / 10, offered: Math.round(offered), fits: tutorFits(t, o), note: fitNote(t, o) };
  };

  // Client-side ordering only: tutors who teach the subject first, then the most free hours.
  const ranked = theirs
    .map((b) => ({ b, t: tutor(b.tutorId) }))
    .filter((x): x is { b: (typeof theirs)[number]; t: Tutor } => !!x.t)
    .map((x) => ({ ...x, st: stats(x.t) }))
    .sort((x, y) => Number(y.st.fits) - Number(x.st.fits) || y.st.offered - y.st.hours - (x.st.offered - x.st.hours));
  const best = o.status === 'open' && ranked.length > 1 && ranked[0].st.fits && ranked[0].b.status === 'pending' ? ranked[0].b.id : undefined;

  return (
    <Screen topInset>
      <NoHeader title="Role" />
      <PageHeader back={{ fallback: '/manage/opportunities' }} kicker={`Roles · ${s.label}`} title={o.title} sub={subjectLine(o) || undefined} />

      {winner ? (
        <Notice tone="good" title={`${winner.fullName} was chosen${o.awardedAt ? ` ${relativeDay(o.awardedAt).toLowerCase()}` : ''}`}>
          {`Everyone who expressed interest has been told.${o.studentId ? '' : ' Add the student first, from the enquiry, so that you can schedule their lessons.'}`}
        </Notice>
      ) : null}
      {winner && !viewing ? (
        <Actions>
          <Button
            title={`Schedule lessons with ${winner.fullName.split(' ')[0]}`}
            icon="calendar_month"
            onPress={() => router.push({ pathname: '/lesson/new', params: { tutorId: winner.id, ...(o.studentId ? { studentId: o.studentId } : {}) } })}
          />
        </Actions>
      ) : null}

      <FactsGroup
        title="About the role"
        facts={[
          { k: 'About the student', v: o.description },
          { k: 'When', v: o.schedule },
          { k: 'Where', v: o.location },
          { k: 'Tutor pay', v: `${formatAED(o.payRate)} an hour` },
          { k: 'Closes', v: o.closesOn ? formatDate(o.closesOn) : undefined },
          { k: 'Who can see it', v: o.visibility === 'all' ? 'All tutors' : `Invited: ${o.invitedTutorIds.map((t) => tutor(t)?.fullName.split(' ')[0]).join(', ')}` },
        ]}
      />
      {o.status === 'open' && !viewing ? (
        <Actions>
          <Button title="Edit" icon="edit" variant="secondary" onPress={() => router.push({ pathname: '/manage/opportunity-edit', params: { id: o.id } })} />
          <Button
            title="Close without choosing"
            icon="block"
            variant="secondary"
            onPress={() => confirm('Close this role?', 'Tutors will no longer see it.', () => save.mutate([{ ...o, status: 'closed' }]))}
          />
        </Actions>
      ) : null}

      {choices.length ? (
        <FieldsCard title="Which subject is this role for?">
          <ChipField
            options={choices}
            value={chosen}
            onChange={setSubject}
            hint={`${firstName} studies more than one subject. Choose the one the new tutor will teach: that subject moves to them, with its handover pack.`}
          />
        </FieldsCard>
      ) : null}

      <Group
        title={`Tutors interested (${theirs.length})`}
        note={
          theirs.length === 0
            ? 'No interest yet. Tutors were notified when you posted this role. Their responses will appear here.'
            : o.studentId && o.status === 'open'
              ? awardPaySentence(o.payRate, o.subject ?? chosen)
              : undefined
        }>
        {ranked.map(({ b, t, st }) => {
          const bs = BID_STATUS[b.status];
          const v = vetting.get(t.id);
          return (
            <GroupRow
              key={b.id}
              avatar={t.fullName}
              avatarColor={t.color}
              title={t.fullName}
              note={[`${st.hours}h/week booked`, st.offered ? `${st.offered}h/week offered` : 'no availability set', st.note].filter(Boolean).join(' · ')}
              right={
                <RowMeta
                  tag={best === b.id ? 'Closest match' : bs.label}
                  tone={best === b.id ? 'good' : b.status === 'awarded' ? 'good' : 'accent'}
                  meta={v ? VETTING_TAG[v.vettingStatus].tag : undefined}
                />
              }
              action={
                o.status === 'open' && b.status === 'pending' && !viewing
                  ? {
                      label: `Choose ${t.fullName.split(' ')[0]}`,
                      variant: 'primary',
                      disabled: award.isPending || (choices.length > 0 && !chosen),
                      onPress: () =>
                        confirm(
                          `Choose ${t.fullName}${chosen ? ` for ${chosen}` : ''}?`,
                          'They will be notified immediately, and the other tutors will be told that the role has been filled.',
                          () => award.mutate(chosen ? [b.id, chosen] : [b.id]),
                          'Choose',
                        ),
                    }
                  : undefined
              }>
              <Txt style={{ fontSize: 14.5, lineHeight: 22, marginTop: 4 }}>{b.pitch}</Txt>
              {b.availability ? <Txt variant="small">Available: {b.availability}</Txt> : null}
              {o.status === 'open' && b.status === 'pending' && choices.length > 0 && !chosen ? <Txt variant="small">Choose the subject above first.</Txt> : null}
            </GroupRow>
          );
        })}
      </Group>
      <ErrorNote error={award.error ?? save.error} />
    </Screen>
  );
}
