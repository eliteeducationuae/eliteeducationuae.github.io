import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Markdown } from '@/components/markdown';
import { Avatar, Badge, Banner, Button, Card, EmptyState, ErrorNote, ListItem, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useHandbookAcks, useHandbookVersions, useTutors } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatLongDate } from '@/domain/vetting';

/** The tutor handbook: tutors read and acknowledge it; admins publish versions and follow acknowledgements. */
export default function Handbook() {
  const me = useMe();
  const versions = useHandbookVersions();
  const acks = useHandbookAcks(me.role === 'tutor' ? me.tutorId : undefined);
  const tutors = useTutors();
  const acknowledge = useAction(source.acknowledgeHandbook);
  const [viewing, setViewing] = useState<number | null>(null);

  if (versions.isLoading || acks.isLoading) return <Loading />;
  const list = versions.data ?? [];
  const latest = list[0];
  if (!latest) {
    return (
      <Screen>
        <EmptyState
          icon="book"
          title="No handbook yet"
          message="The tutor handbook will appear here once it has been published."
          action={me.role === 'admin' ? <Button title="Write the handbook" variant="gold" onPress={() => router.push('/handbook-edit')} /> : undefined}
        />
      </Screen>
    );
  }
  const shown = list.find((v) => v.version === viewing) ?? latest;
  const isTutor = me.role === 'tutor';
  const myAck = isTutor ? (acks.data ?? []).filter((a) => a.tutorId === me.tutorId && a.version === latest.version)[0] : undefined;
  const needsAck = isTutor && !myAck;

  return (
    <Screen
      footer={
        needsAck ? (
          <Button
            title="I have read and agree to the handbook"
            variant="gold"
            style={{ flex: 1 }}
            loading={acknowledge.isPending}
            onPress={() => acknowledge.mutate([latest.version])}
          />
        ) : undefined
      }>
      {myAck ? (
        <Banner tone="success" icon="check">
          Acknowledged on {formatLongDate(myAck.acknowledgedAt)} (version {myAck.version}).
        </Banner>
      ) : null}
      {needsAck ? (
        <Banner tone="info" icon="book">
          {latest.version > 1
            ? `The handbook has been updated to version ${latest.version}. Please read it and confirm that you agree to it.`
            : 'Please read the handbook and confirm that you agree to it.'}
        </Banner>
      ) : null}
      <ErrorNote error={acknowledge.error} />
      {me.role === 'admin' ? <Button title="Edit handbook" icon="doc" variant="outline" onPress={() => router.push('/handbook-edit')} /> : null}

      <Card style={{ gap: Spacing.three }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Txt variant="small">
            Version {shown.version} · published {formatLongDate(shown.publishedAt)}
            {shown.publishedByName ? ` by ${shown.publishedByName}` : ''}
          </Txt>
          {shown.version !== latest.version ? <Badge label="Previous version" tone="neutral" /> : <Badge label="Current" tone="gold" />}
        </Row>
        <Markdown text={shown.body} />
        {shown.version !== latest.version ? <Button title="Back to the current version" variant="secondary" size="sm" onPress={() => setViewing(null)} /> : null}
      </Card>

      {me.role === 'admin' ? (
        <Section title="Acknowledgements">
          <View style={{ gap: Spacing.two }}>
            {(tutors.data ?? []).map((t) => {
              const theirs = (acks.data ?? []).filter((a) => a.tutorId === t.id).sort((a, b) => b.version - a.version)[0];
              const current = theirs && theirs.version >= latest.version;
              return (
                <ListItem
                  key={t.id}
                  title={t.fullName}
                  subtitle={theirs ? `Version ${theirs.version} acknowledged ${formatLongDate(theirs.acknowledgedAt)}` : 'Not yet acknowledged'}
                  left={<Avatar name={t.fullName} color={t.color} size={36} />}
                  below={<Badge label={current ? 'Up to date' : 'Awaiting acknowledgement'} tone={current ? 'success' : 'warning'} />}
                />
              );
            })}
          </View>
        </Section>
      ) : null}

      {list.length > 1 ? (
        <Section title="Previous versions">
          <View style={{ gap: Spacing.two }}>
            {list.slice(1).map((v) => (
              <ListItem
                key={v.id}
                title={`Version ${v.version}`}
                subtitle={`Published ${formatLongDate(v.publishedAt)}${v.publishedByName ? ` by ${v.publishedByName}` : ''}`}
                onPress={() => setViewing(v.version)}
              />
            ))}
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}
