import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { modernCurriculum } from '@/components/catalogue-choice';
import { CataloguePicker } from '@/components/catalogue-picker';
import { FormWithSummary, NoHeader, SummaryCard } from '@/components/admin-people/kit';
import { opportunityTitle, tutorFits } from '@/components/opportunities';
import { Actions, Button, ChipField, ErrorNote, Field, FieldsCard, Loading, Notice, PageHeader, Screen, Txt, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useEnquiries, useEnrolments, useOpportunities, useStudents, useTutors } from '@/data/hooks';
import { CURRICULA, PHASES, SUBJECTS, cleanChoice } from '@/domain/catalogue';
import { addDays, toDateKey } from '@/domain/dates';
import { activeEnrolments, sameSubject } from '@/domain/enrolments';
import type { Opportunity } from '@/domain/types';
import { withoutClosed } from '@/domain/closed-accounts';

/** Post (or edit) a role. Prefills from `?enquiryId=` or `?studentId=`. */
export default function EditOpportunity() {
  const params = useLocalSearchParams<{ id?: string; enquiryId?: string; studentId?: string }>();
  const opportunities = useOpportunities();
  const enquiries = useEnquiries();
  const students = useStudents();
  const studentId = params.studentId ?? enquiries.data?.find((e) => e.id === params.enquiryId)?.studentId;
  const enrolments = useEnrolments(studentId);
  if (opportunities.isLoading || enquiries.isLoading || students.isLoading || (studentId && enrolments.isLoading)) return <Loading />;
  const existing = params.id ? opportunities.data?.find((o) => o.id === params.id) : undefined;
  const enquiry = params.enquiryId ? enquiries.data?.find((e) => e.id === params.enquiryId) : undefined;
  const student = studentId ? students.data?.find((s) => s.id === studentId) : undefined;
  // The student's subject that matches the enquiry, or else their first active subject.
  const active = student ? activeEnrolments(enrolments.data ?? [], student.id) : [];
  const enrolment = active.find((e) => sameSubject(e.subject, enquiry?.subject)) ?? active[0];
  const subject = cleanChoice(enrolment?.subject ?? enquiry?.subject);
  const curriculum = modernCurriculum(enrolment?.curriculum ?? enquiry?.curriculum ?? student?.curriculum);
  const phase = cleanChoice(student?.phase ?? enquiry?.phase);
  const yearGroup = student?.yearGroup ?? enquiry?.yearGroup;
  const firstName = student ? student.fullName.split(' ')[0] : enquiry?.studentName;
  const defaults: Partial<Opportunity> = existing ?? {
    title: student || enquiry ? opportunityTitle({ yearGroup, curriculum, subject, firstName }) : '',
    description: enquiry?.message ?? (student ? `Current grade ${student.currentGrade ?? '–'}, target ${student.targetGrade ?? '–'}.` : ''),
    subject,
    phase,
    curriculum,
    syllabusId: enrolment?.syllabusId,
    studentId: student?.id ?? enquiry?.studentId,
    enquiryId: enquiry?.id,
    schedule: enquiry?.preferredTimes,
  };
  return <OpportunityForm existing={existing} defaults={defaults} />;
}

