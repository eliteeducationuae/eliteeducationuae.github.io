import { ChildPicker } from '@/components/child-picker';
import { PublishedReports } from '@/components/reports';
import { StudentOverview } from '@/components/student-overview';
import { Screen } from '@/components/ui';

export default function StudentProgress() {
  return (
    <Screen>
      <ChildPicker>
        {(student) => (
          <>
            <StudentOverview key={student.id} student={student} />
            <PublishedReports student={student} />
          </>
        )}
      </ChildPicker>
    </Screen>
  );
}
