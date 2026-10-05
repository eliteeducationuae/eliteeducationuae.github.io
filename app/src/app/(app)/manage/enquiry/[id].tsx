import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CataloguePicker } from '@/components/catalogue-picker';
import { modernCurriculum, subjectLine } from '@/components/catalogue-choice';
import { ENQUIRY_STATUS } from '@/components/enquiries';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { builtInSyllabusesFor } from '@/data/curriculum';
import { source } from '@/data';
import { useAction, useEnquiries, useFamilies, useStudents, useTutors } from '@/data/hooks';
import { CURRICULA, EXAM_BOARDS, LEVELS, PHASES, SUBJECTS, cleanChoice } from '@/domain/catalogue';
import { addDays, formatDate, relativeDay, toDateKey } from '@/domain/dates';
import { tutorTeaches, validateEnrolments } from '@/domain/enrolments';
import type { Enquiry, EnquiryStatus } from '@/domain/types';
import { withoutClosed } from '@/domain/closed-accounts';

const NEXT: { status: EnquiryStatus; label: string }[] = [
  { status: 'new', label: 'New' },
  { status: 'contacted', label: 'Contacted' },
  { status: 'trial-booked', label: 'Trial booked' },
  { status: 'enrolled', label: 'Enrolled' },
  { status: 'lost', label: 'Lost' },
];

export default function EnquiryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const enquiries = useEnquiries();
  if (enquiries.isLoading) return <Loading />;
  const e = enquiries.data?.find((x) => x.id === id);
  if (!e) return <Screen><EmptyState title="Enquiry not found" /></Screen>;
  return <Detail key={e.id} e={e} />;
}

