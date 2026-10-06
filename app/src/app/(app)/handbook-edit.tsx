import { router } from 'expo-router';
import { useState } from 'react';

import { Markdown } from '@/components/markdown';
import { Button, Card, EmptyState, ErrorNote, Field, Loading, Screen, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
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
      <Screen>
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
  const [title, setTitle] = useState(latest?.title ?? DEFAULT_HANDBOOK_TITLE);
  const [body, setBody] = useState(latest?.body ?? DEFAULT_HANDBOOK_BODY);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const next = (latest?.version ?? 0) + 1;
  const unchanged = !!latest && title.trim() === latest.title && body.trim() === latest.body.trim();
  const ready = title.trim().length > 0 && body.trim().length > 0 && !unchanged;

  return (
    <Screen
      footer={
        <Button
          title={`Publish version ${next}`}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!ready}
          loading={publish.isPending}
          onPress={() =>
            confirm(
              'Publish a new version?',
              'Every tutor will be asked to read and acknowledge it again.',
              async () => {
                const ok = await publish.mutateAsync([title.trim(), body.trim()]).then(
                  () => true,
                  () => false, // shown from publish.error
                );
                if (ok) router.back();
              },
              'Publish',
            )
          }
        />
      }>
      <Segmented
        options={[
          { value: 'edit', label: 'Edit' },
          { value: 'preview', label: 'Preview' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'edit' ? (
        <>
          <Field label="Title" value={title} onChangeText={setTitle} />
          <Field
            label="Body"
            value={body}
            onChangeText={setBody}
            multiline
            style={{ minHeight: 420 }}
            hint="Use # for headings, - for bullet points, 1. for numbered steps and **double asterisks** for bold."
          />
        </>
      ) : (
        <Card style={{ gap: Spacing.three }}>
          <Txt variant="small">Preview of version {next}</Txt>
          <Markdown text={body} />
        </Card>
      )}
      {unchanged ? <Txt variant="small">Make a change to publish a new version.</Txt> : null}
      <ErrorNote error={publish.error} />
    </Screen>
  );
}
