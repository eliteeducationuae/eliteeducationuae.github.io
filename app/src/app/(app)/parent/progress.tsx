import { ChildPicker } from '@/components/child-picker';
import { StudentOverview } from '@/components/student-overview';
import { Screen } from '@/components/ui';

export default function ParentProgress() {
  return (
    <Screen>
      <ChildPicker>{(student) => <StudentOverview key={student.id} student={student} />}</ChildPicker>
    </Screen>
  );
}