function OpportunityForm({ existing, defaults }: { existing?: Opportunity; defaults: Partial<Opportunity> }) {
  const tutors = useTutors();
  const save = useAction(source.saveOpportunity);
  const [title, setTitle] = useState(defaults.title ?? '');
  const [description, setDescription] = useState(defaults.description ?? '');
  const [subject, setSubject] = useState<string | undefined>(defaults.subject);
  const [phase, setPhase] = useState<string | undefined>(defaults.phase);
  const [curriculum, setCurriculum] = useState<string | undefined>(modernCurriculum(defaults.curriculum));
  const [schedule, setSchedule] = useState(defaults.schedule ?? '');
  const [location, setLocation] = useState(defaults.location ?? 'Online');
  const [pay, setPay] = useState(defaults.payRate ? String(defaults.payRate) : '');
  const [closesOn, setClosesOn] = useState(defaults.closesOn ?? toDateKey(addDays(new Date(), 5)));
  const [visibility, setVisibility] = useState<Opportunity['visibility']>(defaults.visibility ?? 'all');
  const [invited, setInvited] = useState<string[]>(defaults.invitedTutorIds ?? []);
  const valid = title.trim() && Number(pay) > 0 && (!closesOn || /^\d{4}-\d{2}-\d{2}$/.test(closesOn)) && (visibility === 'all' || invited.length > 0);

  const [tried, setTried] = useState(false);
  const toast = useToast();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/manage/opportunities'));
  const payInvalid = !(Number(pay) > 0);
  const closesInvalid = !!closesOn && !/^\d{4}-\d{2}-\d{2}$/.test(closesOn);
  const fitting = withoutClosed(tutors.data).filter((t) => !subject || tutorFits(t, { subject, curriculum }));

  async function submit() {
    setTried(true);
    if (!valid) return;
    const o = await save.mutateAsync([
      {
        id: existing?.id,
        title: title.trim(),
        description: description.trim() || undefined,
        subject: cleanChoice(subject),
        phase: cleanChoice(phase),
        curriculum: cleanChoice(curriculum),
        syllabusId: defaults.syllabusId,
        studentId: defaults.studentId,
        enquiryId: defaults.enquiryId,
        schedule: schedule.trim() || undefined,
        location: location.trim() || undefined,
        payRate: Number(pay),
        closesOn: closesOn || undefined,
        visibility,
        invitedTutorIds: visibility === 'invited' ? invited : [],
      },
    ]);
    router.replace({ pathname: '/manage/opportunity/[id]', params: { id: o.id } });
    toast(existing ? 'Role saved.' : 'Role posted to tutors.');
  }

  return (
    <Screen topInset>
      <NoHeader title={existing ? 'Edit role' : 'Post a role'} />
      <PageHeader
        back={{ label: 'Cancel', onPress: back }}
        kicker={existing ? 'Roles · Edit' : 'Roles · New'}
        title={existing ? 'Edit role' : 'Post a role'}
        sub="Tutors who can see the role get a notification and an email, and can register interest. You choose who takes it."
      />
      {tried && !valid ? (
        <Notice tone="danger" title="Not saved yet">
          A few details are missing. They are marked below.
        </Notice>
      ) : null}
      <FormWithSummary
        summary={
          <SummaryCard
            kicker={visibility === 'all' ? 'Who can see it' : 'Invited'}
            lines={(visibility === 'all' ? fitting : withoutClosed(tutors.data).filter((t) => invited.includes(t.id))).map((t) => ({
              k: t.fullName,
              v: t.subjects.slice(0, 3).join(', ') || '–',
            }))}
            note={visibility === 'all' ? 'Tutors who teach the subject are listed. Every tutor can see the role.' : 'Only the tutors you invite can see the role.'}
          />
        }>
        <FieldsCard title="The role">
          <Field label="Title" value={title} onChangeText={setTitle} placeholder="For example, Year 10 IGCSE Chemistry — Tuesdays" error={tried && !title.trim()} />
          <Field
            label="About the student (shared with tutors)"
            value={description}
            onChangeText={setDescription}
            multiline
            placeholder="Level, goals, what they find hard. Please do not include family contact details."
          />
          <CataloguePicker label="Subject" options={SUBJECTS} value={subject} onChange={setSubject} optional collapsed={10} />
          <CataloguePicker label="Phase" options={PHASES} value={phase} onChange={setPhase} optional />
          <CataloguePicker label="Curriculum" options={CURRICULA} value={curriculum} onChange={setCurriculum} optional collapsed={8} />
        </FieldsCard>
        <FieldsCard title="Times, place and pay">
          <Field label="When" value={schedule} onChangeText={setSchedule} placeholder="Tuesdays 5pm" />
          <Field label="Where" value={location} onChangeText={setLocation} placeholder="Online / Al Barsha" />
          <Field label="Tutor pay (AED/hour)" value={pay} onChangeText={setPay} keyboardType="decimal-pad" error={tried && payInvalid ? 'Please enter the hourly pay.' : undefined} />
          <Field label="Closes on" value={closesOn} onChangeText={setClosesOn} placeholder="YYYY-MM-DD" error={tried && closesInvalid ? 'Please write the date as YYYY-MM-DD.' : undefined} />
        </FieldsCard>
        <FieldsCard title="Who can see it">
          <ChipField
            options={[
              { value: 'all', label: 'All tutors' },
              { value: 'invited', label: 'Selected tutors' },
            ]}
            value={visibility}
            onChange={setVisibility}
          />
          {visibility === 'invited' ? (
            <ChipField
              label="Invite"
              options={withoutClosed(tutors.data).map((t) => ({ value: t.id, label: t.fullName }))}
              value={invited}
              onChange={(id) => setInvited((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))}
              error={tried && invited.length === 0 ? 'Please choose at least one tutor.' : undefined}
            />
          ) : null}
          <Txt variant="small">Tutors get a notification and an email when you post.</Txt>
        </FieldsCard>
      </FormWithSummary>
      <ErrorNote error={save.error} />
      <Actions>
        <Button title={existing ? 'Save changes' : 'Post role to tutors'} icon="send" loading={save.isPending} onPress={() => void submit().catch(() => undefined)} />
        <Button title="Cancel" variant="secondary" onPress={back} />
      </Actions>
    </Screen>
  );
}
