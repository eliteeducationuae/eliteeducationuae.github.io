import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CataloguePicker } from '@/components/catalogue-picker';
import { modernCurriculum, subjectLine } from '@/components/catalogue-choice';
import { PIPELINE, stageOf, viaSource } from '@/components/ops/enquiry-stage';
import { Facts, NoHeader, Quote, StageLabel, Stepper } from '@/components/ops/parts';
import { RepeatNote, SpamActions, SpamBanner } from '@/components/spam';
import {
  Actions,
  Button,
  Chip,
  ChipField,
  Columns,
  EmptyState,
  ErrorNote,
  Field,
  FieldsCard,
  Group,
  GroupRow,
  Loading,
  Notice,
  PageHeader,
  Row,
  Screen,
  TextLink,
  Txt,
  useToast,
} from '@/components/ui';
import { tutorChipLabel, useComplianceMap } from '@/components/vetting';
import { builtInSyllabusesFor } from '@/data/curriculum';
import { source } from '@/data';
import { useAction, useEnquiries, useFamilies, useStudents, useTutors } from '@/data/hooks';
import { CURRICULA, EXAM_BOARDS, LEVELS, PHASES, SUBJECTS, cleanChoice } from '@/domain/catalogue';
import { addDays, formatDate, relativeDay, toDateKey } from '@/domain/dates';
import { tutorTeaches, validateEnrolments } from '@/domain/enrolments';
import { isPossibleSpam } from '@/domain/spam';
import type { Enquiry, EnquiryStatus } from '@/domain/types';
import { withoutClosed } from '@/domain/closed-accounts';
import { useTheme } from '@/hooks/use-theme';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function EnquiryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const enquiries = useEnquiries();
  if (enquiries.isLoading) return <Loading />;
  const e = enquiries.data?.find((x) => x.id === id);
  if (!e) {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/manage/enquiries' }} kicker="Enquiry" title="Enquiry not found" />
        <EmptyState title="Enquiry not found" message="It may have been removed, or the link is out of date." />
      </Screen>
    );
  }
  return <Detail key={e.id} e={e} />;
}

