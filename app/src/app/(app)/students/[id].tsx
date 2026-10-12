import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { NoHeader } from '@/components/admin-people/kit';
import { HistorySection } from '@/components/history';
import { StudentAdmissionsLinks } from '@/components/admissions/entry-links';
import { useAtRisk } from '@/components/insights';
import { StudentOverview } from '@/components/student-overview';
import { Actions, Button, Columns, EmptyState, Figure, Figures, Group, GroupRow, Loading, Notice, PageHeader, Screen } from '@/components/ui';
import { ViewAsActions } from '@/components/view-as';
import { formatPhoneForDisplay, RELATIONSHIP_LABELS } from '@/domain/contacts';
import { useEnrolments, useFamilyContacts, useLessons, useLookup, useStudents } from '@/data/hooks';
import { useMe } from '@/data/session';
import type { Student } from '@/domain/types';
import { addDays, formatDate, formatTime, relativeDay } from '@/domain/dates';
import { activeEnrolments, enrolmentDetail, enrolmentTitle } from '@/domain/enrolments';

export default function StudentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const students = useStudents();
  const lookup = useLookup();
  if (students.isLoading || !lookup.ready) return <Loading />;
  const student = students.data?.find((s) => s.id === id);
  if (!student) {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/' }} title="Student not found" />
        <EmptyState title="Student not found" message="They may have been removed, or they may not be one of your students." />
      </Screen>
    );
  }
  return <StudentProfile student={student} />;
}

function StudentProfile({ student }: { student: Student }) {
  const me = useMe();
  const isAdmin = me.role === 'admin';
  const staff = isAdmin || me.role === 'tutor';
  const lookup = useLookup();
  const atRisk = useAtRisk();
  const enrolments = useEnrolments(student.id);
  const [range] = useState(() => ({ from: new Date(), to: addDays(new Date(), 90) }));
  const lessons = useLessons(range.from, range.to);
  const family = lookup.family(student.familyId);
  const risk = atRisk.list.find((r) => r.student.id === student.id);
  const subjects = activeEnrolments(enrolments.data ?? [], student.id);
  const next = (lessons.data ?? [])
    .filter((l) => l.studentIds.includes(student.id) && l.status === 'scheduled' && new Date(l.start) > range.from)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  const nextTutor = next ? lookup.tutor(next.tutorId)?.fullName : undefined;
  // Names and relationships only (tutors never receive contact details).
  const contacts = useFamilyContacts(staff ? family?.id : undefined).data ?? [];

  return (
    <Screen topInset>
      <NoHeader title={student.fullName.split(' ')[0]} />
      <PageHeader
        back={{ fallback: isAdmin ? '/admin/students' : '/' }}
        kicker={[student.yearGroup, student.school].filter(Boolean).join(' · ') || 'Student'}
        title={student.fullName}
        sub={family && staff ? `${family.name} family${student.phase ? ` · ${student.phase}` : ''}` : undefined}
      />

      {risk && isAdmin ? (
        <Notice tone="warn" title="Worth a conversation" icon="alert">
          {`Watch: ${risk.signals.map((s) => s.label.toLowerCase()).join(', ')}. Risk score ${risk.score}.`}
        </Notice>
      ) : null}

      <Figures>
        <Figure label="Working at" value={student.currentGrade || '–'} hint={student.examDate ? `Exams ${formatDate(student.examDate)}` : 'current grade'} />
        <Figure label="Target" value={student.targetGrade || '–'} hint="agreed with the family" tone={student.targetGrade ? 'good' : undefined} />
        <Figure
          label="Next lesson"
          value={next ? `${relativeDay(next.start)} ${formatTime(next.start)}` : 'None booked'}
          hint={next ? [next.subject, nextTutor ? `with ${nextTutor}` : null].filter(Boolean).join(' ') : 'in the next 90 days'}
          tone={next ? undefined : 'warn'}
        />
      </Figures>

      {staff && student.notes ? <Notice tone="info" title="Tutor notes">{student.notes}</Notice> : null}

      {staff ? (
        <Columns>
          <Group title="Subjects" meta={subjects.length ? `${subjects.length} active` : undefined} note={subjects.length ? undefined : 'No subjects yet.'}>
            {subjects.map((e) => {
              const tutor = e.tutorId ? lookup.tutor(e.tutorId) : undefined;
              return (
                <GroupRow
                  key={e.id}
                  icon="school"
                  title={enrolmentTitle(e)}
                  note={enrolmentDetail(e, tutor?.fullName) || 'No tutor yet'}
                  onPress={isAdmin && tutor ? () => router.push({ pathname: '/manage/tutor/[id]', params: { id: tutor.id } }) : undefined}
                />
              );
            })}
          </Group>
          {family ? (
            <Group
              title="Family"
              link={isAdmin ? { label: 'Open the family', onPress: () => router.push({ pathname: '/manage/family/[id]', params: { id: family.id } }) } : undefined}>
              <GroupRow
                avatar={family.parentName}
                title={`${family.name} family`}
                // Tutors see the family's contacts by name and relationship only.
                note={isAdmin ? [family.email, family.phone ? formatPhoneForDisplay(family.phone) : null].filter(Boolean).join(' · ') : family.parentName}
              />
              {contacts.map((c) => (
                <GroupRow key={c.id} avatar={c.name} title={c.name} note={RELATIONSHIP_LABELS[c.relationship]} value={c.isPrimary ? 'Main contact' : undefined} valueTone="accent" />
              ))}
            </Group>
          ) : null}
        </Columns>
      ) : null}

      {isAdmin ? (
        <Actions>
          <Button title="Schedule lessons" icon="calendar_month" onPress={() => router.push({ pathname: '/lesson/new', params: { studentId: student.id } })} />
          {family ? (
            <Button title="Message the family" icon="forum" variant="secondary" onPress={() => router.push({ pathname: '/messages/[familyId]', params: { familyId: family.id } })} />
          ) : null}
          <Button title="Edit details" icon="edit" variant="secondary" onPress={() => router.push({ pathname: '/students/edit', params: { id: student.id } })} />
        </Actions>
      ) : null}

      <StudentOverview student={student} hideSummary />
      <ViewAsActions studentId={student.id} />
      <HistorySection filter={{ studentId: student.id }} />
      <StudentAdmissionsLinks studentId={student.id} />
    </Screen>
  );
}
