import { AccountScreen } from '@/components/account';
import { AdmissionsAccountLink } from '@/components/admissions/entry-links';

export default function ParentAccount() {
  return (
    <AccountScreen>
      <AdmissionsAccountLink />
    </AccountScreen>
  );
}
