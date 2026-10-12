import { Stack } from 'expo-router';

import { EnquiryForm } from '@/components/enquiry-form';
import { LogEnquiry } from '@/components/ops/log-enquiry';
import { PageHeader, Screen } from '@/components/ui';
import { useSession } from '@/data/session';

/** Public "book a free consultation" form — works without an account. Admins use it to log phone enquiries. */
export default function Enquire() {
  const profile = useSession((s) => s.profile);
  const isAdmin = profile?.role === 'admin';
  // The office logs phone and referral enquiries on its own redesigned page; the public form is below.
  if (isAdmin) return <LogEnquiry />;
  return (
    <Screen topInset narrow>
      <Stack.Screen options={{ title: 'Book a complimentary consultation', headerShown: false }} />
      <PageHeader
        back={{ fallback: '/sign-in' }}
        kicker="Elite Education"
        title="Book a complimentary consultation"
        sub="Please tell us a little about your child, and we will arrange a complimentary, no-obligation consultation with one of our specialist tutors."
      />
      <EnquiryForm source="app" submitLabel="Send enquiry" />
    </Screen>
  );
}
