import { Stack } from 'expo-router';

import { EnquiryForm } from '@/components/enquiry-form';
import { Screen, Txt } from '@/components/ui';
import { useSession } from '@/data/session';

/** Public "book a free consultation" form — works without an account. Admins use it to log phone enquiries. */
export default function Enquire() {
  const profile = useSession((s) => s.profile);
  const isAdmin = profile?.role === 'admin';
  return (
    <Screen>
      <Stack.Screen options={{ title: isAdmin ? 'Add enquiry' : 'Book a free consultation' }} />
      {!isAdmin ? (
        <Txt variant="muted">
          Tell us a little about your child and we’ll arrange a free, no-obligation consultation with one of our specialist maths
          tutors.
        </Txt>
      ) : null}
      <EnquiryForm source={isAdmin ? 'phone' : 'app'} submitLabel={isAdmin ? 'Save enquiry' : 'Send enquiry'} />
    </Screen>
  );
}