function Detail({ e }: { e: Enquiry }) {
  const theme = useTheme();
  const toast = useToast();
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
  const stage = stageOf(e.status, theme);
  const spam = isPossibleSpam(e);
  const step = PIPELINE.indexOf(e.status);
  const badDate = !!followUp && !DATE.test(followUp);
  const tomorrow = toDateKey(addDays(new Date(), 1));
  const nextWeek = toDateKey(addDays(new Date(), 7));

  async function move(status: EnquiryStatus) {
    try {
      await update.mutateAsync([e.id, { status, lostReason: status === 'lost' ? lostReason.trim() || undefined : e.lostReason }]);
      if (status === 'enrolled' && family && family.status !== 'active') await setStatus.mutateAsync([family.id, 'active']);
      toast(`Moved to ${stageOf(status, theme).label}`);
    } catch {
      // Shown by the ErrorNote below.
    }
  }
  /** Runs a save; a failure is shown by the ErrorNote rather than thrown. */
  const run = (fn: () => Promise<unknown>) => () => {
    fn().catch(() => undefined);
  };

  const facts: [string, string | undefined][] = [
    ['Student', e.studentName],
    ['Year group', e.yearGroup],
    ['Subject', subjectLine(e) || undefined],
    ['Preferred times', e.preferredTimes],
    ['Phone', e.phone],
    ['Email', e.email],
  ];

  return (
    <Screen topInset>
      <NoHeader />
      <PageHeader
        back={{ fallback: '/manage/enquiries' }}
        kicker={`Enquiry · ${relativeDay(e.createdAt)} ${viaSource(e.source)}`}
        title={e.parentName}
        right={<StageLabel label={stage.label} color={stage.color} />}>
        <RepeatNote repeatCount={e.repeatCount} />
      </PageHeader>
      <SpamBanner kind="enquiry" id={e.id} item={e} />

      <Columns>
        <View style={{ gap: 20 }}>
          {e.message ? <Quote>{e.message}</Quote> : null}
          <Facts rows={facts.map(([k, v]) => ({ k, v }))} />
          {phoneDigits || e.email ? (
            <Row gap={10} wrap>
              {phoneDigits ? <Button title="Call" icon="call" size="sm" variant="secondary" onPress={() => Linking.openURL(`tel:${phoneDigits}`)} /> : null}
              {phoneDigits ? (
                <Button title="WhatsApp" icon="chat" size="sm" variant="secondary" onPress={() => Linking.openURL(`https://wa.me/${phoneDigits.replace('+', '')}`)} />
              ) : null}
              {e.email ? (
                <Button
                  title="Email"
                  icon="mail"
                  size="sm"
                  variant="secondary"
                  onPress={() => Linking.openURL(`mailto:${e.email}?subject=${encodeURIComponent('Your enquiry with Elite Education')}`)}
                />
              ) : null}
            </Row>
          ) : null}

          {spam ? null : (
            <View style={{ gap: 12 }}>
              <Txt variant="label">Stage</Txt>
              <Stepper
                steps={PIPELINE.map((s) => stageOf(s, theme).label)}
                current={step}
                onPick={(i) => move(PIPELINE[i])}
                disabled={update.isPending}
                accessibilityLabel="Stage"
              />
              {e.status === 'lost' ? (
                <View style={{ gap: 12 }}>
                  <Field label="Reason lost" value={lostReason} onChangeText={setLostReason} placeholder="For example, price, timing or another provider" />
                  <Row gap={10} wrap>
                    <Button
                      title="Save reason"
                      size="sm"
                      variant="secondary"
                      onPress={run(async () => {
                        await update.mutateAsync([e.id, { lostReason: lostReason.trim() || undefined }]);
                        toast('Reason saved');
                      })}
                    />
                    <Button title="Reopen" size="sm" variant="ghost" onPress={() => move('contacted')} />
                  </Row>
                </View>
              ) : (
                <View style={{ flexDirection: 'row' }}>
                  <TextLink label="Mark as lost" onPress={() => move('lost')} />
                </View>
              )}
              {e.status === 'new' ? <SpamActions kind="enquiry" id={e.id} status={e.spamStatus} compact /> : null}
            </View>
          )}
          <ErrorNote error={update.error ?? setStatus.error} />
        </View>

        <View style={{ gap: 20 }}>
          {spam ? (
            <Notice title="Next steps">Next steps will appear here once this enquiry has been marked as not spam.</Notice>
          ) : family && student ? (
            <Group
              title={`The ${family.name} family · ${student.fullName}`}
              note={
                family.status === 'prospect'
                  ? 'A prospect family. Book the trial lesson, find a tutor, or message them.'
                  : 'Book a lesson, find a tutor, or message the family.'
              }>
              <GroupRow
                icon="calendar_month"
                title="Book the trial lesson"
                note="Opens Schedule lessons with the student chosen"
                onPress={run(async () => {
                  if (e.status === 'new' || e.status === 'contacted') await update.mutateAsync([e.id, { status: 'trial-booked', studentId: student.id }]);
                  router.push({ pathname: '/lesson/new', params: { studentId: student.id } });
                })}
              />
              <GroupRow
                icon="sell"
                title="Find a tutor (post a role)"
                note="Tutors who teach the subject can say they are interested"
                onPress={() => router.push({ pathname: '/manage/opportunity-edit', params: { enquiryId: e.id, studentId: student.id } })}
              />
              <GroupRow icon="school" title="Student profile" onPress={() => router.push({ pathname: '/students/[id]', params: { id: student.id } })} />
              <GroupRow icon="forum" title="Message" onPress={() => router.push({ pathname: '/messages/[familyId]', params: { familyId: family.id } })} />
            </Group>
          ) : (
            <ConvertCard e={e} />
          )}

          <FieldsCard title="Notes · staff only">
            <Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="What did you discuss?" />
            <View style={{ gap: 8 }}>
              <Txt variant="label">Follow up</Txt>
              <Row gap={8} wrap>
                <Chip label="Tomorrow" selected={followUp === tomorrow} onPress={() => setFollowUp(tomorrow)} />
                <Chip label="Next week" selected={followUp === nextWeek} onPress={() => setFollowUp(nextWeek)} />
                <Chip label="None" selected={!followUp} onPress={() => setFollowUp('')} />
              </Row>
            </View>
            <Field
              label="Follow-up date"
              value={followUp}
              onChangeText={setFollowUp}
              placeholder="YYYY-MM-DD"
              error={badDate ? 'Use YYYY-MM-DD for the follow-up date.' : undefined}
              hint={e.nextActionAt && !badDate ? `Currently set for ${formatDate(e.nextActionAt)}.` : undefined}
            />
            <Actions>
              <Button
                title="Save notes"
                variant="secondary"
                loading={update.isPending}
                disabled={badDate}
                onPress={run(async () => {
                  await update.mutateAsync([e.id, { notes: notes.trim() || undefined, nextActionAt: followUp || undefined }]);
                  toast(followUp ? `Notes saved. Follow-up set for ${formatDate(followUp)}.` : 'Notes saved');
                })}
              />
            </Actions>
          </FieldsCard>
        </View>
      </Columns>
    </Screen>
  );
}

