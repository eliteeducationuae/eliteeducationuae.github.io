import { Redirect } from 'expo-router';

import { AdminMoney } from '@/components/money/admin-money';
import { useMe } from '@/data/session';

/**
 * The office's Money (components/money/admin-money). The accountant has their own read-only screen
 * (kept at this path for old links and lib/accountant-routes.ts).
 */
export default function MoneyRoute() {
  const role = useMe().role;
  if (role === 'accountant') return <Redirect href="/accountant" />;
  return <AdminMoney />;
}
