import { useState } from 'react';
import { View } from 'react-native';

import { NoHeader } from '@/components/ops/parts';
import { Actions, Button, EmptyState, ErrorNote, Field, FieldsCard, Group, GroupRow, Loading, PageHeader, Screen, Txt, useToast, useWide } from '@/components/ui';
import { source } from '@/data';
import { useAction, useClosures, useLessons } from '@/data/hooks';
import { addDays, toDateKey } from '@/domain/dates';
import type { Closure } from '@/domain/types';
import { confirm } from '@/lib/confirm';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A `YYYY-MM-DD` key as a local date (never parsed as UTC). */
const local = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** "26 – 30 Oct", "30 Nov – 3 Dec", "14 Dec 2026 – 4 Jan 2027". */
function rangeLabel(start: string, end: string): string {
  const a = local(start);
  const b = local(end);
  const year = (d: Date) => (a.getFullYear() !== b.getFullYear() ? ` ${d.getFullYear()}` : '');
  if (start === end) return `${a.getDate()} ${MONTHS[a.getMonth()]}`;
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]}${year(a)} – ${b.getDate()} ${MONTHS[b.getMonth()]}${year(b)}`;
}

/**
 * Term breaks and public holidays. They only affect scheduling from now on: weekly lessons scheduled later skip
 * them, and families cannot request them. Lessons already booked on these days stay booked.
 */
export default function Closures() {
  const closures = useClosures();
  const save = useAction(source.saveClosure);
  const remove = useAction(source.deleteClosure);
  const toast = useToast();
  const wide = useWide();
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [tried, setTried] = useState(false);
  const today = toDateKey(new Date());
  const list = [...(closures.data ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const upcoming = list.filter((c) => c.endDate >= today);
  // Lessons already booked inside the breaks, so the office can see what stays in the diary.
  const first = upcoming[0]?.startDate ?? today;
  const last = upcoming.reduce((m, c) => (c.endDate > m ? c.endDate : m), first);
  const lessons = useLessons(local(first), addDays(local(last), 1));
  if (closures.isLoading) return <Loading />;

  const booked = (c: Closure) =>
    (lessons.data ?? []).filter((l) => {
      if (l.status !== 'scheduled') return false;
      const k = toDateKey(new Date(l.start));
      return k >= c.startDate && k <= c.endDate;
    }).length;

  const badStart = !DATE.test(start);
  const badEnd = !!end && (!DATE.test(end) || end < start);
  const valid = !!name.trim() && !badStart && !badEnd;

  async function add() {
    setTried(true);
    if (!valid) return;
    await save.mutateAsync([{ name: name.trim(), startDate: start, endDate: end || start }]);
    toast(`${name.trim()} added. New weekly lessons will skip it.`);
    setName('');
    setStart('');
    setEnd('');
    setTried(false);
  }

  return (
    <Screen topInset>
      <NoHeader />
      <PageHeader
        back
        kicker="Manage"
        title="Holidays and term breaks"
        sub="When you schedule weekly lessons, these dates are skipped, and families cannot request lessons on them. Lessons already booked are not cancelled."
      />
      {upcoming.length === 0 ? (
        <EmptyState icon="beach_access" title="No holidays set" message="Add school holidays and term breaks below so that new weekly lessons skip them." />
      ) : (
        <Group>
          {upcoming.map((c) => {
            const n = booked(c);
            return (
              <GroupRow
                key={c.id}
                title={c.name}
                note={
                  lessons.isLoading
                    ? rangeLabel(c.startDate, c.endDate)
                    : `${rangeLabel(c.startDate, c.endDate)} · ${
                        n ? `${n} lesson${n === 1 ? ' is' : 's are'} already booked and will go ahead` : 'No lessons booked'
                      }`
                }
                icon="beach_access"
                action={{
                  label: 'Remove',
                  variant: 'secondary',
                  accessibilityLabel: `Remove ${c.name}`,
                  onPress: () =>
                    confirm(
                      'Remove this break?',
                      `${c.name} will no longer be skipped when you schedule weekly lessons.`,
                      () =>
                        remove.mutate([c.id], {
                          onSuccess: () => toast(`${c.name} removed`),
                        }),
                      'Remove',
                    ),
                }}
              />
            );
          })}
        </Group>
      )}
      <ErrorNote error={remove.error} />

      <View style={wide ? { maxWidth: 560 } : undefined}>
        <FieldsCard title="Add a break or holiday">
          <Field label="Name" value={name} onChangeText={setName} placeholder="For example, Eid al-Fitr or Spring break" error={tried && !name.trim()} />
          <Field
            label="From"
            value={start}
            onChangeText={setStart}
            placeholder="YYYY-MM-DD"
            error={tried && badStart ? 'Use YYYY-MM-DD, for example 2026-12-14.' : undefined}
          />
          <Field
            label="To (optional)"
            value={end}
            onChangeText={setEnd}
            placeholder="YYYY-MM-DD"
            error={tried && badEnd ? 'Use YYYY-MM-DD, on or after the first day.' : undefined}
            hint="Leave blank for a single day."
          />
          <Txt variant="note">Only scheduling from now on is affected: lessons already booked on these days stay in the diary.</Txt>
          <ErrorNote error={save.error} />
          <Actions>
            <Button title="Add to the calendar" icon="add" loading={save.isPending} onPress={() => add().catch(() => undefined)} />
          </Actions>
        </FieldsCard>
      </View>
    </Screen>
  );
}
