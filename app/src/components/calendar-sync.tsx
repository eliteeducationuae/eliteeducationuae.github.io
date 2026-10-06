import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Platform, Share, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useLookup } from '@/data/hooks';
import { useMe, useSession, useViewing } from '@/data/session';
import { addDays } from '@/domain/dates';
import { lessonsToICS } from '@/domain/ics';
import { confirm, notify } from '@/lib/confirm';
import { SUPABASE_URL } from '@/config';

import { Banner, Button, Card, ErrorNote, Section, Txt } from './ui';
import { useCanViewAs, useViewTargetsFor, type ViewAsRef } from './view-as';

export const RESET_ICS_TITLE = 'Reset calendar link';
export const RESET_ICS_CONFIRM =
  'Reset your calendar link? Calendars that use the old link will stop updating, and you will need to subscribe again with the new one.';
export const RESET_ICS_DONE = 'Your calendar link has been reset. Please subscribe again with the new link in any calendar that used the old one.';

/** The confirmation an admin sees before resetting someone else's calendar link. */
export const resetIcsConfirmFor = (name: string) =>
  `Reset ${name}'s calendar link? Calendars that use the old link will stop updating, and they will need to subscribe again with the new one.`;
/** The note an admin sees once someone else's calendar link has been reset. */
export const resetIcsDoneFor = (name: string) =>
  `${name}'s calendar link has been reset. They will need to subscribe again with the new link from their Account screen.`;

/**
 * "Reset calendar link": a new secret feed address for the signed-in person, so a link that has been shared or leaked
 * stops working. Hidden while an admin is viewing as someone else (the change would be refused anyway).
 */
function ResetIcsLink() {
  const viewing = useViewing();
  const resetMyIcsToken = useSession((s) => s.resetMyIcsToken);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (viewing || !source.resetIcsToken) return null;
  const reset = () =>
    confirm(
      RESET_ICS_TITLE,
      RESET_ICS_CONFIRM,
      async () => {
        setBusy(true);
        setDone(false);
        setError(null);
        try {
          await resetMyIcsToken();
          setDone(true);
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      },
      'Reset',
    );
  return (
    <View style={{ gap: Spacing.two }}>
      <Button title={RESET_ICS_TITLE} icon="repeat" variant="ghost" size="sm" loading={busy} onPress={reset} />
      {done ? (
        <Banner tone="success" icon="check">
          {RESET_ICS_DONE}
        </Banner>
      ) : null}
      <ErrorNote error={error} />
    </View>
  );
}

/**
 * Admin, on a tutor or family page: reset the calendar link of each login linked to them. Shown only to an admin on
 * their own account (never while viewing as someone).
 */
export function AdminIcsResetActions(ref: ViewAsRef) {
  const canAct = useCanViewAs();
  const targets = useViewTargetsFor(ref);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [doneName, setDoneName] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!canAct || !source.resetIcsToken || !targets.list.length) return null;
  const reset = (profileId: string, name: string) =>
    confirm(
      RESET_ICS_TITLE,
      resetIcsConfirmFor(name),
      async () => {
        setBusyId(profileId);
        setDoneName(null);
        setError(null);
        try {
          await source.resetIcsToken!(profileId);
          setDoneName(name);
        } catch (err) {
          setError(err);
        } finally {
          setBusyId(null);
        }
      },
      'Reset',
    );
  return (
    <Section title="Calendar link">
      <View style={{ gap: Spacing.two }}>
        {targets.list.map((t) => (
          <Button
            key={t.profileId}
            title={`Reset calendar link for ${t.fullName}`}
            icon="repeat"
            variant="secondary"
            loading={busyId === t.profileId}
            disabled={!!busyId && busyId !== t.profileId}
            onPress={() => reset(t.profileId, t.fullName)}
          />
        ))}
        <Txt variant="small">Use this if a calendar feed link has been shared or leaked. The old link stops working at once.</Txt>
        {doneName ? (
          <Banner tone="success" icon="check">
            {resetIcsDoneFor(doneName)}
          </Banner>
        ) : null}
        <ErrorNote error={error} />
      </View>
    </Section>
  );
}

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

  const staff = me.role === 'admin' || me.role === 'tutor';
  const title = staff ? 'Calendar subscription' : 'Add lessons to your calendar';
  const detail = staff
    ? feedUrl
      ? 'Google Calendar sync above is the recommended option. Alternatively, subscribe to a read-only feed of your lessons in Apple Calendar or another calendar application.'
      : 'Google Calendar sync above is the recommended option. Alternatively, export your upcoming lessons as a file for Apple Calendar or another calendar application.'
    : feedUrl
      ? 'Subscribe once and your lessons will remain up to date in Apple or Google Calendar, including any changes and cancellations.'
      : 'Export your upcoming lessons as a file that can be added to Apple or Google Calendar.';

  return (
    <Card style={{ gap: Spacing.two }}>
      <Txt variant="h3">{title}</Txt>
      <Txt variant="muted">{detail}</Txt>
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
      {/* The demo has no live feed, but shows the reset so it can be tried. */}
      {feedUrl || source.kind === 'demo' ? <ResetIcsLink /> : null}
    </Card>
  );
}
