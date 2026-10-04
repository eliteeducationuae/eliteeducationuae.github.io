import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState, type ReactNode } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEMO_MODE } from '@/config';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useResources } from '@/data/hooks';
import { useMe } from '@/data/session';
import { filterResources, resourceAttachment, resourceFacets, resourceMeta } from '@/domain/homework';
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
 * private classwork bucket. The demo keeps file names only, so it explains that instead; in the
 * live app a file that cannot be reached is reported as unavailable.
 */
export async function openAttachment(a: Attachment) {
  try {
    if (a.kind === 'link') {
      if (a.url) await openUrl(a.url);
      return;
    }
    const url = a.path ? await source.fileUrl?.('classwork', a.path) : null;
    if (url) await openUrl(url);
    else if (DEMO_MODE) notify('This file opens in the live app', 'The demo keeps file names only.');
    else notify('This file is not available', 'It may have been removed. Please ask your tutor to share it again.');
  } catch (err) {
    notify('This could not be opened', err instanceof Error ? err.message : String(err));
  }
}

export interface ResourceFilterValue {
  query: string;
  subject?: string;
  curriculum?: string;
}

/** Search box plus subject and curriculum chips drawn from the library itself. */
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
        <View style={{ gap: Spacing.one }} role="group" aria-label="Filter by subject">
          <Txt variant="label">Subject</Txt>
          <Row gap={Spacing.one} wrap>
            {facets.subjects.map((s) => (
              <Chip key={s} label={s} selected={value.subject === s} onPress={() => onChange({ ...value, subject: value.subject === s ? undefined : s })} />
            ))}
          </Row>
        </View>
      ) : null}
      {facets.curricula.length ? (
        <View style={{ gap: Spacing.one }} role="group" aria-label="Filter by curriculum">
          <Txt variant="label">Curriculum</Txt>
          <Row gap={Spacing.one} wrap>
            {facets.curricula.map((c) => (
              <Chip
                key={c}
                label={c}
                selected={value.curriculum === c}
                onPress={() => onChange({ ...value, curriculum: value.curriculum === c ? undefined : c })}
              />
            ))}
          </Row>
        </View>
      ) : null}
    </View>
  );
}

/** The library's own spelling of `subject` (ignoring case), when it holds resources for it. */
function subjectFacet(list: Resource[], subject?: string): string | undefined {
  const wanted = subject?.trim().toLowerCase();
  if (!wanted) return undefined;
  return resourceFacets(list).subjects.find((s) => s.toLowerCase() === wanted);
}

/** The filtered list for a ResourceFilters value. */
export function applyResourceFilter(list: Resource[], value: ResourceFilterValue): Resource[] {
  return filterResources(list, value).sort((a, b) => a.title.localeCompare(b.title));
}

/** Tutors are told only about their own students, as list_resources leaves out the rest. */
function sharingLine(count: number, admin: boolean): string {
  if (admin) return count ? `Shared with ${count} ${count === 1 ? 'student' : 'students'}` : 'Not yet shared with students';
  return count ? `Shared with ${count} of your students` : 'Not yet shared with your students';
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
  const me = useMe();
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
            showSharing ? sharingLine(shared, me.role === 'admin') : '',
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

/**
 * A full-screen sheet for choosing a library resource to attach. With `subject` (the lesson's subject),
 * the list opens filtered to that subject whenever the library holds anything for it.
 */
export function ResourcePicker({
  visible,
  onClose,
  onPick,
  subject,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (r: Resource) => void;
  subject?: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const resources = useResources();
  // null until the person changes the filter; until then it follows the lesson's subject.
  const [chosen, setChosen] = useState<ResourceFilterValue | null>(null);
  const all = resources.data ?? [];
  const filter = chosen ?? { query: '', subject: subjectFacet(all, subject) };
  const setFilter = setChosen;
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
