import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useCalendarConnection } from '@/data/hooks';
import { useMe } from '@/data/session';
import { connectionSummary } from '@/domain/calendar-connection';
import { confirm, notify } from '@/lib/confirm';

import { Badge, Banner, Button, Card, Row, Txt } from './ui';

type ReturnNotice = { tone: 'success' | 'warning'; message: string } | null;

/** The result Google's sign-in leaves in the address when the web page returns (?calendar=connected or =error). */
function readReturnNotice(): ReturnNotice {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const result = new URLSearchParams(window.location.search).get('calendar');
  if (result === 'connected') {
    return { tone: 'success', message: 'Your Google Calendar is now connected. Lessons will appear there within a few minutes.' };
  }
  if (result === 'error') {
    return { tone: 'warning', message: 'Google Calendar could not be connected. Please try again.' };
  }
  return null;
}

const connectGoogle = () => source.connectGoogleCalendar?.() ?? Promise.resolve('cancelled' as const);
const disconnectGoogle = () => source.disconnectGoogleCalendar?.() ?? Promise.resolve();

/** Two-way Google Calendar link for tutors and the office: lessons and Meet links out, busy times in. */
export function GoogleCalendarCard() {
  const me = useMe();
  const connection = useCalendarConnection();
  const connect = useAction(connectGoogle);
  const disconnect = useAction(disconnectGoogle);
  const [mountedAt] = useState(() => Date.now());
  const [notice] = useState(readReturnNotice);

  // Tidy the one-off result out of the address so a reload does not repeat it.
  useEffect(() => {
    if (!notice || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('calendar');
    url.searchParams.delete('reason');
    window.history.replaceState(window.history.state, '', url.toString());
  }, [notice]);

  if (me.role !== 'admin' && me.role !== 'tutor') return null;
  if (!source.connectGoogleCalendar) return null;

  const conn = connection.data ?? null;
  // "Now" is the moment the connection was last fetched, so the wording refreshes with each refetch.
  const now = new Date(connection.dataUpdatedAt || mountedAt);
  const summary = connectionSummary(conn, now);
  const busy = connect.isPending || disconnect.isPending;

  async function onConnect() {
    try {
      await connect.mutateAsync([]);
    } catch (e) {
      notify('Google Calendar', e instanceof Error ? e.message : 'Google Calendar could not be connected. Please try again.');
    }
  }

  function onDisconnect() {
    confirm(
      'Disconnect Google Calendar?',
      'Lessons will no longer be added to your Google Calendar, and your busy times will stop blocking bookings.',
      () => {
        disconnect.mutateAsync([]).catch((e: unknown) =>
          notify('Google Calendar', e instanceof Error ? e.message : 'Google Calendar could not be disconnected. Please try again.'),
        );
      },
      'Disconnect',
    );
  }

  return (
    <Card style={{ gap: Spacing.two }}>
      <Row gap={Spacing.two} style={{ justifyContent: 'space-between' }}>
        <Txt variant="h3">Google Calendar</Txt>
        {connection.isLoading ? null : <Badge label={summary.status} tone={summary.tone} />}
      </Row>
      {notice ? (
        <Banner tone={notice.tone} icon={notice.tone === 'success' ? 'check' : 'alert'}>
          {notice.message}
        </Banner>
      ) : null}
      {conn?.status === 'error' ? (
        <Banner tone="warning" icon="alert">
          {summary.detail}
        </Banner>
      ) : (
        <Txt variant="muted">{summary.detail}</Txt>
      )}
      {summary.action === 'disconnect' ? (
        <Button title="Disconnect" variant="secondary" icon="close" loading={disconnect.isPending} disabled={busy} onPress={onDisconnect} />
      ) : (
        <Row gap={Spacing.two} wrap>
          <Button
            title={summary.action === 'reconnect' ? 'Reconnect' : 'Connect Google Calendar'}
            icon="calendar"
            loading={connect.isPending}
            disabled={busy}
            onPress={onConnect}
          />
          {summary.action === 'reconnect' ? (
            <Button title="Disconnect" variant="secondary" icon="close" disabled={busy} onPress={onDisconnect} />
          ) : null}
        </Row>
      )}
      <Txt variant="small">
        Only the times you are busy are shared with Elite Education, never the details of your events.
      </Txt>
    </Card>
  );
}
