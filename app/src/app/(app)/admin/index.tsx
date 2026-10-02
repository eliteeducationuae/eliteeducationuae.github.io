import { router } from 'expo-router';
import { View } from 'react-native';

import { LessonCard } from '@/components/lessons';
import { Banner, Button, Card, EmptyState, ListItem, Loading, Row, Screen, Section, Stat, StatGrid, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { Icon } from '@/components/icon';
import { useAbsences, useCharges, useEnquiries, useInvoices, useLessons, useLookup, usePackages, useRequests } from '@/data/hooks';
import { useMe } from '@/data/session';
import { chargeRevenue, displayStatus, formatAED, invoiceTotals, packageRemaining } from '@/domain/billing';
import { addDays, formatDay, isSameDay, startOfDay, startOfMonth, toDateKey } from '@/domain/dates';
import { byStart, lessonsDuringAbsence } from '@/domain/scheduling';
import { useTheme } from '@/hooks/use-theme';
import { plural } from '@/lib/id';

export default function AdminDashboard() {
  const me = useMe();
  const theme = useTheme();
  const lookup = useLookup();
  const now = new Date();
  const monthStart = startOfMonth(now);
  const lessons = useLessons(addDays(startOfDay(now), -30), addDays(startOfDay(now), 1));
  const charges = useCharges();
  const invoices = useInvoices();
  const packages = usePackages();
  const enquiries = useEnquiries();
  const requests = useRequests();
  const absences = useAbsences();
  const upcoming = useLessons(startOfDay(now), addDays(startOfDay(now), 60));

  const today = (lessons.data ?? []).filter((l) => isSameDay(new Date(l.start), now)).sort(byStart);
  const needsNotes = (lessons.data ?? []).filter((l) => l.status === 'scheduled' && new Date(l.end) < now);
  const lastMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);
  const inRange = (from: Date, to: Date) => (charges.data ?? []).filter((c) => new Date(c.date) >= from && new Date(c.date) < to);
  const revenue = chargeRevenue(inRange(monthStart, addDays(now, 1)), packages.data ?? []);
  const lastMonthRevenue = chargeRevenue(inRange(lastMonthStart, monthStart), packages.data ?? []);
  const unbilled = (charges.data ?? []).filter((c) => c.status === 'unbilled');
  const unbilledTotal = unbilled.reduce((s, c) => s + c.amount, 0);
  const open = (invoices.data ?? []).filter((i) => i.status === 'sent');
  const outstanding = open.reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const overdue = open.filter((i) => displayStatus(i) === 'overdue');
  const lowCredit = (packages.data ?? []).filter((p) => packageRemaining(p) <= 2);
  const newEnquiries = (enquiries.data ?? []).filter((e) => e.status === 'new');
  const followUps = (enquiries.data ?? []).filter(
    (e) => e.nextActionAt && e.nextActionAt <= toDateKey(now) && (e.status === 'contacted' || e.status === 'trial-booked'),
  );
  const pending = (requests.data ?? []).filter((r) => r.status === 'pending');
  const needCover = (absences.data ?? []).flatMap((a) => lessonsDuringAbsence(a, upcoming.data ?? []));
  const attention = needsNotes.length + overdue.length + lowCredit.length + newEnquiries.length + followUps.length + pending.length + needCover.length;

  const loading = lessons.isLoading || charges.isLoading || invoices.isLoading || !lookup.ready;

  return (
    <Screen onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <View>
        <Txt variant="muted">{formatDay(now)}</Txt>
        <Txt variant="title">Hi {me.fullName.split(' ')[0]}</Txt>
      </View>

      {loading ? (
        <Loading />
      ) : (
        <>
          <StatGrid>
            <Stat label="Lessons today" value={String(today.filter((l) => l.status !== 'cancelled').length)} onPress={() => router.navigate('/admin/calendar')} />
            <Stat label="Earned this month" value={formatAED(revenue)} hint={`${formatAED(lastMonthRevenue)} last month`} tone="success" />
            <Stat label="Outstanding" value={formatAED(outstanding)} hint={plural(open.length, 'invoice')} tone={overdue.length ? 'danger' : undefined} onPress={() => router.navigate('/admin/billing')} />
            <Stat label="Ready to invoice" value={formatAED(unbilledTotal)} hint={plural(unbilled.length, 'charge')} tone="info" onPress={() => router.navigate('/admin/billing')} />
          </StatGrid>

          {attention ? (
            <Section title="Needs attention">
              {pending.length ? (
                <ListItem
                  title={`${plural(pending.length, 'lesson request')} to approve`}
                  subtitle="Families asking for extra lessons or changes"
                  left={<Icon name="calendar" size={22} color={theme.warning} />}
                  onPress={() => router.push('/manage/requests')}
                />
              ) : null}
              {newEnquiries.length ? (
                <ListItem
                  title={`${plural(newEnquiries.length, 'new enquiry', 'new enquiries')}`}
                  subtitle={newEnquiries.map((e) => e.parentName).join(', ')}
                  left={<Icon name="inbox" size={22} color={theme.gold} />}
                  onPress={() => router.push('/manage/enquiries')}
                />
              ) : null}
              {followUps.length ? (
                <ListItem
                  title={`${plural(followUps.length, 'enquiry', 'enquiries')} to follow up today`}
                  subtitle={followUps.map((e) => e.parentName).join(', ')}
                  left={<Icon name="phone" size={22} color={theme.accent} />}
                  onPress={() => router.push({ pathname: '/manage/enquiry/[id]', params: { id: followUps[0].id } })}
                />
              ) : null}
              {needCover.length ? (
                <ListItem
                  title={`${plural(needCover.length, 'lesson')} ${needCover.length === 1 ? 'needs' : 'need'} cover`}
                  subtitle={`${lookup.tutor(needCover[0].tutorId)?.fullName ?? 'A tutor'} is away. Tap to choose a cover tutor.`}
                  left={<Icon name="alert" size={22} color={theme.danger} />}
                  onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: needCover[0].id } })}
                />
              ) : null}
              {needsNotes.length ? (
                <ListItem
                  title={`${needsNotes.length} lesson${needsNotes.length > 1 ? 's' : ''} waiting for notes`}
                  subtitle="Record attendance and notes so families are updated and lessons get billed"
                  onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: needsNotes[0].id } })}
                />
              ) : null}
              {overdue.map((i) => (
                <ListItem
                  key={i.id}
                  title={`${lookup.family(i.familyId)?.name ?? ''} — ${i.number} overdue`}
                  subtitle={`${formatAED(invoiceTotals(i).balance)} outstanding`}
                  onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: i.id } })}
                />
              ))}
              {lowCredit.map((p) => (
                <ListItem
                  key={p.id}
                  title={`${lookup.family(p.familyId)?.name ?? ''} — ${packageRemaining(p)} package lessons left`}
                  subtitle={`${p.name}. Offer a top-up before it runs out.`}
                  onPress={() => router.push({ pathname: '/manage/package-new', params: { familyId: p.familyId } })}
                />
              ))}
            </Section>
          ) : (
            <Banner tone="success" icon="check">
              All caught up. No overdue invoices or missing lesson notes.
            </Banner>
          )}

          <Section
            title="Today’s lessons"
            action={<Button title="Schedule" icon="plus" size="sm" variant="gold" onPress={() => router.push('/lesson/new')} />}>
            {today.length ? (
              today.map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} />)
            ) : (
              <EmptyState icon="calendar" title="No lessons today" message="Enjoy the breather, or schedule something new." />
            )}
          </Section>

          <Card style={{ gap: Spacing.two }}>
            <Txt variant="h3">Quick actions</Txt>
            <Row gap={Spacing.two} wrap>
              <Button title="New student" icon="plus" variant="secondary" size="sm" onPress={() => router.push('/students/edit')} />
              <Button title="Sell package" icon="tag" variant="secondary" size="sm" onPress={() => router.push('/manage/package-new')} />
              <Button title="Tutor pay" icon="money" variant="secondary" size="sm" onPress={() => router.push('/manage/payroll')} />
            </Row>
          </Card>
        </>
      )}
    </Screen>
  );
}
