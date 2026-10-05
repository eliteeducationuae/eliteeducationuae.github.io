import { usePathname } from 'expo-router';

import { useSession } from '@/data/session';

/**
 * Tax: the screens an accountant may open. Everything else (pupils, lessons, messages, enquiries, admin tools) is
 * off limits; the data layer already returns nothing private, and this keeps the accountant out of those screens.
 * Launch: the accountant may also close their own login from Account (Data and privacy).
 */
const ACCOUNTANT_ROUTES = ['/accountant', '/invoice/', '/credit-note/', '/manage/vat', '/manage/money', '/account-delete'];

export function isAccountantRoute(pathname: string): boolean {
  return ACCOUNTANT_ROUTES.some((r) => pathname === r || pathname.startsWith(r.endsWith('/') ? r : `${r}/`));
}

/** True when the signed-in accountant is on a screen that is not theirs and should be sent home. */
export function useAccountantOffLimits(): boolean {
  const pathname = usePathname();
  const role = useSession((s) => s.profile?.role);
  return role === 'accountant' && !isAccountantRoute(pathname);
}
