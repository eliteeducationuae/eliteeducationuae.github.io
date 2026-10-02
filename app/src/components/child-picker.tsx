import { useState } from 'react';

import { useStudents } from '@/data/hooks';
import type { Student } from '@/domain/types';

import { EmptyState, Loading, Segmented } from './ui';

/** For families with several children: pick one, then render `children(student)`. */
export function ChildPicker({ children }: { children: (student: Student) => React.ReactNode }) {
  const students = useStudents();
  const [selected, setSelected] = useState<string | null>(null);
  if (students.isLoading) return <Loading />;
  const list = students.data ?? [];
  if (list.length === 0) return <EmptyState icon="people" title="No students on this account yet" />;
  const current = list.find((s) => s.id === selected) ?? list[0];
  return (
    <>
      {list.length > 1 ? (
        <Segmented value={current.id} onChange={setSelected} options={list.map((s) => ({ value: s.id, label: s.fullName.split(' ')[0] }))} />
      ) : null}
      {children(current)}
    </>
  );
}
