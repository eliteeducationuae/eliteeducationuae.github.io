import { Stack } from 'expo-router';

import { EnquiryForm } from '@/components/enquiry-form';
import { LogEnquiry } from '@/components/ops/log-enquiry';
import { Screen, Txt } from '@/components/ui';
import { useSession } from '@/data/session';

/** Public "book a free consultation" form — works without an account. Admins use it to log phone enquiries. */
export default function Enquire() {
  const profile = useSession((s) => s.profile);
  const isAdmin = profile?.role === 'admin';
  // The office logs phone and referral enquiries on its own redesigned page; the public form below is unchanged.
  if (isAdmin) return <LogEnquiry />;
  return (
    <Screen>
      <Stack.Screen options={{ title: isAdmin ? 'Add an enquiry' : 'Book a complimentary consultation' }} />
      {!isAdmin ? (
        <Txt variant="muted">
          Please tell us a little about your child, and we will arrange a complimentary, no-obligation consultation with one of our
          specialist tutors.
        </Txt>
      ) : null}
      <EnquiryForm source={isAdmin ? 'phone' : 'app'} submitLabel={isAdmin ? 'Save enquiry' : 'Send enquiry'} />
    </Screen>
  );
}
