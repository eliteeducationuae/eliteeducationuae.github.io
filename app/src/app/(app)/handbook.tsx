import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Markdown } from '@/components/markdown';
import { NoHeader, Tag } from '@/components/admin-people/kit';
import { Actions, Button, EmptyState, ErrorNote, Group, GroupRow, Loading, Notice, PageHeader, Screen, Txt, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useHandbookAcks, useHandbookVersions, useTutors } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { withoutClosed } from '@/domain/closed-accounts';
import { formatLongDate } from '@/domain/vetting';
import { useTheme } from '@/hooks/use-theme';

/** The tutor handbook: tutors read and acknowledge it; admins publish versions and follow acknowledgements. */
export default function Handbook() {
  const me = useMe();
  const versions = useHandbookVersions();
  const acks = useHandbookAcks(me.role === 'tutor' ? me.tutorId : undefined);
  const tutors = useTutors();
  const acknowledge = useAction(source.acknowledgeHandbook);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const viewing = useViewing();
  const theme = useTheme();
  const toast = useToast();

  if (versions.isLoading || acks.isLoading) return <Loading />;
  const list = versions.data ?? [];
  const latest = list[0];
  const header = (sub?: string) => (
    <>
      <NoHeader title="Tutor handbook" />
      <PageHeader back={{ fallback: '/' }} kicker={me.role === 'admin' ? 'Team' : 'For tutors'} title="Tutor handbook" sub={sub} />
    </>
  );
  if (!latest) {
    return (
      <Screen topInset>
        {header()}
        <EmptyState
          icon="book"
          title="No handbook yet"
          message="The tutor handbook will appear here once it has been published."
          action={me.role === 'admin' && !viewing ? <Button title="Write the handbook" onPress={() => router.push('/handbook-edit')} /> : undefined}
        />
      </Screen>
    );
  }
  const shown = list.find((v) => v.version === viewingVersion) ?? latest;
  // Anyone who teaches acknowledges, including an administrator who also tutors (admins load everyone's acks).
  const isTutor = !!me.tutorId && (me.role === 'tutor' || me.role === 'admin');
  const myAck = isTutor ? (acks.data ?? []).find((a) => a.tutorId === me.tutorId && a.version === latest.version) : undefined;
  const needsAck = isTutor && !myAck;
  const team = withoutClosed(tutors.data);
  const outstanding = team.filter((t) => !((acks.data ?? []).filter((a) => a.tutorId === t.id).some((a) => a.version >= latest.version)));

  return (
    <Screen topInset>
      {header(
        `The policies every tutor agrees to when they join. Version ${latest.version}, published ${formatLongDate(latest.publishedAt)}.`,
      )}
      {myAck ? (
        <Notice tone="good" title="Acknowledged">
          Acknowledged on {formatLongDate(myAck.acknowledgedAt)} (version {myAck.version}).
        </Notice>
      ) : null}
      {needsAck ? (
        <Notice tone="info" icon="book">
          {latest.version > 1
            ? `The handbook has been updated to version ${latest.version}. Please read it and confirm that you agree to it.`
            : 'Please read the handbook and confirm that you agree to it.'}
        </Notice>
      ) : null}
      {me.role === 'admin' ? (
        <Notice tone={outstanding.length ? 'warn' : 'good'} title={outstanding.length ? `${outstanding.length} of ${team.length} outstanding` : 'Everyone is up to date'}>
          {outstanding.length
            ? `${outstanding.map((t) => t.fullName).join(', ')} ${outstanding.length === 1 ? 'has' : 'have'} not acknowledged version ${latest.version} yet.`
            : `Every tutor has acknowledged version ${latest.version}.`}
        </Notice>
      ) : null}
      <ErrorNote error={acknowledge.error} />

      <View style={[styles.doc, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Txt variant="small" style={{ flexShrink: 1 }}>
            {shown.title} · Version {shown.version} · published {formatLongDate(shown.publishedAt)}
            {shown.publishedByName ? ` by ${shown.publishedByName}` : ''}
          </Txt>
          <Tag label={shown.version !== latest.version ? 'Previous version' : 'Current'} tone={shown.version !== latest.version ? 'muted' : 'accent'} />
        </View>
        <Markdown text={shown.body} />
        {shown.version !== latest.version ? (
          <View style={{ flexDirection: 'row' }}>
            <Button title="Back to the current version" variant="secondary" size="sm" onPress={() => setViewingVersion(null)} />
          </View>
        ) : null}
      </View>

      {(needsAck || me.role === 'admin') && !viewing ? (
        <Actions>
          {needsAck ? (
            <Button
              title="I have read and agree to the handbook"
              icon="check"
              loading={acknowledge.isPending}
              onPress={async () => {
                await acknowledge.mutateAsync([latest.version]);
                toast('Thank you. Handbook acknowledged.');
              }}
            />
          ) : null}
          {me.role === 'admin' && !viewing ? <Button title="Edit handbook" icon="edit" variant="secondary" onPress={() => router.push('/handbook-edit')} /> : null}
        </Actions>
      ) : null}

      {me.role === 'admin' ? (
        <Group title="Acknowledgements">
          {team.map((t) => {
            const theirs = (acks.data ?? []).filter((a) => a.tutorId === t.id).sort((a, b) => b.version - a.version)[0];
            const current = theirs && theirs.version >= latest.version;
            return (
              <GroupRow
                key={t.id}
                avatar={t.fullName}
                avatarColor={t.color}
                title={t.fullName}
                note={theirs ? `Version ${theirs.version} acknowledged ${formatLongDate(theirs.acknowledgedAt)}` : 'Not yet acknowledged'}
                right={<Tag label={current ? 'Up to date' : 'Awaiting acknowledgement'} tone={current ? 'good' : 'warn'} />}
              />
            );
          })}
        </Group>
      ) : null}

      {list.length > 1 ? (
        <Group title="Previous versions">
          {list.slice(1).map((v) => (
            <GroupRow
              key={v.id}
              icon="history"
              title={`Version ${v.version}`}
              note={`Published ${formatLongDate(v.publishedAt)}${v.publishedByName ? ` by ${v.publishedByName}` : ''}`}
              onPress={() => setViewingVersion(v.version)}
            />
          ))}
        </Group>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  doc: { borderWidth: 1, borderRadius: 18, padding: 20, gap: 16 },
});
