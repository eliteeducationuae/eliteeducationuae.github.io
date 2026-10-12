import { router } from 'expo-router';
import { useState } from 'react';

import { Markdown } from '@/components/markdown';
import { NoHeader } from '@/components/admin-people/kit';
import { Actions, Button, EmptyState, ErrorNote, Field, FieldsCard, Loading, PageHeader, Screen, Segmented, Txt, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useHandbookVersions } from '@/data/hooks';
import { useMe } from '@/data/session';
import { DEFAULT_HANDBOOK_BODY, DEFAULT_HANDBOOK_TITLE } from '@/domain/handbook';
import type { HandbookVersion } from '@/domain/types';
import { confirm } from '@/lib/confirm';

/** Admin: edit the handbook and publish it as a new version. */
export default function HandbookEdit() {
  const me = useMe();
  const versions = useHandbookVersions();
  if (me.role !== 'admin') {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/handbook' }} kicker="Team" title="Edit handbook" />
        <EmptyState icon="book" title="Administrators only" message="Only the Elite Education office can edit the handbook." />
      </Screen>
    );
  }
  if (versions.isLoading) return <Loading />;
  const latest = versions.data?.[0];
  return <Editor key={latest?.id ?? 'new'} latest={latest} />;
}

function Editor({ latest }: { latest?: HandbookVersion }) {
  const publish = useAction(source.publishHandbook);
  const toast = useToast();
  const [title, setTitle] = useState(latest?.title ?? DEFAULT_HANDBOOK_TITLE);
  const [body, setBody] = useState(latest?.body ?? DEFAULT_HANDBOOK_BODY);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const next = (latest?.version ?? 0) + 1;
  const unchanged = !!latest && title.trim() === latest.title && body.trim() === latest.body.trim();
  const ready = title.trim().length > 0 && body.trim().length > 0 && !unchanged;

  const back = () => (router.canGoBack() ? router.back() : router.replace('/handbook'));
  const publishNow = () =>
    confirm(
      'Publish a new version?',
      'Every tutor will be asked to read and acknowledge it again.',
      async () => {
        const ok = await publish.mutateAsync([title.trim(), body.trim()]).then(
          () => true,
          () => false, // shown from publish.error
        );
        if (ok) {
          back();
          toast(`Version ${next} published. Every tutor is asked to acknowledge it.`);
        }
      },
      'Publish',
    );

  return (
    <Screen topInset>
      <NoHeader title="Edit handbook" />
      <PageHeader
        back={{ label: 'Cancel', onPress: back }}
        kicker="Team · Handbook"
        title="Edit handbook"
        sub={latest ? `Version ${latest.version} is current. Publishing makes version ${next}.` : 'Publishing makes version 1.'}
      />
      <Segmented
        options={[
          { value: 'edit', label: 'Edit' },
          { value: 'preview', label: 'Preview' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'edit' ? (
        <FieldsCard>
          <Field label="Title" value={title} onChangeText={setTitle} />
          <Field
            label="Body"
            value={body}
            onChangeText={setBody}
            multiline
            style={{ minHeight: 420 }}
            hint="Use # for headings, - for bullet points, 1. for numbered steps and **double asterisks** for bold."
          />
        </FieldsCard>
      ) : (
        <FieldsCard title={`Preview of version ${next}`}>
          <Markdown text={body} />
        </FieldsCard>
      )}
      {unchanged ? <Txt variant="note">Make a change to publish a new version.</Txt> : null}
      <ErrorNote error={publish.error} />
      <Actions>
        <Button title={`Publish version ${next}`} icon="send" disabled={!ready} loading={publish.isPending} onPress={publishNow} />
        <Button title="Cancel" variant="secondary" onPress={back} />
      </Actions>
    </Screen>
  );
}
