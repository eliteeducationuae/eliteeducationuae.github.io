import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AttachmentList, CLASSWORK_FILE_TYPES, discardUpload } from '@/components/attachments';
import { pickFile } from '@/components/file-pick';
import { CAN_USE_CAMERA, pickPhoto } from '@/components/photo-pick';
import { Button, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useResources } from '@/data/hooks';
import { useMe } from '@/data/session';
import type { PickedFile } from '@/data/source';
import { classworkFolder, fileAttachment, normaliseLink, parseTags, resourceFacets } from '@/domain/homework';
import type { Resource } from '@/domain/types';

/** Add a resource to the library, or edit one (?id=). */
export default function ResourceEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const me = useMe();
  const resources = useResources();
  if (me.role !== 'admin' && me.role !== 'tutor') {
    return (
      <Screen>
        <EmptyState icon="folder" title="For tutors only" message="The resource library is kept by your tutors." />
      </Screen>
    );
  }
  if (resources.isLoading) return <Loading />;
  const all = resources.data ?? [];
  const existing = id ? all.find((r) => r.id === id) : undefined;
  if (id && !existing) {
    return (
      <Screen>
        <EmptyState icon="folder" title="Resource not found" message="It may have been removed from the library." />
      </Screen>
    );
  }
  return <ResourceForm key={existing?.id ?? 'new'} existing={existing} library={all} />;
}

/** Plain-text field with tappable suggestions drawn from the existing library. */
function SuggestedField({ label, value, onChange, suggestions, placeholder }: { label: string; value: string; onChange: (v: string) => void; suggestions: string[]; placeholder: string }) {
  return (
    <View style={{ gap: Spacing.one }}>
      <Field label={label} value={value} onChangeText={onChange} placeholder={placeholder} />
      {suggestions.length ? (
        <Row gap={Spacing.one} wrap>
          {suggestions.map((s) => (
            <Chip key={s} label={s} selected={value.trim().toLowerCase() === s.toLowerCase()} onPress={() => onChange(s)} />
          ))}
        </Row>
      ) : null}
    </View>
  );
}

