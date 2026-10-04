import { router } from 'expo-router';
import { useMemo } from 'react';

import { useHomework, useInvoices, useLessons, useRatings, useStudents } from '@/data/hooks';
import { addDays, startOfDay } from '@/domain/dates';
import { AT_RISK_THRESHOLD, studentRisk, type StudentRisk } from '@/domain/insights';
import type { Student } from '@/domain/types';

import { Badge, ListItem, Txt, type Tone } from './ui';

const FROM = addDays(startOfDay(new Date()), -60);
const TO = addDays(startOfDay(new Date()), 90);

/** Early-warning scores for every student the viewer can see, highest first. */
export function useAtRisk(): { list: (StudentRisk & { student: Student })[]; ready: boolean } {
  const students = useStudents();
  const lessons = useLessons(FROM, TO);
  const homework = useHomework();
  const ratings = useRatings();
  const invoices = useInvoices();
  return useMemo(() => {
    if (!students.data || !lessons.data || !homework.data || !ratings.data || !invoices.data) return { list: [], ready: false };
    const data = { lessons: lessons.data, homework: homework.data, ratings: ratings.data, invoices: invoices.data };
    const list = students.data
      .map((s) => ({ ...studentRisk(s, data), student: s }))
      .filter((r) => r.score >= AT_RISK_THRESHOLD)
      .sort((a, b) => b.score - a.score);
    return { list, ready: true };
  }, [students.data, lessons.data, homework.data, ratings.data, invoices.data]);
}

export const riskTone = (score: number): Tone => (score >= 60 ? 'danger' : score >= AT_RISK_THRESHOLD ? 'warning' : 'neutral');

export function RiskRow({ risk }: { risk: StudentRisk & { student: Student } }) {
  return (
    <ListItem
      title={risk.student.fullName}
      subtitle={risk.signals.map((s) => s.label).join(' · ')}
      right={<Badge label={`Risk ${risk.score}`} tone={riskTone(risk.score)} />}
      onPress={() => router.push({ pathname: '/students/[id]', params: { id: risk.student.id } })}
    />
  );
}

export function RiskNote({ risk }: { risk: StudentRisk }) {
  if (risk.signals.length === 0) return null;
  return (
    <Txt variant="small">
      Watch: {risk.signals.map((s) => s.label.toLowerCase()).join(', ')}
    </Txt>
  );
}
