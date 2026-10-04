import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, Card, EmptyState, ErrorNote, Field, Loading, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useAnnouncements } from '@/data/hooks';
import { useMe } from '@/data/session';
import { relativeDay } from '@/domain/dates';
import type { Audience } from '@/domain/types';

const AUDIENCE_LABEL: Record<Audience, string> = { everyone: 'Everyone', parents: 'Parents', tutors: 'Tutors' };

export default function Announcements() {
  const me = useMe();
  const list = useAnnouncements();
  return (
    <Screen onRefresh={() => list.refetch()} refreshing={list.isRefetching}>
      {me.role === 'admin' ? <Compose /> : null}
      <Section title="Announcements">
        {list.isLoading ? (
          <Loading />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState icon="sparkle" title="No announcements yet" />
        ) : (
          (list.data ?? []).map((a) => (
            <Card key={a.id}>
              <Txt variant="h3">{a.title}</Txt>
              <Txt>{a.body}</Txt>
              <Txt variant="small">
                {relativeDay(a.createdAt)} · {a.authorName}
                {me.role === 'admin' ? ` · to ${AUDIENCE_LABEL[a.audience].toLowerCase()}` : ''}
              </Txt>
            </Card>
          ))
        )}
      </Section>
    </Screen>
  );
}

function Compose() {
  const post = useAction(source.postAnnouncement);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('everyone');
  const [done, setDone] = useState(false);
  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">New announcement</Txt>
      <Segmented
        value={audience}
        onChange={setAudience}
        options={(['everyone', 'parents', 'tutors'] as const).map((v) => ({ value: v, label: AUDIENCE_LABEL[v] }))}
      />
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Winter break dates" />
      <Field label="Message" value={body} onChangeText={setBody} multiline />
      {done ? (
        <Banner tone="success" icon="check">
          Sent. Everyone in the audience gets a notification and an email.
        </Banner>
      ) : null}
      <ErrorNote error={post.error} />
      <View>
        <Button
          title="Send announcement"
          variant="gold"
          disabled={!title.trim() || !body.trim()}
          loading={post.isPending}
          onPress={async () => {
            await post.mutateAsync([{ title, body, audience }]);
            setTitle('');
            setBody('');
            setDone(true);
          }}
        />
      </View>
    </Card>
  );
}
