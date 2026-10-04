import { router } from 'expo-router';

import { AccountScreen } from '@/components/account';
import { Icon } from '@/components/icon';
import { Badge, ListItem, Section } from '@/components/ui';
import { useApplications, useBids, useEnquiries, useOpportunities, useReportCycles, useRequests, useStudentReports, useTutorInvoices, useUnreadCount } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';

export default function AdminMore() {
  const theme = useTheme();
  const unread = useUnreadCount();
  const enquiries = useEnquiries();
  const requests = useRequests();
  const newEnquiries = (enquiries.data ?? []).filter((e) => e.status === 'new').length;
  const pending = (requests.data ?? []).filter((r) => r.status === 'pending').length;
  const engage = [
    { title: 'Messages', subtitle: unread ? `${unread} unread` : 'Conversations with families', icon: 'chat', href: '/messages', badge: unread },
    { title: 'Enquiries', subtitle: 'New leads through to enrolment', icon: 'inbox', href: '/manage/enquiries', badge: newEnquiries },
    { title: 'Lesson requests', subtitle: 'Extra lessons and changes from families', icon: 'calendar', href: '/manage/requests', badge: pending },
    { title: 'Announcements', subtitle: 'Send news to families and tutors', icon: 'megaphone', href: '/announcements', badge: 0 },
  ] as const;
  const opportunities = useOpportunities();
  const bids = useBids();
  const applications = useApplications();
  const tutorInvoices = useTutorInvoices();
  const reportCycles = useReportCycles();
  const reports = useStudentReports();
  const openCycleIds = new Set((reportCycles.data ?? []).filter((c) => c.status === 'open').map((c) => c.id));
  const toReview = (reports.data ?? []).filter((r) => r.status === 'submitted' && openCycleIds.has(r.cycleId)).length;
  const openBids = (bids.data ?? []).filter((b) => b.status === 'pending' && opportunities.data?.find((o) => o.id === b.opportunityId)?.status === 'open').length;
  const team = [
    { title: 'Roles for tutors', subtitle: 'Post new students; tutors put themselves forward', icon: 'school', href: '/manage/opportunities', badge: openBids },
    { title: 'Tutor invoices', subtitle: 'Approve monthly invoices and pay tutors', icon: 'doc', href: '/manage/tutor-invoices', badge: (tutorInvoices.data ?? []).filter((i) => i.status === 'submitted').length },
    { title: 'Student reports', subtitle: 'Report rounds, tutor progress and review', icon: 'book', href: '/manage/reports', badge: toReview },
    { title: 'Hiring', subtitle: 'Applications to teach with you', icon: 'person', href: '/manage/applications', badge: (applications.data ?? []).filter((a) => a.status === 'applied').length },
  ] as const;
  const business = [
    { title: 'Money', subtitle: 'Profit, expenses, pay run and exports', icon: 'money', href: '/manage/money' },
    { title: 'Insights', subtitle: 'Trends, tutor capacity and students to check on', icon: 'trend', href: '/manage/insights' },
  ] as const;
  const links = [
    { title: 'Tutors', subtitle: 'Profiles, pay rates and calendar colours', icon: 'school', href: '/manage/tutors' },
    { title: 'Families', subtitle: 'Parents, contact details and children', icon: 'people', href: '/manage/families' },
    { title: 'Services & rates', subtitle: 'Lesson types, durations and prices', icon: 'tag', href: '/manage/services' },
    { title: 'Holidays & term breaks', subtitle: 'Dates with no lessons', icon: 'sun', href: '/manage/closures' },
    { title: 'Tutor pay', subtitle: 'Hours taught and pay owed by month', icon: 'money', href: '/manage/payroll' },
    { title: 'Business settings', subtitle: 'Cancellation policy, VAT, invoicing', icon: 'settings', href: '/manage/settings' },
  ] as const;
  return (
    <AccountScreen>
      <Section title="Business">
        {business.map((l) => (
          <ListItem key={l.href} title={l.title} subtitle={l.subtitle} left={<Icon name={l.icon} size={22} color={theme.accent} />} onPress={() => router.push(l.href)} />
        ))}
      </Section>
      <Section title="Families">
        {engage.map((l) => (
          <ListItem
            key={l.href}
            title={l.title}
            subtitle={l.subtitle}
            left={<Icon name={l.icon} size={22} color={theme.accent} />}
            right={l.badge ? <Badge label={String(l.badge)} tone="gold" /> : undefined}
            onPress={() => router.push(l.href)}
          />
        ))}
      </Section>
      <Section title="Team">
        {team.map((l) => (
          <ListItem
            key={l.href}
            title={l.title}
            subtitle={l.subtitle}
            left={<Icon name={l.icon} size={22} color={theme.accent} />}
            right={l.badge ? <Badge label={String(l.badge)} tone="gold" /> : undefined}
            onPress={() => router.push(l.href)}
          />
        ))}
      </Section>
      <Section title="Manage">
        {links.map((l) => (
          <ListItem
            key={l.href}
            title={l.title}
            subtitle={l.subtitle}
            left={<Icon name={l.icon} size={22} color={theme.accent} />}
            onPress={() => router.push(l.href)}
          />
        ))}
      </Section>
    </AccountScreen>
  );
}
