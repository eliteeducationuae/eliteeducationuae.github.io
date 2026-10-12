import { Redirect } from 'expo-router';

import { AdminVat } from '@/components/money/admin-vat';
import { useMe } from '@/data/session';

/**
 * The office's VAT returns (components/money/admin-vat). The accountant has their own read-only screen
 * (kept at this path for old links and lib/accountant-routes.ts).
 */
export default function VatReturnsRoute() {
  const role = useMe().role;
  if (role === 'accountant') return <Redirect href="/accountant/vat" />;
  return <AdminVat />;
}
