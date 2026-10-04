import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { source } from '@/data';
import type { PickedFile } from '@/data/source';
import { attachmentKindLabel, fileAttachment, isImageAttachment, linkAttachment, normaliseLink, resourceAttachment } from '@/domain/homework';
import type { Attachment } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

import { pickFile } from './file-pick';
import { Icon, type IconName } from './icon';
import { CAN_USE_CAMERA, pickPhoto } from './photo-pick';
import { openAttachment, ResourcePicker } from './resources';
import { Button, ErrorNote, Field, Row, Txt } from './ui';

export { openAttachment } from './resources';

/** Documents a tutor or student may attach: PDF, images, Word, PowerPoint and Excel. */
export const CLASSWORK_FILE_TYPES = [
  'application/pdf',
  'image/*',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

function attachmentIcon(a: Attachment): IconName {
  if (a.kind === 'link') return 'link';
  return isImageAttachment(a) ? 'photo' : 'doc';
}

/** Compact rows of files and links. Tapping one opens it. */
export function AttachmentList({ items, onRemove }: { items: Attachment[]; onRemove?: (index: number) => void }) {
  const theme = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: Spacing.one }}>
      {items.map((a, i) => (
        <Row
          key={`${a.kind}-${a.path ?? a.url ?? a.name}-${i}`}
          gap={Spacing.two}
          style={{
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surfaceAlt,
            borderRadius: Radius.sm,
            paddingLeft: Spacing.two + 2,
            paddingRight: onRemove ? Spacing.one : Spacing.two + 2,
            minHeight: 46,
          }}>
          <Pressable
            onPress={() => openAttachment(a)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${a.name}`}
            style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two }, pressed && { opacity: 0.7 }]}>
            <Icon name={attachmentIcon(a)} size={18} color={theme.accent} />
            <View style={{ flex: 1 }}>
              <Txt numberOfLines={1}>{a.name}</Txt>
              <Txt variant="small">{attachmentKindLabel(a)}</Txt>
            </View>
          </Pressable>
          {onRemove ? (
            <Pressable
              onPress={() => onRemove(i)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${a.name}`}
              hitSlop={8}
              style={({ pressed }) => [{ padding: Spacing.two }, pressed && { opacity: 0.6 }]}>
              <Icon name="close" size={18} color={theme.textMuted} />
            </Pressable>
          ) : null}
        </Row>
      ))}
    </View>
  );
}

type Busy = 'file' | 'library-photo' | 'camera' | null;

/**
 * Add files, photos, links and (optionally) library resources. Files upload straight away to the
 * private classwork bucket under `folder`, so only stored paths are kept in `value`.
 */
export function AttachmentEditor({
  value,
  onChange,
  folder,
  allowLibrary,
}: {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  folder: string;
  allowLibrary?: boolean;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<unknown>(null);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  async function add(kind: Exclude<Busy, null>, pick: () => Promise<PickedFile | null>) {
    setError(null);
    setBusy(kind);
    try {
      const file = await pick();
      if (!file) return;
      const path = source.uploadFile ? await source.uploadFile('classwork', folder, file) : `${folder}/${file.name}`;
      onChange([...value, fileAttachment(path, file.name, file.mimeType)]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  function addLink() {
    const url = normaliseLink(link);
    if (!url) {
      setLinkError(true);
      return;
    }
    onChange([...value, linkAttachment(url)]);
    setLink('');
    setLinkError(false);
    setLinking(false);
  }

  const working = busy !== null;
  return (
    <View style={{ gap: Spacing.two }}>
      <AttachmentList items={value} onRemove={(i) => onChange(value.filter((_, j) => j !== i))} />
      <Row gap={Spacing.one} wrap>
        <Button title="Add a file" icon="attach" size="sm" variant="outline" loading={busy === 'file'} disabled={working} onPress={() => add('file', () => pickFile(CLASSWORK_FILE_TYPES))} />
        <Button title="Add a photo" icon="photo" size="sm" variant="outline" loading={busy === 'library-photo'} disabled={working} onPress={() => add('library-photo', () => pickPhoto('library'))} />
        {CAN_USE_CAMERA ? (
          <Button title="Take a photo" icon="camera" size="sm" variant="outline" loading={busy === 'camera'} disabled={working} onPress={() => add('camera', () => pickPhoto('camera'))} />
        ) : null}
        <Button title="Add a link" icon="link" size="sm" variant="outline" disabled={working} onPress={() => setLinking((v) => !v)} />
        {allowLibrary ? <Button title="From the library" icon="folder" size="sm" variant="outline" disabled={working} onPress={() => setLibraryOpen(true)} /> : null}
      </Row>
      {linking ? (
        <View style={{ gap: Spacing.one }}>
          <Field
            label="Web address"
            value={link}
            onChangeText={(t) => {
              setLink(t);
              setLinkError(false);
            }}
            onSubmitEditing={addLink}
            placeholder="https://"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
          />
          {linkError ? (
            <Txt variant="small" color="danger">
              Please enter a full web address, for example https://…
            </Txt>
          ) : null}
          <Row gap={Spacing.one}>
            <Button title="Add link" size="sm" variant="gold" disabled={!link.trim()} onPress={addLink} />
            <Button
              title="Cancel"
              size="sm"
              variant="ghost"
              onPress={() => {
                setLinking(false);
                setLink('');
                setLinkError(false);
              }}
            />
          </Row>
        </View>
      ) : null}
      <ErrorNote error={error} />
      {allowLibrary ? (
        <ResourcePicker visible={libraryOpen} onClose={() => setLibraryOpen(false)} onPick={(r) => onChange([...value, resourceAttachment(r)])} />
      ) : null}
    </View>
  );
}
