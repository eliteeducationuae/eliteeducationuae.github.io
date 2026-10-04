import { Stack, useLocalSearchParams } from 'expo-router';

import { Conversation } from '@/components/messages';
import { useLookup } from '@/data/hooks';

export default function ConversationScreen() {
  const { familyId } = useLocalSearchParams<{ familyId: string }>();
  const lookup = useLookup();
  const family = lookup.family(familyId);
  return (
    <>
      <Stack.Screen options={{ title: family ? `${family.name} family` : 'Messages' }} />
      <Conversation familyId={familyId} />
    </>
  );
}
