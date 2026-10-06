import { Redirect, Stack } from 'expo-router';

import { stackOptions } from '@/components/stack-options';
import { Loading } from '@/components/ui';
import { ViewAsFrame, viewAsScreenLayout } from '@/components/view-as';
import { useSession } from '@/data/session';
import { useTheme } from '@/hooks/use-theme';
import { useAccountantOffLimits } from '@/lib/accountant-routes';

// Launch readiness: a calm, branded screen when something here fails to render.
export { ErrorBoundary } from '@/components/error-boundary';

/**
 * Everything behind sign-in. Waits for the saved session before rendering, so deep links and
 * notification taps open the right screen, and sends signed-out visitors to the sign-in page.
 */
export default function SignedInLayout() {
  const palette = useTheme();
  const status = useSession((s) => s.status);
  const accountantOffLimits = useAccountantOffLimits();
  if (status === 'loading') return <Loading />;
  if (status === 'signed-out') return <Redirect href="/sign-in" />;
  // Tax: the accountant only sees the books.
  if (accountantOffLimits) return <Redirect href="/accountant" />;
  const stack = (
    <Stack screenOptions={stackOptions(palette)} screenLayout={viewAsScreenLayout}>
      <Stack.Screen name="admin" options={{ headerShown: false }} />
      <Stack.Screen name="tutor" options={{ headerShown: false }} />
      <Stack.Screen name="parent" options={{ headerShown: false }} />
      <Stack.Screen name="student" options={{ headerShown: false }} />
      <Stack.Screen name="accountant" options={{ headerShown: false }} />
      <Stack.Screen name="lesson/[id]" options={{ title: 'Lesson' }} />
      <Stack.Screen name="lesson/new" options={{ title: 'Schedule lessons', presentation: 'modal' }} />
      <Stack.Screen name="complete/[id]" options={{ title: 'Record lesson', presentation: 'modal' }} />
      <Stack.Screen name="homework/[id]" options={{ title: 'Homework' }} />
      <Stack.Screen name="homework/new" options={{ title: 'Set homework', presentation: 'modal' }} />
      <Stack.Screen name="resources/index" options={{ title: 'Resource library' }} />
      <Stack.Screen name="resources/edit" options={{ title: 'Resource', presentation: 'modal' }} />
      <Stack.Screen name="students/[id]" options={{ title: 'Student' }} />
      <Stack.Screen name="students/edit" options={{ title: 'Student', presentation: 'modal' }} />
      <Stack.Screen name="invoice/[id]" options={{ title: 'Invoice' }} />
      <Stack.Screen name="manage/tutors" options={{ title: 'Tutors' }} />
      <Stack.Screen name="manage/tutor-edit" options={{ title: 'Tutor', presentation: 'modal' }} />
      <Stack.Screen name="manage/families" options={{ title: 'Families' }} />
      <Stack.Screen name="manage/family-edit" options={{ title: 'Family', presentation: 'modal' }} />
      <Stack.Screen name="contacts/edit" options={{ title: 'Contact', presentation: 'modal' }} />
      <Stack.Screen name="manage/services" options={{ title: 'Services and rates' }} />
      <Stack.Screen name="manage/package-new" options={{ title: 'Sell a package', presentation: 'modal' }} />
      <Stack.Screen name="manage/payroll" options={{ title: 'Tutor pay' }} />
      <Stack.Screen name="manage/settings" options={{ title: 'Business settings' }} />
      <Stack.Screen name="manage/enquiries" options={{ title: 'Enquiries' }} />
      <Stack.Screen name="manage/enquiry/[id]" options={{ title: 'Enquiry' }} />
      <Stack.Screen name="manage/requests" options={{ title: 'Lesson requests' }} />
      <Stack.Screen name="manage/closures" options={{ title: 'Holidays and term breaks' }} />
      <Stack.Screen name="manage/opportunities" options={{ title: 'Roles for tutors' }} />
      <Stack.Screen name="manage/opportunity/[id]" options={{ title: 'Role' }} />
      <Stack.Screen name="manage/opportunity-edit" options={{ title: 'Post a role', presentation: 'modal' }} />
      <Stack.Screen name="manage/applications" options={{ title: 'Hiring' }} />
      <Stack.Screen name="manage/application/[id]" options={{ title: 'Application' }} />
      <Stack.Screen name="manage/tutor-invoices" options={{ title: 'Tutor invoices' }} />
      <Stack.Screen name="manage/activity" options={{ title: 'Activity log' }} />
      <Stack.Screen name="search" options={{ title: 'Search', presentation: 'modal' }} />
      <Stack.Screen name="manage/money" options={{ title: 'Money' }} />
      <Stack.Screen name="manage/expense-edit" options={{ title: 'Expense', presentation: 'modal' }} />
      <Stack.Screen name="manage/insights" options={{ title: 'Insights' }} />
      <Stack.Screen name="manage/reports" options={{ title: 'Student reports' }} />
      <Stack.Screen name="reports/index" options={{ title: 'Reports to write' }} />
      <Stack.Screen name="reports/[id]" options={{ title: 'Report' }} />
      <Stack.Screen name="opportunities/index" options={{ title: 'Opportunities' }} />
      <Stack.Screen name="opportunities/[id]" options={{ title: 'Opportunity' }} />
      <Stack.Screen name="tutor-invoices/index" options={{ title: 'My invoices' }} />
      <Stack.Screen name="tutor-invoices/[id]" options={{ title: 'Invoice' }} />
      <Stack.Screen name="payment-details" options={{ title: 'Payment details' }} />
      <Stack.Screen name="onboarding" options={{ title: 'Welcome' }} />
      <Stack.Screen name="book" options={{ title: 'Book a lesson', presentation: 'modal' }} />
      <Stack.Screen name="availability" options={{ title: 'Availability' }} />
      <Stack.Screen name="pay" options={{ title: 'My pay' }} />
      <Stack.Screen name="messages/index" options={{ title: 'Messages' }} />
      <Stack.Screen name="messages/[familyId]" options={{ title: 'Messages' }} />
      <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
      <Stack.Screen name="credit-note/[id]" options={{ title: 'Credit note' }} />
      <Stack.Screen name="credit-note/new" options={{ title: 'Issue a credit note', presentation: 'modal' }} />
      <Stack.Screen name="refund" options={{ title: 'Refund a payment', presentation: 'modal' }} />
      <Stack.Screen name="manage/vat" options={{ title: 'VAT returns' }} />
      <Stack.Screen name="manage/accountants" options={{ title: 'Accountant access' }} />
      {/* Admissions advisory */}
      <Stack.Screen name="admissions/index" options={{ title: 'Admissions advisory' }} />
      <Stack.Screen name="admissions/[id]" options={{ title: 'Admissions' }} />
      <Stack.Screen name="admissions/edit" options={{ title: 'Admissions case', presentation: 'modal' }} />
      <Stack.Screen name="admissions/target" options={{ title: 'Shortlist', presentation: 'modal' }} />
      <Stack.Screen name="admissions/date" options={{ title: 'Key date', presentation: 'modal' }} />
      <Stack.Screen name="admissions/task" options={{ title: 'Task', presentation: 'modal' }} />
      <Stack.Screen name="admissions/update" options={{ title: 'Advisory update' }} />
      <Stack.Screen name="admissions/bill" options={{ title: 'Bill advisory fee', presentation: 'modal' }} />
      <Stack.Screen name="checks" options={{ title: 'My checks' }} />
      <Stack.Screen name="handbook" options={{ title: 'Tutor handbook' }} />
      <Stack.Screen name="handbook-edit" options={{ title: 'Edit handbook', presentation: 'modal' }} />
      <Stack.Screen name="manage/vetting/index" options={{ title: 'Tutor checks' }} />
      <Stack.Screen name="manage/vetting/[tutorId]" options={{ title: 'Tutor checks' }} />
      {/* Launch readiness */}
      <Stack.Screen name="account-delete" options={{ title: 'Delete my account' }} />
      <Stack.Screen name="manage/system-health" options={{ title: 'System health' }} />
      <Stack.Screen name="manage/deletion-requests" options={{ title: 'Deletion requests' }} />
      <Stack.Screen name="demo-error" options={{ title: 'Elite Education' }} />
      <Stack.Screen name="plan/[id]" options={{ title: 'Lesson plan', presentation: 'modal' }} />
      <Stack.Screen name="handover/index" options={{ title: 'Handover packs' }} />
      <Stack.Screen name="handover/[id]" options={{ title: 'Handover pack' }} />
    </Stack>
  );
  // While an admin is viewing as someone else, the frame adds the "View as" banner above every screen.
  return <ViewAsFrame>{stack}</ViewAsFrame>;
}
