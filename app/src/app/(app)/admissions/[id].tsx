import { useLocalSearchParams } from 'expo-router';

import { CaseDetail } from '@/components/admissions/case-detail';
import { parseCaseTab } from '@/components/admissions/format';
import { ParentCase } from '@/components/parent/admissions-case';
import { useMe } from '@/data/session';

/** An admissions case. Deep links: /admissions/<id>?tab=overview|targets|dates|tasks|documents|updates|timeline */
export default function AdmissionsCaseScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const me = useMe();
  // Families get their own redesigned case page (components/parent/admissions-case).
  if (me.role === 'parent') return <ParentCase key={`${id}:${tab ?? ''}`} id={id} initialTab={tab} />;
  // A new ?tab= (e.g. from a notification while the page is open) starts the page on that tab.
  return <CaseDetail key={`${id}:${tab ?? ''}`} id={id} initialTab={parseCaseTab(tab)} />;
}
