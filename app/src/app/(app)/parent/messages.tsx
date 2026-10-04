import { Conversation } from '@/components/messages';
import { EmptyState, Screen } from '@/components/ui';
import { useMe } from '@/data/session';

/** Parents have a single conversation with Elite Education and their children's tutors. */
export default function ParentMessages() {
  const me = useMe();
  if (!me.familyId) {
    return (
      <Screen>
        <EmptyState title="Messages are not yet available for this account" message="Please contact Elite Education and we will set this up for you." />
      </Screen>
    );
  }
  return <Conversation familyId={me.familyId} />;
}
