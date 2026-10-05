import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ClosedToggle } from '@/components/closed-accounts';
import { Avatar, Badge, Button, ListItem, Loading, Row, Screen } from '@/components/ui';
import { VettingBadge } from '@/components/vetting';
import { Spacing } from '@/constants/theme';
import { useLoginEmails, useTutorCompliance, useTutors } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { CLOSED_LABEL, closedCount, closedLast, isClosed } from '@/domain/closed-accounts';

export default function Tutors() {
  const tutors = useTutors();
  const logins = new Set(useLoginEmails().data ?? []);
  const compliance = useTutorCompliance();
  const [showClosed, setShowClosed] = useState(false);
  const closed = closedCount(tutors.data);
  return (
    <Screen footer={<Button title="Add tutor" icon="plus" variant="gold" style={{ flex: 1 }} onPress={() => router.push('/manage/tutor-edit')} />}>
      {tutors.isLoading ? (
        <Loading />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {closedLast(tutors.data, showClosed).map((t) => {
            const canLogIn = logins.has(t.email.toLowerCase());
            const vetting = compliance.data?.find((c) => c.tutorId === t.id)?.vettingStatus;
            return (
              <ListItem
                key={t.id}
                title={t.fullName}
                subtitle={
                  isClosed(t)
                    ? 'Kept for past lessons and pay records'
                    : [t.subjects.join(', ') || 'No subjects yet', (t.phases ?? []).join(', '), `${formatAED(t.hourlyPay)} an hour`].filter(Boolean).join(' · ')
                }
                left={<Avatar name={t.fullName} color={t.color} />}
                below={
                  isClosed(t) ? (
                    <Badge label={CLOSED_LABEL} />
                  ) : (
                    <Row gap={Spacing.one} wrap>
                      <Badge label={canLogIn ? 'Can log in' : 'No login yet'} tone={canLogIn ? 'success' : 'neutral'} />
                      {vetting ? <VettingBadge status={vetting} /> : null}
                    </Row>
                  )
                }
                onPress={() => router.push({ pathname: '/manage/tutor-edit', params: { id: t.id } })}
              />
            );
          })}
          <ClosedToggle count={closed} showing={showClosed} onToggle={() => setShowClosed((s) => !s)} />
        </View>
      )}
    </Screen>
  );
}
