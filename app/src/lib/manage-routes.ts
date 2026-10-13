import { usePathname } from 'expo-router';

import { useSession } from '@/data/session';

/**
 * The office's own screens: everything under /manage is for admins. The data layer already refuses other roles,
 * and this keeps tutors, families and students out of the screens themselves. The accountant is left to the
 * accountant guard (lib/accountant-routes.ts), whose allowlisted /manage/money and /manage/vat redirect to their own pages.
 */
export function isManageRoute(pathname: string): boolean {
  return pathname === '/manage' || pathname.startsWith('/manage/');
}

/** True when a signed-in tutor, parent or student is on an office screen and should be sent home. */
export function useManageOffLimits(): boolean {
  const pathname = usePathname();
  const role = useSession((s) => s.profile?.role);
  return !!role && role !== 'admin' && role !== 'accountant' && isManageRoute(pathname);
}
