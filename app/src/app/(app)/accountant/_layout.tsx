import { useVatReturnDueCount } from '@/components/accountant/format';
import { RoleTabs } from '@/components/role-tabs';

/**
 * The accountant reads the books: money, invoices and VAT returns. No messages, students or search. Each screen draws
 * its own Hero or PageHeader, so the native headers are hidden. The VAT tab carries a badge while a return is due.
 */
export default function AccountantLayout() {
  return (
    <RoleTabs
      role="accountant"
      variant="sand"
      tabs={[
        { name: 'index', title: 'Money', icon: 'payments', headerShown: false },
        { name: 'invoices', title: 'Invoices', icon: 'receipt_long', headerShown: false },
        { name: 'vat', title: 'VAT', icon: 'account_balance', headerShown: false, badge: useVatReturnDueCount },
        { name: 'account', title: 'Account', icon: 'person', headerShown: false },
      ]}
    />
  );
}
