import { Stack } from 'expo-router';

import { EnquiryForm } from '@/components/enquiry-form';
import { PageHeader, Screen } from '@/components/ui';
import { useSession } from '@/data/session';

/** Public "book a free consultation" form — works without an account. Admins use it to log phone enquiries. */
export default function Enquire() {
  const profile = useSession((s) => s.profile);
  const isAdmin = profile?.role === 'admin';
  return (
    <Screen topInset narrow={!isAdmin}>
      <Stack.Screen options={{ title: isAdmin ? 'Add an enquiry' : 'Book a complimentary consultation', headerShown: false }} />
      <PageHeader
        back={{ fallback: isAdmin ? '/admin' : '/sign-in' }}
        kicker={isAdmin ? 'Enquiries' : 'Elite Education'}
        title={isAdmin ? 'Add an enquiry' : 'Book a complimentary consultation'}
        sub={
          isAdmin
            ? undefined
            : 'Please tell us a little about your child, and we will arrange a complimentary, no-obligation consultation with one of our specialist tutors.'
        }
      />
      <EnquiryForm source={isAdmin ? 'phone' : 'app'} submitLabel={isAdmin ? 'Save enquiry' : 'Send enquiry'} />
    </Screen>
  );
}
