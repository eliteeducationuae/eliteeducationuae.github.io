import { CloseLoginScreen } from '@/components/accountant/close-login';
import { DeleteAccountScreen } from '@/components/delete-account';
import { useSession } from '@/data/session';

export default function AccountDelete() {
  // The accountant closes their login from a shorter page of their own (the books are not theirs to delete).
  const role = useSession((s) => s.profile?.role);
  if (role === 'accountant') return <CloseLoginScreen />;
  return <DeleteAccountScreen />;
}
