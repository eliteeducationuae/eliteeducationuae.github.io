import { router } from 'expo-router';

import { GreetingCard, NextLessonCard, QuickActions } from '@/components/dashboard';
import { LessonCard } from '@/components/lessons';
import { Banner, Button, Card, EmptyState, ListItem, Loading, Row, Screen, Section, Stat, StatGrid, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { Icon } from '@/components/icon';
import { RiskRow, useAtRisk } from '@/components/insights';
import {
  useAbsences,
  useApplications,
  useBids,
  useCharges,
  useEnquiries,
  useInvoices,
  useLessons,
  useLookup,
  useOpportunities,
  usePackages,
  useRequests,
  useStudentReports,
  useTutorInvoices,
} from '@/data/hooks';
import { useMe } from '@/data/session';
import { chargeRevenue, displayStatus, formatAED, invoiceTotals, packageRemaining } from '@/domain/billing';
import { addDays, isSameDay, startOfDay, startOfMonth, toDateKey } from '@/domain/dates';
import { adminSummary, greetingLine } from '@/domain/greeting';
import { byStart, lessonsDuringAbsence } from '@/domain/scheduling';
import { withoutSpam } from '@/domain/spam';
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
  const opportunities = useOpportunities();
  const bids = useBids();
  const tutorInvoices = useTutorInvoices();
  const reports = useStudentReports();
  const applications = useApplications();
  const atRisk = useAtRisk();

  const today = (lessons.data ?? []).filter((l) => isSameDay(new Date(l.start), now)).sort(byStart);
  const activeToday = today.filter((l) => l.status !== 'cancelled' && l.status !== 'late-cancel');
  const next = (upcoming.data ?? []).filter((l) => l.status === 'scheduled' && new Date(l.end) > now).sort(byStart)[0];
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
  const newEnquiries = withoutSpam(enquiries.data ?? []).filter((e) => e.status === 'new');
  const followUps = withoutSpam(enquiries.data ?? []).filter(
    (e) => e.nextActionAt && e.nextActionAt <= toDateKey(now) && (e.status === 'contacted' || e.status === 'trial-booked'),
  );
  const pending = (requests.data ?? []).filter((r) => r.status === 'pending');
  const needCover = (absences.data ?? []).flatMap((a) => lessonsDuringAbsence(a, upcoming.data ?? []));
  const rolesWithBids = (opportunities.data ?? []).filter((o) => o.status === 'open' && (bids.data ?? []).some((b) => b.opportunityId === o.id && b.status === 'pending'));
  const invoicesToApprove = (tutorInvoices.data ?? []).filter((i) => i.status === 'submitted');
  const reportsToReview = (reports.data ?? []).filter((r) => r.status === 'submitted');
  const newApplications = withoutSpam(applications.data ?? []).filter((a) => a.status === 'applied');
  const attention = rolesWithBids.length + invoicesToApprove.length + reportsToReview.length + newApplications.length + atRisk.list.length + needsNotes.length + overdue.length + lowCredit.length + newEnquiries.length + followUps.length + pending.length + needCover.length;

  const loading = lessons.isLoading || charges.isLoading || invoices.isLoading || !lookup.ready;

  return (
    <Screen onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <GreetingCard
        date={now}
        title={greetingLine(now, me.fullName.split(' ')[0])}
        subtitle={loading ? undefined : adminSummary(activeToday.length, attention)}
      />
      {next ? <NextLessonCard lesson={next} lookup={lookup} perspective="admin" now={now} /> : null}
      <QuickActions
        actions={[
          { icon: 'calendar', label: 'Schedule lessons', onPress: () => router.push('/lesson/new') },
          { icon: 'people', label: 'Families', onPress: () => router.push('/manage/families') },
          { icon: 'card', label: 'Billing', onPress: () => router.navigate('/admin/billing'), badge: overdue.length || undefined },
          { icon: 'chat', label: 'Messages', onPress: () => router.push('/messages') },
        ]}
      />

      {loading ? (
        <Loading />
      ) : (
        <>
          <StatGrid>
            <Stat label="Lessons today" value={String(activeToday.length)} onPress={() => router.navigate('/admin/calendar')} />
            <Stat label="Earned this month" value={formatAED(revenue)} hint={`${formatAED(lastMonthRevenue)} last month`} tone="success" onPress={() => router.push('/manage/money')} />
            <Stat label="Outstanding" value={formatAED(outstanding)} hint={plural(open.length, 'invoice')} tone={overdue.length ? 'danger' : undefined} onPress={() => router.navigate('/admin/billing')} />
            <Stat label="Ready to invoice" value={formatAED(unbilledTotal)} hint={plural(unbilled.length, 'charge')} tone="info" onPress={() => router.navigate('/admin/billing')} />
          </StatGrid>

          {attention ? (
            <Section title="Needs attention">
              {pending.length ? (
                <ListItem
                  title={`${plural(pending.length, 'lesson request')} to approve`}
                  subtitle="Families requesting additional lessons or changes"
                  left={<Icon name="calendar" size={22} color={theme.warning} />}
                  onPress={() => router.push('/manage/requests')}
                />
              ) : null}
              {invoicesToApprove.length ? (
                <ListItem
                  title={`${plural(invoicesToApprove.length, 'tutor invoice')} to approve`}
                  subtitle={invoicesToApprove.map((i) => lookup.tutor(i.tutorId)?.fullName.split(' ')[0]).join(', ')}
                  left={<Icon name="doc" size={22} color={theme.warning} />}
                  onPress={() => router.push('/manage/tutor-invoices')}
                />
              ) : null}
              {rolesWithBids.length ? (
                <ListItem
                  title={`${plural(rolesWithBids.length, 'role')} with tutors interested`}
                  subtitle={rolesWithBids.map((o) => o.title).join(', ')}
                  left={<Icon name="school" size={22} color={theme.gold} />}
                  onPress={() => router.push('/manage/opportunities')}
                />
              ) : null}
              {reportsToReview.length ? (
                <ListItem
                  title={`${plural(reportsToReview.length, 'report')} to review`}
                  subtitle="Approve them before they are sent to families"
                  left={<Icon name="book" size={22} color={theme.accent} />}
                  onPress={() => router.push('/manage/reports')}
                />
              ) : null}
              {newApplications.length ? (
                <ListItem
                  title={`${plural(newApplications.length, 'tutor application')}`}
                  subtitle={newApplications.map((a) => a.fullName).join(', ')}
                  left={<Icon name="person" size={22} color={theme.accent} />}
                  onPress={() => router.push('/manage/applications')}
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
                  subtitle={`${lookup.tutor(needCover[0].tutorId)?.fullName ?? 'A tutor'} is away. Choose a cover tutor.`}
                  left={<Icon name="alert" size={22} color={theme.danger} />}
                  onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: needCover[0].id } })}
                />
              ) : null}
              {needsNotes.length ? (
                <ListItem
                  title={`${plural(needsNotes.length, 'lesson')} awaiting notes`}
                  subtitle="Record attendance and notes so that families are updated and lessons are billed"
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
                  subtitle={`${p.name}. Offer a top-up before the package runs out.`}
                  onPress={() => router.push({ pathname: '/manage/package-new', params: { familyId: p.familyId } })}
                />
              ))}
              {atRisk.list.slice(0, 3).map((r) => (
                <RiskRow key={r.studentId} risk={r} />
              ))}
              {atRisk.list.length > 3 ? <Button title={`View all ${atRisk.list.length} students to check on`} variant="ghost" size="sm" onPress={() => router.push('/manage/insights')} /> : null}
            </Section>
          ) : (
            <Banner tone="success" icon="check">
              Everything is in order. There are no overdue invoices or missing lesson notes.
            </Banner>
          )}

          <Section
            title="Today’s lessons"
            action={<Button title="Schedule" icon="plus" size="sm" variant="gold" onPress={() => router.push('/lesson/new')} />}>
            {today.length ? (
              today.map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} />)
            ) : (
              <EmptyState icon="calendar" title="No lessons scheduled today" message="Lessons booked for today will appear here." />
            )}
          </Section>

          <Card style={{ gap: Spacing.two }}>
            <Txt variant="h3">More shortcuts</Txt>
            <Row gap={Spacing.two} wrap>
              <Button title="New student" icon="plus" variant="secondary" size="sm" onPress={() => router.push('/students/edit')} />
              <Button title="Sell a package" icon="tag" variant="secondary" size="sm" onPress={() => router.push('/manage/package-new')} />
              <Button title="Tutor pay" icon="money" variant="secondary" size="sm" onPress={() => router.push('/manage/payroll')} />
            </Row>
          </Card>
        </>
      )}
    </Screen>
  );
}
