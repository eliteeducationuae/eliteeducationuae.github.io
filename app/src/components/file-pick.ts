import * as DocumentPicker from 'expo-document-picker';

import type { PickedFile } from '@/data/source';

/** Let the person choose one file (e.g. a CV or receipt). Returns null if they cancel. */
export async function pickFile(types: string[] = ['application/pdf', 'image/*', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0];
  return { name: a.name, uri: a.uri, mimeType: a.mimeType ?? undefined, file: a.file ?? undefined };
}
