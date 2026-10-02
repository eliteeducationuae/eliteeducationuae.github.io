import { Conversation } from '@/components/messages';
import { EmptyState, Screen } from '@/components/ui';
import { useMe } from '@/data/session';

/** Parents have a single conversation with Elite Education and their children's tutors. */
export default function ParentMessages() {
  const me = useMe();
  if (!me.familyId) {
    return (
      <Screen>
        <EmptyState title="Messages aren’t set up for this account" />
      </Screen>
    );
  }
  return <Conversation familyId={me.familyId} />;
}
