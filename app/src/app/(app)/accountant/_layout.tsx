import { RoleTabs } from '@/components/role-tabs';

/** The accountant reads the books: money, invoices and VAT returns. No messages, students or search. */
export default function AccountantLayout() {
  return (
    <RoleTabs
      role="accountant"
      tabs={[
        { name: 'index', title: 'Money', icon: 'money' },
        { name: 'invoices', title: 'Invoices', icon: 'doc', header: 'Invoices, credit notes and refunds' },
        { name: 'vat', title: 'VAT', icon: 'chart', header: 'VAT returns' },
        { name: 'account', title: 'Account', icon: 'person' },
      ]}
    />
  );
}
