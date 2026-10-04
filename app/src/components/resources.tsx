import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState, type ReactNode } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useResources } from '@/data/hooks';
import { filterResources, resourceAttachment, resourceFacets } from '@/domain/homework';
import type { Attachment, Resource } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';

import { Icon } from './icon';
import { Badge, Button, Card, Chip, EmptyState, Field, Loading, Row, Section, Txt } from './ui';

/** Open a web address: in an in-app browser on phones, in a new tab on the web. */
async function openUrl(url: string) {
  if (Platform.OS === 'web') await Linking.openURL(url);
  else await WebBrowser.openBrowserAsync(url);
}

/**
 * Open an attachment. Links open directly; files are fetched as a short-lived link from the
 * private classwork bucket. The demo keeps file names only, so it explains that instead.
 */
export async function openAttachment(a: Attachment) {
  try {
    if (a.kind === 'link') {
      if (a.url) await openUrl(a.url);
      return;
    }
    const url = a.path ? await source.fileUrl?.('classwork', a.path) : null;
    if (url) await openUrl(url);
    else notify('This file opens in the live app', 'The demo keeps file names only.');
  } catch (err) {
    notify('This could not be opened', err instanceof Error ? err.message : String(err));
  }
}

export interface ResourceFilterValue {
  query: string;
  subject?: string;
  level?: string;
}

/** Search box plus subject and level chips drawn from the library itself. */
export function ResourceFilters({
  resources,
  value,
  onChange,
}: {
  resources: Resource[];
  value: ResourceFilterValue;
  onChange: (v: ResourceFilterValue) => void;
}) {
  const facets = useMemo(() => resourceFacets(resources), [resources]);
  return (
    <View style={{ gap: Spacing.two }}>
      <Field
        label="Search"
        value={value.query}
        onChangeText={(query) => onChange({ ...value, query })}
        placeholder="Title, description or tag"
        autoCapitalize="none"
      />
      {facets.subjects.length ? (
        <Row gap={Spacing.one} wrap>
          {facets.subjects.map((s) => (
            <Chip key={s} label={s} selected={value.subject === s} onPress={() => onChange({ ...value, subject: value.subject === s ? undefined : s })} />
          ))}
        </Row>
      ) : null}
      {facets.levels.length ? (
        <Row gap={Spacing.one} wrap>
          {facets.levels.map((l) => (
            <Chip key={l} label={l} selected={value.level === l} onPress={() => onChange({ ...value, level: value.level === l ? undefined : l })} />
          ))}
        </Row>
      ) : null}
    </View>
  );
}

/** The filtered list for a ResourceFilters value. */
export function applyResourceFilter(list: Resource[], value: ResourceFilterValue): Resource[] {
  return filterResources(list, value).sort((a, b) => a.title.localeCompare(b.title));
}

function resourceMeta(r: Resource): string {
  return [r.subject, r.level, r.curriculum].map((x) => x?.trim()).filter(Boolean).join(' · ');
}

/** One library item: title, subject · level · curriculum, tags, sharing and uploader. */
export function ResourceCard({
  resource,
  actions,
  onPress,
  showSharing = true,
}: {
  resource: Resource;
  actions?: ReactNode;
  onPress?: () => void;
  /** Staff see who it is shared with; students and families do not. */
  showSharing?: boolean;
}) {
  const theme = useTheme();
  const meta = resourceMeta(resource);
  const shared = resource.studentIds.length;
  return (
    <Card onPress={onPress} accessibilityLabel={resource.title}>
      <Row gap={Spacing.three} style={{ alignItems: 'flex-start' }}>
        <Icon name={resource.kind === 'link' ? 'link' : 'doc'} size={22} color={theme.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{resource.title}</Txt>
          {meta ? <Txt variant="muted">{meta}</Txt> : null}
          {resource.description ? <Txt variant="small">{resource.description}</Txt> : null}
        </View>
      </Row>
      {resource.tags.length ? (
        <Row gap={4} wrap>
          {resource.tags.map((t) => (
            <Badge key={t} label={t} tone="neutral" />
          ))}
        </Row>
      ) : null}
      {showSharing || resource.uploadedByName ? (
        <Txt variant="small">
          {[
            showSharing ? (shared ? `Shared with ${shared} ${shared === 1 ? 'student' : 'students'}` : 'Not yet shared with students') : '',
            resource.uploadedByName ? `Added by ${resource.uploadedByName}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Txt>
      ) : null}
      {actions ? (
        <Row gap={Spacing.one} wrap>
          {actions}
        </Row>
      ) : null}
    </Card>
  );
}

/** A full-screen sheet for choosing a library resource to attach. */
export function ResourcePicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (r: Resource) => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const resources = useResources();
  const [filter, setFilter] = useState<ResourceFilterValue>({ query: '' });
  const all = resources.data ?? [];
  const list = applyResourceFilter(all, filter);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Platform.OS === 'android' ? insets.top : 0 }}>
        <View style={{ width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.three, paddingBottom: Spacing.two }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="h2">From the library</Txt>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
              <Icon name="close" size={22} color={theme.text} />
            </Pressable>
          </Row>
        </View>
        <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: insets.bottom + Spacing.five }} keyboardShouldPersistTaps="handled">
          <View style={{ width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.three, gap: Spacing.three }}>
            {resources.isLoading ? (
              <Loading />
            ) : all.length === 0 ? (
              <EmptyState icon="folder" title="The library is empty" message="Resources added to the library will appear here, ready to attach." />
            ) : (
              <>
                <ResourceFilters resources={all} value={filter} onChange={setFilter} />
                {list.length === 0 ? <Txt variant="muted">No resources match your search.</Txt> : null}
                {list.map((r) => (
                  <ResourceCard
                    key={r.id}
                    resource={r}
                    onPress={() => {
                      onPick(r);
                      onClose();
                    }}
                  />
                ))}
              </>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Resources a tutor has shared with this student. Renders nothing when there are none. */
export function SharedResources({ studentId }: { studentId: string | undefined }) {
  const resources = useResources({ studentId });
  const list = (resources.data ?? []).filter((r) => !studentId || r.studentIds.includes(studentId));
  if (!studentId || list.length === 0) return null;
  return (
    <Section title="Shared resources">
      {list.map((r) => (
        <ResourceCard
          key={r.id}
          resource={r}
          showSharing={false}
          actions={<Button title="Open" icon={r.kind === 'link' ? 'link' : 'doc'} size="sm" variant="outline" onPress={() => openAttachment(resourceAttachment(r))} />}
        />
      ))}
    </Section>
  );
}
