import { useLocalSearchParams } from 'expo-router';

import { HandoverScreen } from '@/components/handover';

/** One handover: the full pack for the incoming tutor and admins, the note editor for the outgoing tutor. */
export default function HandoverPackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <HandoverScreen id={id} />;
}
