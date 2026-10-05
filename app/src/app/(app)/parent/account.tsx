import { AccountScreen } from '@/components/account';
import { FamilyContactsSection } from '@/components/family-contacts';
import { useMe } from '@/data/session';

export default function ParentAccount() {
  const me = useMe();
  return (
    <AccountScreen>
      {me.familyId ? (
        <FamilyContactsSection
          familyId={me.familyId}
          editable
          intro="Add a second parent, a personal assistant or your family office, and choose what each person receives."
        />
      ) : null}
    </AccountScreen>
  );
}
