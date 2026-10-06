import { closedToggleLabel } from '@/domain/closed-accounts';

import { Button } from './ui';

/** A quiet "Show 2 closed accounts" button under a list; nothing when there are none. */
export function ClosedToggle({ count, showing, onToggle }: { count: number; showing: boolean; onToggle: () => void }) {
  if (!count) return null;
  return <Button title={closedToggleLabel(count, showing)} variant="ghost" size="sm" onPress={onToggle} />;
}
