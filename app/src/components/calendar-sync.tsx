import * as Linking from 'expo-linking';
import { Platform, Share } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useLookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import { addDays } from '@/domain/dates';
import { lessonsToICS } from '@/domain/ics';
import { notify } from '@/lib/confirm';
import { SUPABASE_URL } from '@/config';

import { Button, Card, Txt } from './ui';


/** Add lessons to Apple / Google Calendar. Production uses a live subscription feed; the demo exports a file. */
export function CalendarSyncCard() {
  const me = useMe();
  const lookup = useLookup();
  const feedUrl = source.kind === 'supabase' && me.icsToken ? `${SUPABASE_URL}/functions/v1/ics?token=${me.icsToken}` : null;

  async function exportFile() {
    const now = new Date();
    const lessons = await source.listLessons({ from: now.toISOString(), to: addDays(now, 120).toISOString() });
    const ics = lessonsToICS(lessons, (l) => ({
      title: `Elite Education: ${lookup.studentNames(l.studentIds)}`,
      description: `${lookup.service(l.serviceId)?.name ?? ''} with ${lookup.tutor(l.tutorId)?.fullName ?? ''}`,
    }));
    if (Platform.OS === 'web') {
      const blob = new Blob([ics], { type: 'text/calendar' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'elite-education-lessons.ics';
      a.click();
      URL.revokeObjectURL(a.href);
    } else {
      await Share.share({ message: ics, title: 'Elite Education lessons' });
    }
  }

  return (
    <Card style={{ gap: Spacing.two }}>
      <Txt variant="h3">Calendar sync</Txt>
      <Txt variant="muted">
        {feedUrl
          ? 'Subscribe once and your lessons will stay up to date in Apple or Google Calendar, including any changes and cancellations.'
          : 'Export your upcoming lessons to Apple or Google Calendar.'}
      </Txt>
      {feedUrl ? (
        <Button
          title="Subscribe in Calendar"
          icon="calendar"
          variant="secondary"
          onPress={() =>
            Linking.openURL(feedUrl.replace(/^https?:/, 'webcal:')).catch(() => notify('Calendar feed', feedUrl))
          }
        />
      ) : (
        <Button title="Export lessons (.ics)" icon="calendar" variant="secondary" onPress={exportFile} />
      )}
    </Card>
  );
}
