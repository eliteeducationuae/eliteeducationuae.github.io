import { router } from 'expo-router';
import { View } from 'react-native';

import { LessonCard } from '@/components/lessons';
import { NotesFeed } from '@/components/student-overview';
import { Banner, Button, EmptyState, Loading, Screen, Section, Txt } from '@/components/ui';
import { useInvoices, useLessons, useLookup, useNotes, useStudents } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED, invoiceTotals } from '@/domain/billing';
import { addDays, startOfDay } from '@/domain/dates';
import { byStart } from '@/domain/scheduling';

const today = startOfDay(new Date());

export default function ParentHome() {
  const me = useMe();
  const lookup = useLookup();
  const students = useStudents();
  const lessons = useLessons(addDays(today, -60), addDays(today, 21));
  const notes = useNotes();
  const invoices = useInvoices();

  if (lessons.isLoading || students.isLoading || !lookup.ready) return <Loading />;
  const now = new Date();
  const upcoming = (lessons.data ?? []).filter((l) => l.status === 'scheduled' && new Date(l.end) > now).sort(byStart);
  const balance = (invoices.data ?? []).filter((i) => i.status === 'sent').reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const kids = (students.data ?? []).map((s) => s.fullName.split(' ')[0]);

  return (
    <Screen onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <View>
        <Txt variant="title">Hello {me.fullName.split(' ')[0]}</Txt>
        <Txt variant="muted">Here’s what’s happening for {kids.join(' & ') || 'your family'}.</Txt>
      </View>
      {balance > 0 ? (
        <Banner tone="warning" icon="card">
          {formatAED(balance)} is due on your account.{' '}
          <Txt variant="muted" color="accent" onPress={() => router.navigate('/parent/billing')} accessibilityRole="link">
            View and pay
          </Txt>
        </Banner>
      ) : null}
      <Section title="Upcoming lessons">
        {upcoming.length ? (
          upcoming.slice(0, 6).map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} perspective="family" showDate />)
        ) : (
          <EmptyState icon="calendar" title="No lessons booked" message="Contact us to arrange your next lesson." />
        )}
      </Section>
      <Section title="Latest lesson notes" action={<Button title="Progress" size="sm" variant="ghost" onPress={() => router.navigate('/parent/progress')} />}>
        <NotesFeed notes={(notes.data ?? []).slice(0, 40)} lessons={lessons.data ?? []} loading={notes.isLoading} limit={4} />
      </Section>
    </Screen>
  );
}
