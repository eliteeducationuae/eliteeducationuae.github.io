import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useSettings } from '@/data/hooks';
import { queryClient } from '@/data/query';
import { useMe, useSession } from '@/data/session';
import { confirm } from '@/lib/confirm';

import { CalendarSyncCard } from './calendar-sync';
import { GoogleCalendarCard } from './google-calendar';
import { WhatsAppCard } from './whatsapp-card';
import { Avatar, Badge, Button, Card, Row, Screen, Section, Txt } from './ui';

/** Profile, calendar sync, policies and sign-out — shared by every role. `children` render first. */
export function AccountScreen({ children }: { children?: ReactNode }) {
  const me = useMe();
  const signOut = useSession((s) => s.signOut);
  const settings = useSettings();
  const [resetting, setResetting] = useState(false);
  // The accountant reads the books only: no lessons to sync and no lesson policies.
  const books = me.role === 'accountant';

  return (
    <Screen>
      {children}
      <Card>
        <Row gap={Spacing.three}>
          <Avatar name={me.fullName} size={52} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="h2">{me.fullName}</Txt>
            <Txt variant="muted">{me.email}</Txt>
            <Badge label={me.role} tone="info" />
          </View>
        </Row>
      </Card>

      <GoogleCalendarCard />
      {books ? null : <CalendarSyncCard />}
      <WhatsAppCard />

      {settings.data && !books ? (
        <Section title="Policies">
          <Card>
            <Txt>
              Lessons cancelled with less than {settings.data.cancellationHours} hours’ notice are charged
              {settings.data.lateCancelFee < 1 ? ` at ${Math.round(settings.data.lateCancelFee * 100)}%` : ' in full'}. Invoices
              are due within {settings.data.invoiceDueDays} days.
            </Txt>
          </Card>
        </Section>
      ) : null}

      {source.kind === 'demo' && source.resetDemo ? (
        <Section title="Demo">
          <Button
            title="Reset demo data"
            variant="secondary"
            icon="repeat"
            loading={resetting}
            onPress={() =>
              confirm('Reset demo data?', 'This restores the original sample lessons, notes and invoices.', async () => {
                setResetting(true);
                await source.resetDemo!();
                await queryClient.invalidateQueries();
                setResetting(false);
              })
            }
          />
        </Section>
      ) : null}

      <Button title="Sign out" variant="danger" icon="logout" onPress={() => signOut()} />
    </Screen>
  );
}
