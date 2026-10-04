import { Platform, Share } from 'react-native';

import { toCSV } from '@/domain/finance';

/** Save a CSV for the accountant: a download on web, the share sheet on phones. */
export async function exportCSV(filename: string, rows: (string | number | undefined | null)[][]) {
  const csv = toCSV(rows);
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  await Share.share({ title: filename, message: csv });
}
