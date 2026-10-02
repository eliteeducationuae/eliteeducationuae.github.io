import { ChildPicker } from '@/components/child-picker';
import { StudentOverview } from '@/components/student-overview';
import { Screen } from '@/components/ui';

export default function StudentProgress() {
  return (
    <Screen>
      <ChildPicker>{(student) => <StudentOverview student={student} />}</ChildPicker>
    </Screen>
  );
}
