import type { Href } from 'expo-router';

import { useAdvisoryUpdatesToApprove } from '@/components/admissions/entry-links';
import type { IconName } from '@/components/icon';
import { useTutorChecksCount } from '@/components/vetting';
import {
  useApplications,
  useBids,
  useDeletionRequests,
  useEnquiries,
  useFamilies,
  useOpportunities,
  useReportCycles,
  useRequests,
  useStudentReports,
  useStudents,
  useSystemHealth,
  useTutorInvoices,
  useTutors,
  useUnreadCount,
} from '@/data/hooks';
import { withoutClosed } from '@/domain/closed-accounts';
import { suspectedCount, withoutSpam } from '@/domain/spam';
import { attentionCount } from '@/domain/system-health';
import { plural } from '@/lib/id';

export interface DirectoryItem {
  icon: IconName;
  title: string;
  note: string;
  href: Href;
  /** Waiting items (a gold-brown count); 0 hides it. */
  count: number;
}

export interface DirectoryGroup {
  title: string;
  items: DirectoryItem[];
}

/**
 * Everything the office can open, in the prototype's four groups (People, Growth, Team, Business), plus every
 * page the old More menu reached (lesson requests, accountant access, deletion requests…), with live counts.
 */
export function useDirectory(): DirectoryGroup[] {
  const families = useFamilies();
  const students = useStudents();
  const tutors = useTutors();
  const unread = useUnreadCount();
  const enquiries = useEnquiries();
  const requests = useRequests();
  const updatesToApprove = useAdvisoryUpdatesToApprove();
  const opportunities = useOpportunities();
  const bids = useBids();
  const applications = useApplications();
  const tutorInvoices = useTutorInvoices();
  const reportCycles = useReportCycles();
  const reports = useStudentReports();
  const tutorChecks = useTutorChecksCount();
  const health = useSystemHealth();
  const deletionRequests = useDeletionRequests();

  const familyCount = withoutClosed(families.data ?? []).length;
  const studentCount = withoutClosed(students.data ?? []).length;
  const tutorCount = withoutClosed(tutors.data ?? []).length;
  const newEnquiries = withoutSpam(enquiries.data ?? []).filter((e) => e.status === 'new').length;
  // Held as possible spam: mentioned quietly, never counted.
  const heldEnquiries = suspectedCount(enquiries.data);
  const heldApplications = suspectedCount(applications.data);
  const pending = (requests.data ?? []).filter((r) => r.status === 'pending').length;
  const openCycleIds = new Set((reportCycles.data ?? []).filter((c) => c.status === 'open').map((c) => c.id));
  const toReview = (reports.data ?? []).filter((r) => r.status === 'submitted' && openCycleIds.has(r.cycleId)).length;
  const openBids = (bids.data ?? []).filter((b) => b.status === 'pending' && opportunities.data?.find((o) => o.id === b.opportunityId)?.status === 'open').length;
  const newApplications = withoutSpam(applications.data ?? []).filter((a) => a.status === 'applied').length;
  const invoicesWaiting = (tutorInvoices.data ?? []).filter((i) => i.status === 'submitted').length;
  const deletionsWaiting = (deletionRequests.data ?? []).filter((r) => r.status === 'pending').length;

  return [
    {
      title: 'People',
      items: [
        { icon: 'group', title: 'Families', note: families.data ? `${plural(familyCount, 'family', 'families')}, contacts and children` : 'Parents, contacts and children', href: '/manage/families', count: 0 },
        { icon: 'school', title: 'Students', note: students.data ? plural(studentCount, 'active student') : 'Profiles, subjects and progress', href: '/admin/students', count: 0 },
        { icon: 'person', title: 'Tutors', note: tutors.data ? `${plural(tutorCount, 'tutor')}, rates and colours` : 'Profiles, pay rates and colours', href: '/manage/tutors', count: 0 },
        { icon: 'forum', title: 'Messages', note: unread ? `${unread} unread` : 'Conversations with families', href: '/messages', count: unread },
      ],
    },
    {
      title: 'Growth',
      items: [
        {
          icon: 'inbox',
          title: 'Enquiries',
          note: heldEnquiries ? `New leads through to enrolment · ${heldEnquiries} possible spam to review` : 'New leads through to enrolment',
          href: '/manage/enquiries',
          count: newEnquiries,
        },
        { icon: 'event_repeat', title: 'Lesson requests', note: 'Extra lessons and changes from families', href: '/manage/requests', count: pending },
        { icon: 'travel_explore', title: 'Admissions advisory', note: 'School and university applications', href: '/admissions', count: updatesToApprove },
        { icon: 'campaign', title: 'Announcements', note: 'News to families and tutors', href: '/announcements', count: 0 },
        { icon: 'sell', title: 'Roles for tutors', note: 'Post new students; tutors put themselves forward', href: '/manage/opportunities', count: openBids },
      ],
    },
    {
      title: 'Team',
      items: [
        { icon: 'description', title: 'Tutor invoices', note: 'Approve and pay tutors', href: '/manage/tutor-invoices', count: invoicesWaiting },
        { icon: 'payments', title: 'Tutor pay', note: 'Hours taught and pay owed', href: '/manage/payroll', count: 0 },
        { icon: 'verified_user', title: 'Tutor checks', note: 'Police clearance, onboarding and overrides', href: '/manage/vetting', count: tutorChecks },
        { icon: 'menu_book', title: 'Student reports', note: 'Report rounds and review', href: '/manage/reports', count: toReview },
        { icon: 'folder', title: 'Resource library', note: 'Worksheets and past papers', href: '/resources', count: 0 },
        {
          icon: 'person_add',
          title: 'Hiring',
          note: heldApplications ? `Applications to teach · ${heldApplications} possible spam to review` : 'Applications to teach',
          href: '/manage/applications',
          count: newApplications,
        },
        { icon: 'swap_horiz', title: 'Handover packs', note: 'When a lesson is covered or a student changes tutor', href: '/handover', count: 0 },
        { icon: 'import_contacts', title: 'Tutor handbook', note: 'Policies tutors agree to', href: '/handbook', count: 0 },
      ],
    },
    {
      title: 'Business',
      items: [
        { icon: 'account_balance', title: 'Money', note: 'Profit, expenses, pay run and exports', href: '/manage/money', count: 0 },
        { icon: 'trending_up', title: 'Insights', note: 'Trends, tutor capacity and students to check on', href: '/manage/insights', count: 0 },
        { icon: 'receipt_long', title: 'VAT returns', note: 'Quarterly FTA summary and exports', href: '/manage/vat', count: 0 },
        { icon: 'person', title: 'Accountant access', note: 'Read-only access to the accounts', href: '/manage/accountants', count: 0 },
        { icon: 'tag', title: 'Services and rates', note: 'Lesson types, durations and prices', href: '/manage/services', count: 0 },
        { icon: 'beach_access', title: 'Holidays and term breaks', note: 'Dates with no lessons', href: '/manage/closures', count: 0 },
        { icon: 'settings', title: 'Business settings', note: 'Cancellation policy, VAT and invoicing', href: '/manage/settings', count: 0 },
        { icon: 'history', title: 'Activity log', note: 'Who changed what, and when', href: '/manage/activity', count: 0 },
        { icon: 'monitor_heart', title: 'System health', note: 'Errors, scheduled jobs and database version', href: '/manage/system-health', count: attentionCount(health.data?.checks) },
        { icon: 'delete', title: 'Deletion requests', note: 'Account deletions and records kept', href: '/manage/deletion-requests', count: deletionsWaiting },
      ],
    },
  ];
}

/** Rows whose title or note contains every word of the query. */
export function filterDirectory(groups: DirectoryGroup[], query: string): DirectoryGroup[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => words.every((w) => `${i.title} ${i.note} ${g.title}`.toLowerCase().includes(w))) }))
    .filter((g) => g.items.length);
}