function Detail({ e }: { e: Enquiry }) {
  const update = useAction(source.updateEnquiry);
  const setStatus = useAction(source.setFamilyStatus);
  const families = useFamilies();
  const students = useStudents();
  const [notes, setNotes] = useState(e.notes ?? '');
  const [followUp, setFollowUp] = useState(e.nextActionAt ?? '');
  const [lostReason, setLostReason] = useState(e.lostReason ?? '');
  const family = e.familyId ? families.data?.find((f) => f.id === e.familyId) : undefined;
  const student = e.studentId
    ? students.data?.find((s) => s.id === e.studentId)
    : family
      ? students.data?.find((s) => s.familyId === family.id)
      : undefined;
  const phoneDigits = e.phone?.replace(/[^\d+]/g, '');

  async function move(status: EnquiryStatus) {
    await update.mutateAsync([e.id, { status, lostReason: status === 'lost' ? lostReason.trim() || undefined : e.lostReason }]);
    if (status === 'enrolled' && family && family.status !== 'active') await setStatus.mutateAsync([family.id, 'active']);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: e.parentName }} />
      <Card style={{ gap: Spacing.two }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="h2">{e.parentName}</Txt>
            <Txt variant="muted">
              {relativeDay(e.createdAt)} via {e.source}
            </Txt>
          </View>
          <Badge label={ENQUIRY_STATUS[e.status].label} tone={ENQUIRY_STATUS[e.status].tone} />
        </Row>
        {e.studentName || e.yearGroup ? <Txt>{[e.studentName, e.yearGroup].filter(Boolean).join(' · ')}</Txt> : null}
        {subjectLine(e) ? <Txt variant="muted">{subjectLine(e)}</Txt> : null}
        {e.preferredTimes ? <Txt variant="muted">Preferred times: {e.preferredTimes}</Txt> : null}
        {e.message ? <Txt style={{ fontStyle: 'italic' }}>“{e.message}”</Txt> : null}
        <Row gap={Spacing.two} wrap>
          {phoneDigits ? <Button title="Call" icon="phone" size="sm" variant="secondary" onPress={() => Linking.openURL(`tel:${phoneDigits}`)} /> : null}
          {phoneDigits ? (
            <Button title="WhatsApp" icon="chat" size="sm" variant="secondary" onPress={() => Linking.openURL(`https://wa.me/${phoneDigits.replace('+', '')}`)} />
          ) : null}
          {e.email ? (
            <Button title="Email" icon="mail" size="sm" variant="secondary" onPress={() => Linking.openURL(`mailto:${e.email}?subject=${encodeURIComponent('Your enquiry with Elite Education')}`)} />
          ) : null}
        </Row>
      </Card>

      <Section title="Stage">
        <Row gap={Spacing.one} wrap>
          {NEXT.map((n) => (
            <Chip key={n.status} label={n.label} selected={e.status === n.status} onPress={() => move(n.status)} />
          ))}
        </Row>
        {e.status === 'lost' ? (
          <Row gap={Spacing.two}>
            <View style={{ flex: 1 }}>
              <Field label="Reason lost" value={lostReason} onChangeText={setLostReason} placeholder="For example, price, timing or another provider" />
            </View>
            <Button title="Save" size="sm" style={{ marginTop: 18 }} onPress={() => update.mutate([e.id, { lostReason: lostReason.trim() || undefined }])} />
          </Row>
        ) : null}
      </Section>

      <Section title="Next steps">
        {family && student ? (
          <Card style={{ gap: Spacing.two }}>
            <Txt>
              {family.name} family{family.status === 'prospect' ? ' (prospect)' : ''} · {student.fullName}
            </Txt>
            <Row gap={Spacing.two} wrap>
              <Button
                title="Book trial lesson"
                icon="calendar"
                size="sm"
                variant="gold"
                onPress={async () => {
                  if (e.status === 'new' || e.status === 'contacted') await update.mutateAsync([e.id, { status: 'trial-booked', studentId: student.id }]);
                  router.push({ pathname: '/lesson/new', params: { studentId: student.id } });
                }}
              />
              <Button title="Find a tutor (post role)" icon="school" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/manage/opportunity-edit', params: { enquiryId: e.id, studentId: student.id } })} />
              <Button title="Student profile" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/students/[id]', params: { id: student.id } })} />
              <Button title="Message" icon="chat" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/messages/[familyId]', params: { familyId: family.id } })} />
            </Row>
          </Card>
        ) : (
          <ConvertCard e={e} />
        )}
      </Section>

      <Section title="Notes">
        <Field label="Notes (staff only)" value={notes} onChangeText={setNotes} multiline placeholder="What did you discuss?" />
        <Row gap={Spacing.two}>
          <View style={{ flex: 1 }}>
            <Field label="Follow up on" value={followUp} onChangeText={setFollowUp} placeholder="YYYY-MM-DD" />
          </View>
          <Chip label="Tomorrow" onPress={() => setFollowUp(toDateKey(addDays(new Date(), 1)))} />
          <Chip label="Next week" onPress={() => setFollowUp(toDateKey(addDays(new Date(), 7)))} />
        </Row>
        {followUp && !/^\d{4}-\d{2}-\d{2}$/.test(followUp) ? <Banner tone="danger" icon="alert">Use YYYY-MM-DD for the follow-up date.</Banner> : null}
        <ErrorNote error={update.error} />
        <Button
          title="Save notes"
          variant="secondary"
          loading={update.isPending}
          disabled={!!followUp && !/^\d{4}-\d{2}-\d{2}$/.test(followUp)}
          onPress={() => update.mutate([e.id, { notes: notes.trim() || undefined, nextActionAt: followUp || undefined }])}
        />
        {e.nextActionAt ? <Txt variant="small">Follow-up set for {formatDate(e.nextActionAt)}</Txt> : null}
      </Section>
    </Screen>
  );
}

