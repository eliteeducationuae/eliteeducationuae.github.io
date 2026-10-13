import { useLocalSearchParams } from 'expo-router';

import { AccountantInvoiceDetail } from '@/components/accountant/invoice-detail';
import { AdminInvoice } from '@/components/money/admin-invoice';
import { ParentInvoice } from '@/components/parent/invoice-view';
import { useMe } from '@/data/session';

/**
 * A tax invoice: the office's page (components/money/admin-invoice), the accountant's read-only layout
 * (components/accountant/invoice-detail), or the family's (components/parent/invoice-view).
 */
export default function InvoicePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useMe().role;
  if (role === 'admin') return <AdminInvoice id={id} />;
  if (role === 'accountant') return <AccountantInvoiceDetail id={id} />;
  return <ParentInvoice id={id} />;
}
