import { useState } from 'react';

import { NoHeader } from '@/components/admin-people/kit';
import { Actions, Button, ChipField, EmptyState, ErrorNote, Field, FieldsCard, Group, GroupRow, Loading, PageHeader, Screen, Txt, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useAnnouncements, useFamilies, useTutors } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { withoutClosed } from '@/domain/closed-accounts';
import { relativeDay } from '@/domain/dates';
import type { Audience } from '@/domain/types';

const AUDIENCE_LABEL: Record<Audience, string> = { everyone: 'Everyone', parents: 'Parents', tutors: 'Tutors' };

export default function Announcements() {
  const me = useMe();
  const viewing = useViewing();
  const list = useAnnouncements();
  const admin = me.role === 'admin';
  return (
    <Screen topInset onRefresh={() => list.refetch()} refreshing={list.isRefetching}>
      <NoHeader title="Announcements" />
      <PageHeader
        back={{ fallback: '/' }}
        kicker={admin ? 'Families and tutors' : 'From Elite Education'}
        title="Announcements"
        sub={admin ? 'News for everyone, or for parents or tutors only. Each one goes out as a notification and an email.' : undefined}
      />
      {admin && !viewing ? <Compose /> : null}
      {list.isLoading ? (
        <Loading />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState icon="campaign" title="No announcements yet" message="News from Elite Education will appear here." />
      ) : (
        <Group title={admin ? 'Sent' : undefined}>
          {(list.data ?? []).map((a) => (
            <GroupRow
              key={a.id}
              icon="campaign"
              title={a.title}
              note={a.body}
              titleWeight="bold">
              {/* Who wrote it and when; the audience is for the office only. */}
              <Txt variant="small">{`${relativeDay(a.createdAt)} · ${a.authorName}${admin ? ` · to ${AUDIENCE_LABEL[a.audience].toLowerCase()}` : ''}`}</Txt>
            </GroupRow>
          ))}
        </Group>
      )}
    </Screen>
  );
}

function Compose() {
  const post = useAction(source.postAnnouncement);
  const toast = useToast();
  const families = useFamilies();
  const tutors = useTutors();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('everyone');
  const [tried, setTried] = useState(false);
  const familyCount = withoutClosed(families.data).filter((f) => f.status !== 'archived' && f.status !== 'prospect').length;
  const tutorCount = withoutClosed(tutors.data).length;
  const reach = {
    everyone: `For the ${familyCount} active families and ${tutorCount} tutors.`,
    parents: `For the ${familyCount} active families.`,
    tutors: `For the ${tutorCount} tutors.`,
  }[audience];
  return (
    <>
      <FieldsCard title="New announcement">
        <ChipField label="To" options={(['everyone', 'parents', 'tutors'] as const).map((v) => ({ value: v, label: AUDIENCE_LABEL[v] }))} value={audience} onChange={setAudience} hint={reach} />
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="For example, Winter break dates" error={tried && !title.trim()} />
        <Field label="Message" value={body} onChangeText={setBody} multiline error={tried && !body.trim()} />
        <ErrorNote error={post.error} />
      </FieldsCard>
      <Actions>
        <Button
          title="Send announcement"
          icon="send"
          loading={post.isPending}
          onPress={async () => {
            setTried(true);
            if (!title.trim() || !body.trim()) return;
            await post.mutateAsync([{ title, body, audience }]);
            setTitle('');
            setBody('');
            setTried(false);
            toast('Sent. Everyone in the audience will receive a notification and an email.');
          }}
        />
      </Actions>
    </>
  );
}
