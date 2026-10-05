import { Redirect } from 'expo-router';

import { DEMO_MODE } from '@/config';

/**
 * Demo builds only: throws while rendering so the branded error screen and error reporting can be checked.
 * The message deliberately holds an email address and a phone number, which reporting must scrub.
 * In the live app this route simply returns home.
 */
export default function DemoError() {
  if (!DEMO_MODE) return <Redirect href="/" />;
  throw new Error('Demo render error for parent@example.com on +971 50 123 4567');
}
