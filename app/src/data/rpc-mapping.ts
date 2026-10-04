import type { NewChildSubject } from './source';

/** The add_my_child RPC's p_subjects: snake_case keys, blanks left out. */
export function addChildSubjects(subjects: NewChildSubject[]): Record<string, string>[] {
  return subjects.map((s) => {
    const row: Record<string, string | undefined> = {
      subject: s.subject.trim(),
      curriculum: s.curriculum?.trim() || undefined,
      level: s.level?.trim() || undefined,
      exam_board: s.examBoard?.trim() || undefined,
      syllabus_id: s.syllabusId?.trim() || undefined,
    };
    return Object.fromEntries(Object.entries(row).filter((e): e is [string, string] => e[1] !== undefined));
  });
}
