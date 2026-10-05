import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { DEMO_MODE } from '@/config';
import { font, Radius, Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction } from '@/data/hooks';
import {
  DOC_CATEGORY_LABELS,
  type AdmissionsDocCategory,
  type AdmissionsDocument,
} from '@/domain/admissions';
import { formatDate } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/confirm';

import { pickFile } from '../file-pick';
import { Icon } from '../icon';
import { Badge, Button, Card, Chip, ErrorNote, Row, Section, Txt } from '../ui';
import { ADMISSIONS_FILE_TYPES } from './format';

const CATEGORIES = Object.keys(DOC_CATEGORY_LABELS) as AdmissionsDocCategory[];

/** Open a case document from private storage; explains politely when it cannot be opened. */
export async function openAdmissionsDocument(doc: Pick<AdmissionsDocument, 'path' | 'name'>) {
  try {
    const url = await source.fileUrl?.('admissions', doc.path);
    if (url) {
      if (Platform.OS === 'web') await Linking.openURL(url);
      else await WebBrowser.openBrowserAsync(url);
    } else if (DEMO_MODE) {
      notify('This sample document cannot be opened in the demonstration.', 'In the live app, documents open securely from private storage.');
    } else {
      notify('This document is not available', 'It may have been removed. Please ask your adviser to share it again.');
    }
  } catch (err) {
    notify('This document could not be opened', err instanceof Error ? err.message : String(err));
  }
}

/** Documents grouped by category. Managers see which are kept from the family. */
export function DocumentList({
  documents,
  canDelete,
  showVisibility,
}: {
  documents: AdmissionsDocument[];
  canDelete: (doc: AdmissionsDocument) => boolean;
  showVisibility: boolean;
}) {
  const theme = useTheme();
  const remove = useAction(source.deleteAdmissionsDocument);
  const groups = CATEGORIES.map((c) => ({ category: c, docs: documents.filter((d) => d.category === c) })).filter((g) => g.docs.length);
  return (
    <View style={{ gap: Spacing.four }}>
      {groups.map((g) => (
        <Section key={g.category} title={DOC_CATEGORY_LABELS[g.category]}>
          {g.docs.map((d) => (
            <View key={d.id} style={[styles.doc, { borderColor: theme.border, backgroundColor: theme.surface }]}>
              <Pressable
                onPress={() => openAdmissionsDocument(d)}
                accessibilityRole="link"
                accessibilityLabel={`Open ${d.name}`}
                style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three }, pressed && { opacity: 0.75 }]}>
                <View style={[styles.docIcon, { backgroundColor: theme.champagne, borderColor: theme.gold }]}>
                  <Icon name="doc" size={18} color={theme.accent} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt numberOfLines={2} style={font('sans', 'bold')}>
                    {d.name}
                  </Txt>
                  <Txt variant="small">
                    {[d.uploadedByName ? `Added by ${d.uploadedByName}` : 'Added', formatDate(d.createdAt)].join(' · ')}
                  </Txt>
                  {showVisibility && !d.familyVisible ? (
                    <View style={{ flexDirection: 'row', marginTop: 2 }}>
                      <Badge label="Not shared with the family" tone="warning" />
                    </View>
                  ) : null}
                </View>
              </Pressable>
              {canDelete(d) ? (
                <Pressable
                  onPress={() =>
                    confirm('Delete this document?', `“${d.name}” will be removed from the case.`, () => remove.mutate([d.id]), 'Delete')
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${d.name}`}
                  hitSlop={8}
                  style={({ pressed }) => [{ padding: Spacing.two }, pressed && { opacity: 0.6 }]}>
                  <Icon name="close" size={18} color={theme.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </Section>
      ))}
      <ErrorNote error={remove.error} />
    </View>
  );
}

/**
 * Choose a category, then a file. The file is stored first and then recorded on the case;
 * if recording fails the stored file is removed again so nothing stray is left behind.
 */
export function DocumentUploader({ caseId, isManager }: { caseId: string; isManager: boolean }) {
  const theme = useTheme();
  const add = useAction(source.addAdmissionsDocument);
  const [category, setCategory] = useState<AdmissionsDocCategory>('transcript');
  const [familyVisible, setFamilyVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  function choose(c: AdmissionsDocCategory) {
    setCategory(c);
    // References are confidential by default: they are shared with the family only when the adviser chooses to.
    if (isManager) setFamilyVisible(c !== 'reference');
  }

  async function upload() {
    setError(null);
    setDone(null);
    if (!source.uploadFile) {
      setError(new Error('Uploading is not available here.'));
      return;
    }
    const file = await pickFile(ADMISSIONS_FILE_TYPES);
    if (!file) return;
    setBusy(true);
    let path: string | null = null;
    try {
      path = await source.uploadFile('admissions', `cases/${caseId}`, file);
      await add.mutateAsync([
        { caseId, category, name: file.name, path, mimeType: file.mimeType, familyVisible: isManager ? familyVisible : true },
      ]);
      setDone(file.name);
    } catch (err) {
      if (path) source.removeFile?.('admissions', path).catch(() => undefined);
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: Spacing.three }}>
      <View style={{ gap: Spacing.one }}>
        <Txt variant="h3">Upload a document</Txt>
        <Txt variant="muted">Please choose the type of document, then select a PDF, Word document or photograph.</Txt>
      </View>
      <Row gap={Spacing.one} wrap>
        {CATEGORIES.map((c) => (
          <Chip key={c} label={DOC_CATEGORY_LABELS[c]} selected={category === c} onPress={() => choose(c)} />
        ))}
      </Row>
      {isManager ? (
        <View style={[styles.toggle, { borderColor: theme.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt style={font('sans', 'bold')}>Visible to the family</Txt>
            <Txt variant="small">
              {category === 'reference'
                ? familyVisible
                  ? 'The family will be able to open this reference.'
                  : 'References are kept from the family unless you choose to share them.'
                : familyVisible
                  ? 'The family will be able to open this document.'
                  : 'Kept between the adviser and the office.'}
            </Txt>
          </View>
          <Switch
            value={familyVisible}
            onValueChange={setFamilyVisible}
            accessibilityLabel="Visible to the family"
            trackColor={{ true: theme.accent, false: theme.textMuted }}
            thumbColor={familyVisible ? theme.onGold : theme.text}
            // react-native-web paints the "on" thumb teal unless told otherwise.
            {...({ activeThumbColor: theme.onGold } as object)}
          />
        </View>
      ) : null}
      <Button title={busy ? 'Uploading…' : 'Upload a document'} icon="attach" variant="gold" loading={busy} onPress={upload} />
      {done ? <Txt variant="small" color="success">“{done}” has been added.</Txt> : null}
      <ErrorNote error={error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  docIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two + 2,
  },
});