/** Turn an enquiry into a family, a student and their first subject, so a trial lesson can be booked. */
function ConvertCard({ e }: { e: Enquiry }) {
  const saveFamily = useAction(source.saveFamily);
  const saveStudent = useAction(source.saveStudent);
  const saveEnrolment = useAction(source.saveEnrolment);
  const update = useAction(source.updateEnquiry);
  const families = useFamilies();
  const tutors = useTutors();
  const [studentName, setStudentName] = useState(e.studentName ?? '');
  const [yearGroup, setYearGroup] = useState(e.yearGroup ?? '');
  const [phase, setPhase] = useState<string | undefined>(cleanChoice(e.phase));
  const [subject, setSubject] = useState<string | undefined>(cleanChoice(e.subject));
  const [curriculum, setCurriculum] = useState<string | undefined>(modernCurriculum(e.curriculum));
  const [level, setLevel] = useState<string | undefined>();
  const [examBoard, setExamBoard] = useState<string | undefined>();
  const [tutorId, setTutorId] = useState<string | undefined>();
  const [syllabusId, setSyllabusId] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  // What has been created so far, so a retry after a failure carries on rather than creating duplicates.
  const [made, setMade] = useState<{ familyId?: string; studentId?: string; enrolmentId?: string }>({});
  const existing = e.familyId ? families.data?.find((f) => f.id === e.familyId) : undefined;
  const lastName = e.parentName.trim().split(' ').pop() ?? e.parentName;
  const lists = builtInSyllabusesFor(subject, curriculum);
  const chosenList = lists.some((l) => l.id === syllabusId) ? syllabusId : undefined;
  const sortedTutors = withoutClosed(tutors.data).sort(
    (a, b) => Number(tutorTeaches(b, subject)) - Number(tutorTeaches(a, subject)) || a.fullName.localeCompare(b.fullName),
  );
  const busy = saveFamily.isPending || saveStudent.isPending || saveEnrolment.isPending || update.isPending;

  async function create() {
    const draft = {
      subject: cleanChoice(subject) ?? '',
      curriculum: cleanChoice(curriculum),
      level: cleanChoice(level),
      examBoard: cleanChoice(examBoard),
      tutorId,
      syllabusId: chosenList,
      active: true,
    };
    const invalid = validateEnrolments([draft]);
    setProblem(invalid);
    if (invalid) return;
    let { familyId, studentId, enrolmentId } = { familyId: existing?.id, ...made };
    if (!familyId) {
      familyId = (
        await saveFamily.mutateAsync([{ name: lastName, parentName: e.parentName, email: e.email ?? '', phone: e.phone, status: 'prospect' }])
      ).id;
      setMade((m) => ({ ...m, familyId }));
    }
    studentId = (
      await saveStudent.mutateAsync([
        { id: studentId, familyId, fullName: studentName.trim(), yearGroup: yearGroup.trim() || undefined, phase: cleanChoice(phase) },
      ])
    ).id;
    setMade((m) => ({ ...m, studentId }));
    enrolmentId = (await saveEnrolment.mutateAsync([{ ...draft, id: enrolmentId, studentId }])).id;
    setMade((m) => ({ ...m, enrolmentId }));
    await update.mutateAsync([e.id, { familyId, studentId, status: e.status === 'new' ? 'contacted' : e.status }]);
  }

  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">Add as a family</Txt>
      <Txt variant="muted">
        {existing ? `Adds the student to the ${existing.name} family` : `Creates the ${lastName} family and the student`} so you can book a trial lesson.
        {e.email ? ' They will be able to sign up with the same email address.' : ''} You can add further subjects from the student’s profile.
      </Txt>
      <Field label="Student’s full name" value={studentName} onChangeText={setStudentName} autoCapitalize="words" placeholder={`For example, ${e.studentName ?? 'Zara'} ${lastName}`} />
      <Field label="Year group" value={yearGroup} onChangeText={setYearGroup} placeholder="For example, Year 11" />
      <CataloguePicker label="Phase" options={PHASES} value={phase} onChange={setPhase} optional />
      <CataloguePicker label="Subject" options={SUBJECTS} value={subject} onChange={setSubject} collapsed={10} />
      <CataloguePicker label="Curriculum" options={CURRICULA} value={curriculum} onChange={setCurriculum} optional collapsed={8} />
      <CataloguePicker label="Level" options={LEVELS} value={level} onChange={setLevel} optional />
      <CataloguePicker label="Exam board" options={EXAM_BOARDS} value={examBoard} onChange={setExamBoard} optional />
      {sortedTutors.length ? (
        <Section title="Tutor (optional)">
          <Row gap={Spacing.one} wrap>
            {sortedTutors.map((t) => (
              <Chip
                key={t.id}
                label={tutorTeaches(t, subject) && subject ? `${t.fullName} ✓` : t.fullName}
                selected={tutorId === t.id}
                onPress={() => setTutorId(tutorId === t.id ? undefined : t.id)}
              />
            ))}
          </Row>
        </Section>
      ) : null}
      {lists.length ? (
        <Section title="Topic list">
          <Row gap={Spacing.one} wrap>
            {lists.map((l) => (
              <Chip key={l.id} label={l.name} selected={chosenList === l.id} onPress={() => setSyllabusId(l.id)} />
            ))}
            <Chip label="Build as we teach" selected={!chosenList} onPress={() => setSyllabusId(undefined)} />
          </Row>
        </Section>
      ) : null}
      {problem ? (
        <Banner tone="danger" icon="alert">
          {problem}
        </Banner>
      ) : null}
      <ErrorNote error={saveFamily.error ?? saveStudent.error ?? saveEnrolment.error ?? update.error} />
      <Button title="Create family and student" variant="gold" disabled={!studentName.trim() || !cleanChoice(subject)} loading={busy} onPress={create} />
    </Card>
  );
}
