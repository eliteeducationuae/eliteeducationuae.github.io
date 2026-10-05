import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { exportFileName } from '@/domain/data-rights';
import type { DataExport } from '@/domain/types';

import { dataExportHTML } from './data-export-pdf';
import { printHtmlOnWeb } from './print-web';

/**
 * Saving the signed-in person's data: the full JSON file (a download on the web, the share sheet on phones),
 * and a branded PDF summary printed like invoices are.
 */

/** Save the export as elite-education-data-YYYY-MM-DD.json. Returns the file name. */
export async function saveDataExport(data: DataExport, now: Date = new Date()): Promise<string> {
  const name = exportFileName(now);
  const json = JSON.stringify(data, null, 2);
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  }
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Your Elite Education data' });
  }
  return name;
}

/** Print or share the PDF summary of the export. */
export async function shareDataSummaryPdf(data: DataExport): Promise<void> {
  const html = dataExportHTML(data);
  if (Platform.OS === 'web') {
    await printHtmlOnWeb(html);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
