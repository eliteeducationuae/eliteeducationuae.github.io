import { useLocalSearchParams } from 'expo-router';

import { CaseDetail } from '@/components/admissions/case-detail';
import { parseCaseTab } from '@/components/admissions/format';

/** An admissions case. Deep links: /admissions/<id>?tab=overview|targets|dates|tasks|documents|updates|timeline */
export default function AdmissionsCaseScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  // A new ?tab= (e.g. from a notification while the page is open) starts the page on that tab.
  return <CaseDetail key={`${id}:${tab ?? ''}`} id={id} initialTab={parseCaseTab(tab)} />;
}
