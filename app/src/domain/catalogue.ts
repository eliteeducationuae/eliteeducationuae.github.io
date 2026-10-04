/**
 * The choices offered by the subject, phase and curriculum pickers. Every picker also accepts free text
 * ("Other…"), so nothing here is a closed list: stored values are plain strings.
 */

export const OTHER = 'Other';

export const SUBJECTS: readonly string[] = [
  'Maths',
  'Additional Maths',
  'Further Maths',
  'English',
  'English Language',
  'English Literature',
  'Physics',
  'Chemistry',
  'Biology',
  'Combined Science',
  'Arabic',
  'Islamic Studies',
  'French',
  'Spanish',
  'German',
  'Mandarin',
  'History',
  'Geography',
  'Economics',
  'Business',
  'Accounting',
  'Psychology',
  'Computer Science',
  'Global Perspectives',
  'Theory of Knowledge',
  'Extended Essay',
  'Primary (all subjects)',
  'Phonics and reading',
  '11+ and entrance exams',
  'SAT and ACT',
  'University admissions',
];

export const PHASES: readonly string[] = [
  'Early Years',
  'Primary',
  'Lower Secondary',
  'GCSE and IGCSE',
  'Sixth Form and IB Diploma',
  'University',
  'Adult learner',
];

export const CURRICULA: readonly string[] = [
  'British',
  'IGCSE',
  'GCSE',
  'A-Level',
  'BTEC',
  'IB PYP',
  'IB MYP',
  'IB DP',
  'American',
  'AP',
  'Indian CBSE',
  'Indian ICSE',
  'French',
  'UAE MoE',
];

export const LEVELS: readonly string[] = ['HL', 'SL', 'Higher', 'Foundation', 'Core', 'Extended', 'AS', 'A2'];

export const EXAM_BOARDS: readonly string[] = [
  'AQA',
  'Cambridge',
  'Pearson Edexcel',
  'OCR',
  'WJEC Eduqas',
  'IB',
  'College Board',
  'CBSE',
  'CISCE',
];

/** Whether `value` is one of the listed choices (trimmed, case-insensitive). */
export function inCatalogue(list: readonly string[], value?: string): boolean {
  const v = value?.trim().toLowerCase();
  if (!v) return false;
  return list.some((item) => item.toLowerCase() === v);
}

/** Tidy a typed choice: trims, collapses inner spaces, and turns an empty value into undefined. */
export function cleanChoice(value?: string): string | undefined {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v ? v : undefined;
}