/** Turn an enquiry into a family, a student and their first subject, so a trial lesson can be booked. */
function ConvertCard({ e }: { e: Enquiry }) {
  const toast = useToast();
  const saveFamily = useAction(source.saveFamily);
  const saveStudent = useAction(source.saveStudent);
  const saveEnrolment = useAction(source.saveEnrolment);
  const update = useAction(source.updateEnquiry);
  const families = useFamilies();
  const tutors = useTutors();
  const vetting = useComplianceMap();
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
  const [tried, setTried] = useState(false);
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
    setTried(true);
    if (!studentName.trim() || !cleanChoice(subject)) return;
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
    toast(existing ? `${studentName.trim()} added to the ${existing.name} family` : `The ${lastName} family has been created`);
  }

  return (
    <FieldsCard title="Welcome them as a family">
      <Txt variant="note">
        {existing ? `Adds the student to the ${existing.name} family` : `Creates the ${lastName} family and the student`}, so you can book a
        complimentary trial.{e.email ? ' They can sign up later with the same email address.' : ''} Further subjects can be added from the
        student’s profile.
      </Txt>
      <Field
        label="Student’s full name"
        value={studentName}
        onChangeText={setStudentName}
        autoCapitalize="words"
        placeholder={`For example, ${e.studentName ?? 'Zara'} ${lastName}`}
        error={tried && !studentName.trim()}
      />
      <Field label="Year group" value={yearGroup} onChangeText={setYearGroup} placeholder="For example, Year 11" />
      <CataloguePicker label="Subject" options={SUBJECTS} value={subject} onChange={setSubject} collapsed={10} />
      {tried && !cleanChoice(subject) ? <Txt variant="small" color="danger">Please choose one.</Txt> : null}
      <CataloguePicker label="Phase" options={PHASES} value={phase} onChange={setPhase} optional />
      <CataloguePicker label="Curriculum" options={CURRICULA} value={curriculum} onChange={setCurriculum} optional collapsed={8} />
      <CataloguePicker label="Level" options={LEVELS} value={level} onChange={setLevel} optional />
      <CataloguePicker label="Exam board" options={EXAM_BOARDS} value={examBoard} onChange={setExamBoard} optional />
      {sortedTutors.length ? (
        <View style={{ gap: 8 }}>
          <Txt variant="label">Tutor (optional)</Txt>
          <Row gap={8} wrap>
            {sortedTutors.map((t) => (
              <Chip
                key={t.id}
                label={tutorChipLabel(tutorTeaches(t, subject) && subject ? `${t.fullName} ✓` : t.fullName, vetting.get(t.id))}
                selected={tutorId === t.id}
                onPress={() => setTutorId(tutorId === t.id ? undefined : t.id)}
              />
            ))}
          </Row>
          <Txt variant="small">✓ marks tutors who already teach this subject.</Txt>
        </View>
      ) : null}
      {lists.length ? (
        <ChipField
          label="Topic list"
          options={[...lists.map((l) => ({ value: l.id, label: l.name })), { value: '__build', label: 'Build as we teach' }]}
          value={chosenList ?? '__build'}
          onChange={(v) => setSyllabusId(v === '__build' ? undefined : v)}
        />
      ) : null}
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
      <ErrorNote error={saveFamily.error ?? saveStudent.error ?? saveEnrolment.error ?? update.error} />
      <Button title="Create family and student" loading={busy} onPress={() => create().catch(() => undefined)} />
    </FieldsCard>
  );
}
