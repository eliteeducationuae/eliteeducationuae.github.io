import { router } from 'expo-router';
import { View } from 'react-native';

import { Avatar, Badge, Button, ListItem, Loading, Row, Screen } from '@/components/ui';
import { VettingBadge } from '@/components/vetting';
import { Spacing } from '@/constants/theme';
import { useLoginEmails, useTutorCompliance, useTutors } from '@/data/hooks';
import { formatAED } from '@/domain/billing';

export default function Tutors() {
  const tutors = useTutors();
  const logins = new Set(useLoginEmails().data ?? []);
  const compliance = useTutorCompliance();
  return (
    <Screen footer={<Button title="Add tutor" icon="plus" variant="gold" style={{ flex: 1 }} onPress={() => router.push('/manage/tutor-edit')} />}>
      {tutors.isLoading ? (
        <Loading />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {(tutors.data ?? []).map((t) => (
            <ListItem
              key={t.id}
              title={t.fullName}
              subtitle={[t.subjects.join(', ') || 'No subjects yet', (t.phases ?? []).join(', '), `${formatAED(t.hourlyPay)} an hour`].filter(Boolean).join(' · ')}
              left={<Avatar name={t.fullName} color={t.color} />}
              below={(() => {
                const vetting = compliance.data?.find((c) => c.tutorId === t.id)?.vettingStatus;
                return (
                  <Row gap={Spacing.one} wrap>
                    <Badge label={logins.has(t.email.toLowerCase()) ? 'Can log in' : 'No login yet'} tone={logins.has(t.email.toLowerCase()) ? 'success' : 'neutral'} />
                    {vetting ? <VettingBadge status={vetting} /> : null}
                  </Row>
                );
              })()}
              onPress={() => router.push({ pathname: '/manage/tutor-edit', params: { id: t.id } })}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
