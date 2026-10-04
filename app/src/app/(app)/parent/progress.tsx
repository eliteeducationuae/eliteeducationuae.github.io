import { useLocalSearchParams } from 'expo-router';

import { ChildPicker } from '@/components/child-picker';
import { PublishedReports } from '@/components/reports';
import { StudentOverview } from '@/components/student-overview';
import { Screen } from '@/components/ui';

export default function ParentProgress() {
  // Notices about homework and shared resources open straight onto the Homework tab (?tab=homework).
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const initialTab = tab === 'homework' || tab === 'notes' ? tab : undefined;
  return (
    <Screen>
      <ChildPicker>
        {(student) => (
          <>
            <StudentOverview key={student.id} student={student} initialTab={initialTab} />
            <PublishedReports student={student} />
          </>
        )}
      </ChildPicker>
    </Screen>
  );
}