function ResourceForm({ existing, library }: { existing?: Resource; library: Resource[] }) {
  const save = useAction(source.saveResource);
  const facets = useMemo(() => resourceFacets(library), [library]);
  const curricula = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of library) {
      const c = r.curriculum?.trim();
      if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [library]);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [subject, setSubject] = useState(existing?.subject ?? '');
  const [level, setLevel] = useState(existing?.level ?? '');
  const [curriculum, setCurriculum] = useState(existing?.curriculum ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [kind, setKind] = useState<'file' | 'link'>(existing?.kind ?? 'file');
  const [file, setFile] = useState<{ path: string; fileName: string; mimeType?: string } | null>(
    existing?.kind === 'file' && existing.path ? { path: existing.path, fileName: existing.fileName ?? existing.title, mimeType: existing.mimeType } : null,
  );
  const [link, setLink] = useState(existing?.kind === 'link' ? (existing.url ?? '') : '');
  const [uploading, setUploading] = useState<'file' | 'photo' | 'camera' | null>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);
  // A file uploaded on this screen; the saved resource's own file is never deleted from here,
  // because homework may share it.
  const [freshPath, setFreshPath] = useState<string | null>(null);

  const url = kind === 'link' ? normaliseLink(link) : null;
  const linkInvalid = kind === 'link' && !!link.trim() && !url;
  const valid = !!title.trim() && (kind === 'file' ? !!file : !!url) && !uploading;

  async function upload(which: 'file' | 'photo' | 'camera', pick: () => Promise<PickedFile | null>) {
    setUploadError(null);
    setUploading(which);
    try {
      const picked = await pick();
      if (!picked) return;
      const folder = classworkFolder('resources');
      const path = source.uploadFile ? await source.uploadFile('classwork', folder, picked) : `${folder}/${picked.name}`;
      if (freshPath) discardUpload(freshPath);
      setFreshPath(path);
      setFile({ path, fileName: picked.name, mimeType: picked.mimeType });
      if (!title.trim()) setTitle(picked.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    } catch (err) {
      setUploadError(err);
    } finally {
      setUploading(null);
    }
  }

  async function submit() {
    await save.mutateAsync([
      {
        id: existing?.id,
        title: title.trim(),
        description: description.trim() || undefined,
        subject: subject.trim() || undefined,
        level: level.trim() || undefined,
        curriculum: curriculum.trim() || undefined,
        kind,
        ...(kind === 'file' && file ? { path: file.path, fileName: file.fileName, mimeType: file.mimeType } : { url: url ?? undefined }),
        tags: parseTags(tags),
      },
    ]);
    router.back();
  }

  return (
    <Screen
      footer={<Button title={existing ? 'Save changes' : 'Add to the library'} icon="check" variant="gold" style={{ flex: 1 }} disabled={!valid} loading={save.isPending} onPress={submit} />}>
      <Section title="Resource">
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Calculus revision booklet" />
        <Field label="Description (optional)" multiline value={description} onChangeText={setDescription} placeholder="What it covers and how best to use it." />
      </Section>

      <Section title="File or link">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'file', label: 'File' },
            { value: 'link', label: 'Link' },
          ]}
        />
        {kind === 'file' ? (
          <View style={{ gap: Spacing.two }}>
            {file ? (
              <AttachmentList
                items={[fileAttachment(file.path, file.fileName, file.mimeType)]}
                onRemove={() => {
                  if (freshPath && file.path === freshPath) {
                    discardUpload(freshPath);
                    setFreshPath(null);
                  }
                  setFile(null);
                }}
              />
            ) : (
              <Txt variant="muted">Upload a PDF, a Word, PowerPoint or Excel document, or a photo.</Txt>
            )}
            <Row gap={Spacing.one} wrap>
              <Button
                title={file ? 'Replace the file' : 'Choose a file'}
                icon="attach"
                size="sm"
                variant="outline"
                loading={uploading === 'file'}
                disabled={!!uploading}
                onPress={() => upload('file', () => pickFile(CLASSWORK_FILE_TYPES))}
              />
              <Button title="Choose a photo" icon="photo" size="sm" variant="outline" loading={uploading === 'photo'} disabled={!!uploading} onPress={() => upload('photo', () => pickPhoto('library'))} />
              {CAN_USE_CAMERA ? (
                <Button title="Take a photo" icon="camera" size="sm" variant="outline" loading={uploading === 'camera'} disabled={!!uploading} onPress={() => upload('camera', () => pickPhoto('camera'))} />
              ) : null}
            </Row>
            <ErrorNote error={uploadError} />
          </View>
        ) : (
          <View style={{ gap: Spacing.one }}>
            <Field label="Web address" value={link} onChangeText={setLink} placeholder="https://" autoCapitalize="none" autoCorrect={false} keyboardType="url" inputMode="url" />
            {linkInvalid ? (
              <Txt variant="small" color="danger">
                Please enter a full web address, for example https://…
              </Txt>
            ) : null}
          </View>
        )}
      </Section>

      <Section title="Subject and level">
        <SuggestedField label="Subject" value={subject} onChange={setSubject} suggestions={facets.subjects} placeholder="e.g. Mathematics" />
        <SuggestedField label="Level" value={level} onChange={setLevel} suggestions={facets.levels} placeholder="e.g. IGCSE, A Level, IB Diploma" />
        <SuggestedField label="Curriculum" value={curriculum} onChange={setCurriculum} suggestions={curricula} placeholder="e.g. IB, Cambridge, Edexcel" />
        <Field label="Tags" value={tags} onChangeText={setTags} placeholder="e.g. calculus, revision, past papers" hint="Separate tags with commas." autoCapitalize="none" />
      </Section>

      <ErrorNote error={save.error} />
    </Screen>
  );
}
