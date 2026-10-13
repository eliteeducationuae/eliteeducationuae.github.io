import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { firstName } from '@/components/parent/format';
import { ChildProgress, PROGRESS_TABS, type ProgressTab } from '@/components/parent/progress-view';
import { Actions, Button, Chip, Loading, Notice, PageHeader, Screen } from '@/components/ui';
import { useEnrolments, useLookup, useStudents } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { withoutClosed } from '@/domain/closed-accounts';
import { activeEnrolments } from '@/domain/enrolments';

const isTab = (t?: string): t is ProgressTab => PROGRESS_TABS.some((x) => x.value === t);

export default function ParentProgress() {
  // Notices about homework, notes and reports open straight onto their tab (?tab=homework), and Account opens a
  // child (?child=<student id>).
  const params = useLocalSearchParams<{ tab?: string; child?: string }>();
  const students = useStudents();
  const enrolments = useEnrolments();
  const lookup = useLookup();
  const viewing = useViewing();
  const [childId, setChildId] = useState<string | null>(params.child ?? null);
  const [tab, setTab] = useState<ProgressTab>(isTab(params.tab) ? params.tab : 'overview');

  // The tab screen stays mounted, so a later link (?tab=notes) moves it to that tab and child.
  const [seen, setSeen] = useState({ tab: params.tab, child: params.child });
  if (seen.tab !== params.tab || seen.child !== params.child) {
    setSeen({ tab: params.tab, child: params.child });
    if (isTab(params.tab)) setTab(params.tab);
    if (params.child) setChildId(params.child);
  }

  if (students.isLoading) return <Loading />;
  const kids = withoutClosed(students.data);
  if (!kids.length) {
    return (
      <Screen topInset>
        <PageHeader kicker="Progress" title="Your children" />
        <Notice tone="info" icon="favorite" title="No children added yet">
          Add your child and tell us what they would like support with. Lesson notes, homework and reports will appear here once lessons begin.
        </Notice>
        {viewing ? null : (
          <Actions>
            <Button title="Add my child" icon="person_add" onPress={() => router.push('/onboarding')} />
          </Actions>
        )}
      </Screen>
    );
  }
  const child = kids.find((k) => k.id === childId) ?? kids[0];
  const subjects = activeEnrolments(enrolments.data ?? [], child.id);
  const subjectLine = subjects
    .map((e) => {
      const tutor = e.tutorId ? lookup.tutor(e.tutorId)?.fullName : undefined;
      return [e.subject, e.curriculum && e.curriculum !== e.subject ? e.curriculum : ''].filter(Boolean).join(' ') + (tutor ? ` with ${tutor}` : '');
    })
    .join(', ');
  const sub = [child.yearGroup, child.school, subjectLine].filter(Boolean).join(' · ');

  return (
    <Screen topInset>
      <PageHeader kicker="Progress" title={firstName(child.fullName)} sub={sub || undefined}>
        {kids.length > 1 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }} accessibilityLabel="Choose a child">
            {kids.map((k) => (
              <Chip key={k.id} label={firstName(k.fullName)} selected={k.id === child.id} onPress={() => setChildId(k.id)} />
            ))}
          </View>
        ) : null}
      </PageHeader>
      <ChildProgress key={child.id} student={child} tab={tab} onTab={setTab} />
    </Screen>
  );
}
