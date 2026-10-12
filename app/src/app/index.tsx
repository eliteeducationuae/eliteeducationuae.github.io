import { Redirect, type Href } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';

import { Loading } from '@/components/ui';
import { useSession } from '@/data/session';

/** On the web, 404.html hands deep links (e.g. /app/invoice/…) to the app via sessionStorage. Read it once. */
function takePendingLink(): string | null {
  if (Platform.OS !== 'web') return null;
  try {
    const target = sessionStorage.getItem('elite.redirect');
    sessionStorage.removeItem('elite.redirect');
    // Only paths inside the app: never '//host' or '/\host', which a browser would read as another site.
    return target && target.startsWith('/') && !/^\/[/\\]/.test(target) && target !== '/' ? target : null;
  } catch {
    return null;
  }
}

/** Send people to the right home for their role (or to the link they opened). */
export default function Index() {
  const { status, profile } = useSession();
  const [pending] = useState(takePendingLink);
  if (status === 'loading') return <Loading />;
  if (pending) return <Redirect href={pending as Href} />;
  if (!profile) return <Redirect href="/sign-in" />;
  return <Redirect href={`/${profile.role}`} />;
}
