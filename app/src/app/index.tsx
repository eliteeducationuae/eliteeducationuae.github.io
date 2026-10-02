import { Redirect } from 'expo-router';

import { Loading } from '@/components/ui';
import { useSession } from '@/data/session';

/** Send people to the right home for their role. */
export default function Index() {
  const { status, profile } = useSession();
  if (status === 'loading') return <Loading />;
  if (!profile) return <Redirect href="/sign-in" />;
  return <Redirect href={`/${profile.role}`} />;
}
