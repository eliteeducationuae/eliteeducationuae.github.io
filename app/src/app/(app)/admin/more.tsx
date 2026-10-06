import { router } from 'expo-router';
import { useWindowDimensions } from 'react-native';

import { AccountScreen } from '@/components/account';
import { useAdvisoryUpdatesToApprove } from '@/components/admissions/entry-links';
import { Icon } from '@/components/icon';
import { SIDEBAR_MIN_WIDTH } from '@/components/role-tabs';
import { Badge, ListItem, Section } from '@/components/ui';
import { useTutorChecksCount } from '@/components/vetting';
import { useApplications, useBids, useDeletionRequests, useEnquiries, useOpportunities, useReportCycles, useRequests, useStudentReports, useSystemHealth, useTutorInvoices, useUnreadCount } from '@/data/hooks';
import { suspectedCount, withoutSpam } from '@/domain/spam';
import { useTheme } from '@/hooks/use-theme';
// Launch readiness
import { attentionCount } from '@/domain/system-health';

export default function AdminMore() {
  const theme = useTheme();
  // On wide screens Money, Insights and Reports sit in the sidebar, so More does not repeat them.
  const wide = useWindowDimensions().width >= SIDEBAR_MIN_WIDTH;
  const unread = useUnreadCount();
  const enquiries = useEnquiries();
  const requests = useRequests();
  const newEnquiries = withoutSpam(enquiries.data ?? []).filter((e) => e.status === 'new').length;
  // Held as possible spam: mentioned quietly, never counted in a badge.
  const heldEnquiries = suspectedCount(enquiries.data);
  const pending = (requests.data ?? []).filter((r) => r.status === 'pending').length;
  const updatesToApprove = useAdvisoryUpdatesToApprove();
  const engage = [
    { title: 'Messages', subtitle: unread ? `${unread} unread` : 'Conversations with families', icon: 'chat', href: '/messages', badge: unread },
    { title: 'Enquiries', subtitle: heldEnquiries ? `New leads through to enrolment · ${heldEnquiries} possible spam to review` : 'New leads through to enrolment', icon: 'inbox', href: '/manage/enquiries', badge: newEnquiries },
    { title: 'Lesson requests', subtitle: 'Extra lessons and changes from families', icon: 'calendar', href: '/manage/requests', badge: pending },
    { title: 'Announcements', subtitle: 'Send news to families and tutors', icon: 'megaphone', href: '/announcements', badge: 0 },
    { title: 'Admissions advisory', subtitle: 'School and university applications for families', icon: 'school', href: '/admissions', badge: updatesToApprove },
  ] as const;
  const opportunities = useOpportunities();
  const bids = useBids();
  const applications = useApplications();
  const heldApplications = suspectedCount(applications.data);
  const tutorInvoices = useTutorInvoices();
  const reportCycles = useReportCycles();
  const reports = useStudentReports();
  const tutorChecks = useTutorChecksCount();
  const openCycleIds = new Set((reportCycles.data ?? []).filter((c) => c.status === 'open').map((c) => c.id));
  const toReview = (reports.data ?? []).filter((r) => r.status === 'submitted' && openCycleIds.has(r.cycleId)).length;
  const openBids = (bids.data ?? []).filter((b) => b.status === 'pending' && opportunities.data?.find((o) => o.id === b.opportunityId)?.status === 'open').length;
  const team = [
    { title: 'Roles for tutors', subtitle: 'Post new students; tutors put themselves forward', icon: 'school', href: '/manage/opportunities', badge: openBids },
    { title: 'Hiring', subtitle: heldApplications ? `Applications to teach with you · ${heldApplications} possible spam to review` : 'Applications to teach with you', icon: 'person', href: '/manage/applications', badge: withoutSpam(applications.data ?? []).filter((a) => a.status === 'applied').length },
    { title: 'Tutor checks', subtitle: 'Police clearance, onboarding and overrides', icon: 'check', href: '/manage/vetting', badge: tutorChecks },
    { title: 'Tutor invoices', subtitle: 'Approve monthly invoices and pay tutors', icon: 'doc', href: '/manage/tutor-invoices', badge: (tutorInvoices.data ?? []).filter((i) => i.status === 'submitted').length },
    { title: 'Tutor pay', subtitle: 'Hours taught and pay owed by month', icon: 'money', href: '/manage/payroll', badge: 0 },
    ...(wide ? [] : [{ title: 'Student reports', subtitle: 'Report rounds, tutor progress and review', icon: 'book', href: '/manage/reports', badge: toReview }] as const),
    { title: 'Handover packs', subtitle: 'Packs prepared when a lesson is covered or a student changes tutor', icon: 'book', href: '/handover', badge: 0 },
    { title: 'Tutor handbook', subtitle: 'Policies tutors acknowledge', icon: 'book', href: '/handbook', badge: 0 },
    { title: 'Resource library', subtitle: 'Worksheets, past papers and links to share with students', icon: 'folder', href: '/resources', badge: 0 },
  ] as const;
  const business = [
    ...(wide
      ? []
      : ([
          { title: 'Money', subtitle: 'Profit, expenses, pay run and exports', icon: 'money', href: '/manage/money' },
          { title: 'Insights', subtitle: 'Trends, tutor capacity and students to check on', icon: 'trend', href: '/manage/insights' },
        ] as const)),
    { title: 'VAT returns', subtitle: 'Quarterly VAT summary and exports for the FTA return', icon: 'doc', href: '/manage/vat' },
    { title: 'Accountant access', subtitle: 'Invite your accountant to view the accounts, read only', icon: 'person', href: '/manage/accountants' },
    { title: 'Activity log', subtitle: 'Who changed what, and when', icon: 'clock', href: '/manage/activity' },
  ] as const;
  const links = [
    { title: 'Tutors', subtitle: 'Profiles, pay rates and calendar colours', icon: 'school', href: '/manage/tutors' },
    { title: 'Families', subtitle: 'Parents, contact details and children', icon: 'people', href: '/manage/families' },
    { title: 'Services and rates', subtitle: 'Lesson types, durations and prices', icon: 'tag', href: '/manage/services' },
    { title: 'Holidays and term breaks', subtitle: 'Dates with no lessons', icon: 'sun', href: '/manage/closures' },
    { title: 'Business settings', subtitle: 'Cancellation policy, VAT, invoicing', icon: 'settings', href: '/manage/settings' },
  ] as const;
  // Launch readiness
  const health = useSystemHealth();
  const deletionRequests = useDeletionRequests();
  const system = [
    { title: 'System health', subtitle: 'Errors, scheduled jobs and database version', icon: 'alert', href: '/manage/system-health', badge: attentionCount(health.data?.checks) },
    { title: 'Deletion requests', subtitle: 'Account deletions and records kept', icon: 'doc', href: '/manage/deletion-requests', badge: (deletionRequests.data ?? []).filter((r) => r.status === 'pending').length },
  ] as const;
  // Day-to-day work first, then the business, then set-up and the system.
  const sections = [
    { title: 'Families and enquiries', rows: engage },
    { title: 'Team', rows: team },
    { title: 'Business', rows: business },
    { title: 'Manage', rows: links },
    { title: 'System', rows: system },
  ];
  return (
    <AccountScreen>
      {sections.map((s) => (
        <Section key={s.title} title={s.title}>
          {s.rows.map((l) => (
            <ListItem
              key={l.href}
              title={l.title}
              subtitle={l.subtitle}
              left={<Icon name={l.icon} size={22} color={theme.accent} />}
              right={'badge' in l && l.badge ? <Badge label={String(l.badge)} tone="gold" /> : undefined}
              onPress={() => router.push(l.href)}
            />
          ))}
        </Section>
      ))}
    </AccountScreen>
  );
}
