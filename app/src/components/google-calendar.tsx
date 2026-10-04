import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { source } from '@/data';
import { useAction, useCalendarConnection } from '@/data/hooks';
import { useMe } from '@/data/session';
import { type ConnectNotice, connectionSummary, connectResultNotice } from '@/domain/calendar-connection';
import { confirm, notify } from '@/lib/confirm';

import { Icon } from './icon';
import { Badge, Banner, Button, Card, Row, Txt } from './ui';

/** The result Google's sign-in leaves in the address when the web page returns (?calendar=connected or =error). */
function readReturnNotice(): ConnectNotice | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return connectResultNotice(window.location.search);
}

const connectGoogle = () => source.connectGoogleCalendar?.() ?? Promise.resolve('cancelled' as const);
const disconnectGoogle = () => source.disconnectGoogleCalendar?.() ?? Promise.resolve();

/** Two-way Google Calendar link for tutors and the office: lessons and Meet links out, busy times in. */
export function GoogleCalendarCard() {
  const me = useMe();
  const theme = useTheme();
  const pathname = usePathname();
  const connection = useCalendarConnection();
  const connect = useAction(connectGoogle);
  const disconnect = useAction(disconnectGoogle);
  const [mountedAt] = useState(() => Date.now());
  const [notice] = useState(readReturnNotice);

  // Tidy the one-off result out of the address so a reload does not repeat it. The router owns the address on
  // the web, so the page is replaced through it without the parameters (a direct history change would be put back).
  useEffect(() => {
    if (!notice || Platform.OS !== 'web') return;
    router.replace(pathname as Href);
  }, [notice, pathname]);

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
      {summary.warning ? (
        <Row gap={Spacing.one} style={{ alignItems: 'flex-start' }}>
          <Icon name="alert" size={16} color={theme.warning} />
          <Txt variant="small" style={{ flex: 1 }} accessibilityRole="alert">
            {summary.warning}
          </Txt>
        </Row>
      ) : null}
      {summary.action === 'disconnect' ? (
        <Button
          title="Disconnect"
          variant="ghost"
          size="sm"
          loading={disconnect.isPending}
          disabled={busy}
          onPress={onDisconnect}
          style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }}
        />
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
            <Button title="Disconnect" variant="ghost" size="sm" disabled={busy} onPress={onDisconnect} style={{ alignSelf: 'center' }} />
          ) : null}
        </Row>
      )}
      <Txt variant="small">
        Only the times you are busy are shared with Elite Education, never the details of your events.
      </Txt>
    </Card>
  );
}
