import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { subjectLine } from '@/components/catalogue-choice';
import { BID_STATUS, fitNote, opportunityTone, tutorFits } from '@/components/opportunities';
import { awardPaySentence } from '@/components/rates';
import { useComplianceMap, VettingBadge } from '@/components/vetting';
import { Avatar, Badge, Banner, Button, Card, EmptyState, ErrorNote, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useAvailability, useBids, useLessons, useOpportunities, useTutors } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { isClosed } from '@/domain/closed-accounts';
import { addDays, formatDate, minutesBetween, relativeDay, startOfWeek } from '@/domain/dates';
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
  const award = useAction(source.awardOpportunity);
  const save = useAction(source.saveOpportunity);
  if (opportunities.isLoading || bids.isLoading || tutors.isLoading) return <Loading />;
  const o = opportunities.data?.find((x) => x.id === id);
  if (!o) return <Screen><EmptyState title="Role not found" /></Screen>;
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

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Role' }} />
      <Card style={{ gap: Spacing.two }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Txt variant="h2" style={{ flex: 1 }}>
            {o.title}
          </Txt>
          <Badge label={s.label} tone={s.tone} />
        </Row>
        {subjectLine(o) ? <Txt variant="label">{subjectLine(o)}</Txt> : null}
        {o.description ? <Txt>{o.description}</Txt> : null}
        <Txt variant="muted">
          {[o.schedule, o.location, `${formatAED(o.payRate)}/hr`].filter(Boolean).join(' · ')}
          {o.closesOn ? ` · closes ${formatDate(o.closesOn)}` : ''}
        </Txt>
        <Txt variant="small">
          {o.visibility === 'all' ? 'Visible to all tutors' : `Invited: ${o.invitedTutorIds.map((t) => tutor(t)?.fullName.split(' ')[0]).join(', ')}`}
        </Txt>
        {o.status === 'open' ? (
          <Row gap={Spacing.two}>
            <Button title="Edit" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/manage/opportunity-edit', params: { id: o.id } })} />
            <Button
              title="Close without choosing"
              size="sm"
              variant="ghost"
              onPress={() => confirm('Close this role?', 'Tutors will no longer see it.', () => save.mutate([{ ...o, status: 'closed' }]))}
            />
          </Row>
        ) : null}
      </Card>

      {winner ? (
        <Card style={{ gap: Spacing.two }}>
          <Banner tone="success" icon="check">
            {winner.fullName} was chosen{o.awardedAt ? ` ${relativeDay(o.awardedAt).toLowerCase()}` : ''}. Everyone who expressed interest has been told.
          </Banner>
          <Button
            title={`Schedule lessons with ${winner.fullName.split(' ')[0]}`}
            icon="calendar"
            variant="gold"
            onPress={() => router.push({ pathname: '/lesson/new', params: { tutorId: winner.id, ...(o.studentId ? { studentId: o.studentId } : {}) } })}
          />
          {!o.studentId ? <Txt variant="small">Add the student first, from the enquiry, so that you can schedule their lessons.</Txt> : null}
        </Card>
      ) : null}

      <Section title={`Tutors interested (${theirs.length})`}>
        {o.studentId && o.status === 'open' ? <Txt variant="small">{awardPaySentence(o.payRate, o.subject)}</Txt> : null}
        {theirs.length === 0 ? <EmptyState icon="people" title="No interest yet" message="Tutors were notified when you posted this role. Their responses will appear here." /> : null}
        <View style={{ gap: Spacing.two }}>
          {theirs.map((b) => {
            const t = tutor(b.tutorId);
            if (!t) return null;
            const st = stats(t);
            const bs = BID_STATUS[b.status];
            return (
              <Card key={b.id} accent={t.color} style={{ gap: Spacing.two }}>
                <Row gap={Spacing.three} style={{ alignItems: 'flex-start' }}>
                  <Avatar name={t.fullName} color={t.color} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Txt variant="h3">{t.fullName}</Txt>
                      <Badge label={bs.label} tone={bs.tone} />
                    </Row>
                    {vetting.get(t.id) ? <VettingBadge status={vetting.get(t.id)!.vettingStatus} /> : null}
                    <Txt variant="small">
                      {[`${st.hours}h/week booked`, st.offered ? `${st.offered}h/week offered` : 'no availability set'].join(' · ')}
                      {st.note ? ' · ' : ''}
                      {st.note ? (
                        <Txt variant="small" color={st.fits ? 'success' : 'warning'}>
                          {st.note}
                        </Txt>
                      ) : null}
                    </Txt>
                  </View>
                </Row>
                <Txt>{b.pitch}</Txt>
                {b.availability ? <Txt variant="muted">Available: {b.availability}</Txt> : null}
                {o.status === 'open' && b.status === 'pending' ? (
                  <Button
                    title={`Choose ${t.fullName.split(' ')[0]}`}
                    loading={award.isPending}
                    onPress={() =>
                      confirm(`Choose ${t.fullName}?`, 'They will be notified immediately, and the other tutors will be told that the role has been filled.', () => award.mutate([b.id]), 'Choose')
                    }
                  />
                ) : null}
              </Card>
            );
          })}
        </View>
      </Section>
      <ErrorNote error={award.error ?? save.error} />
    </Screen>
  );
}
