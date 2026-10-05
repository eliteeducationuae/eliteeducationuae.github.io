import { router } from 'expo-router';

import { AdmissionsSummaryCard } from '@/components/admissions/admissions-summary-card';
import { GreetingCard, NextLessonCard, QuickActions } from '@/components/dashboard';
import { LessonCard } from '@/components/lessons';
import { RequestCard } from '@/components/requests';
import { NotesFeed } from '@/components/student-overview';
import { Banner, Button, Card, EmptyState, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAnnouncements, useFamilies, useInvoices, useLessons, useLookup, useNotes, useRequests, useStudents } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED, invoiceTotals } from '@/domain/billing';
import { addDays, relativeDay, startOfDay } from '@/domain/dates';
import { greetingLine, joinNames } from '@/domain/greeting';
import { byStart } from '@/domain/scheduling';
import { isPlaceholderName } from '@/lib/social-auth';

const today = startOfDay(new Date());

export default function ParentHome() {
  const me = useMe();
  const lookup = useLookup();
  const students = useStudents();
  const families = useFamilies();
  const lessons = useLessons(addDays(today, -60), addDays(today, 21));
  const notes = useNotes();
  const invoices = useInvoices();
  const requests = useRequests();
  const announcements = useAnnouncements();

  if (lessons.isLoading || students.isLoading || !lookup.ready) return <Loading />;
  const now = new Date();
  const family = families.data?.find((f) => f.id === me.familyId);
  const kids = students.data ?? [];
  const upcoming = (lessons.data ?? []).filter((l) => l.status === 'scheduled' && new Date(l.end) > now).sort(byStart);
  const balance = (invoices.data ?? []).filter((i) => i.status === 'sent').reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const openRequests = (requests.data ?? []).filter((r) => r.status === 'pending' || (r.decidedAt && new Date(r.decidedAt) > addDays(now, -3)));
  const latest = announcements.data?.[0];
  const isNew = family?.status === 'prospect' && upcoming.length === 0;

  return (
    <Screen onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <GreetingCard
        date={now}
        title={greetingLine(now, isPlaceholderName(me.fullName, me.email) ? undefined : me.fullName)}
        subtitle={kids.length ? `Here is the latest for ${joinNames(kids.map((s) => s.fullName.split(' ')[0]))}.` : 'Welcome to Elite Education.'}
      />
      {upcoming[0] ? <NextLessonCard lesson={upcoming[0]} lookup={lookup} perspective="family" now={now} /> : null}
      {kids.length ? (
        <QuickActions
          actions={[
            { icon: 'calendar', label: 'Book a lesson', onPress: () => router.push('/book') },
            { icon: 'trend', label: 'Progress', onPress: () => router.navigate('/parent/progress') },
            { icon: 'card', label: 'Billing', onPress: () => router.navigate('/parent/billing'), badge: balance > 0 ? 1 : undefined },
            { icon: 'chat', label: 'Message us', onPress: () => router.navigate('/parent/messages') },
          ]}
        />
      ) : null}
      {kids.length ? <AdmissionsSummaryCard /> : null}

      {kids.length === 0 ? (
        <Card style={{ gap: Spacing.two }}>
          <Txt variant="h3">Getting started</Txt>
          <Txt variant="muted">Please add your child and tell us what they would like support with. We will then arrange a complimentary consultation.</Txt>
          <Button title="Add my child" variant="gold" icon="plus" onPress={() => router.push('/onboarding')} />
        </Card>
      ) : isNew ? (
        <Banner icon="sparkle">
          Thank you for joining Elite Education. We will be in touch within one working day to arrange a complimentary consultation. You are welcome to message us at any time from the Messages tab.
        </Banner>
      ) : null}

      {balance > 0 ? (
        <Banner tone="warning" icon="card">
          {formatAED(balance)} is due on your account.{' '}
          <Txt variant="muted" color="accent" onPress={() => router.navigate('/parent/billing')} accessibilityRole="link">
            View and pay
          </Txt>
        </Banner>
      ) : null}

      {latest ? (
        <Card onPress={() => router.push('/announcements')} accessibilityLabel={`Announcement: ${latest.title}`}>
          <Txt variant="label">Announcement · {relativeDay(latest.createdAt)}</Txt>
          <Txt variant="h3">{latest.title}</Txt>
          <Txt variant="muted" numberOfLines={2}>
            {latest.body}
          </Txt>
        </Card>
      ) : null}

      <Section
        title="Upcoming lessons"
        action={kids.length && !isNew ? <Button title="Book or change" icon="calendar" size="sm" variant="gold" onPress={() => router.push('/book')} /> : undefined}>
        {upcoming.length ? (
          upcoming.slice(0, 6).map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} perspective="family" showDate />)
        ) : (
          <EmptyState icon="calendar" title="No lessons booked" message={isNew ? 'Your child’s first lesson will appear here as soon as it is arranged.' : 'You can book an additional lesson or send us a message at any time.'} />
        )}
      </Section>

      {openRequests.length ? (
        <Section title="Your requests">
          {openRequests.map((r) => (
            <RequestCard key={r.id} r={r} />
          ))}
        </Section>
      ) : null}

      {kids.length ? (
        <Section title="Latest lesson notes" action={<Button title="Progress" size="sm" variant="ghost" onPress={() => router.navigate('/parent/progress')} />}>
          <NotesFeed notes={notes.data ?? []} lessons={lessons.data ?? []} loading={notes.isLoading} limit={4} />
        </Section>
      ) : null}

      <Row gap={Spacing.two}>
        {kids.length ? (
          <Button title="Add a child" icon="plus" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/onboarding')} />
        ) : (
          <Button title="Message us" icon="chat" variant="secondary" style={{ flex: 1 }} onPress={() => router.navigate('/parent/messages')} />
        )}
      </Row>
    </Screen>
  );
}
