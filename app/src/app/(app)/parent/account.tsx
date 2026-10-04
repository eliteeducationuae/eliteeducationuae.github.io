import { View } from 'react-native';

import { AccountScreen } from '@/components/account';
import { FamilyContactsSection } from '@/components/family-contacts';
import { Card, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useMe } from '@/data/session';

export default function ParentAccount() {
  const me = useMe();
  return (
    <AccountScreen>
      {me.familyId ? (
        <View style={{ gap: Spacing.three }}>
          <Card style={{ gap: Spacing.one }}>
            <Txt variant="h3">Your family&apos;s contacts</Txt>
            <Txt variant="muted">Add a second parent, a personal assistant or your family office, and choose what each person receives.</Txt>
          </Card>
          <FamilyContactsSection familyId={me.familyId} editable />
        </View>
      ) : null}
    </AccountScreen>
  );
}
