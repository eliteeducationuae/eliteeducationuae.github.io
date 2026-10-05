import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { modernCurriculum } from '@/components/catalogue-choice';
import { CataloguePicker } from '@/components/catalogue-picker';
import { opportunityTitle } from '@/components/opportunities';
import { Button, Chip, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
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

  return (
    <Screen
      footer={
        <Button
          title={existing ? 'Save changes' : 'Post role to tutors'}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!valid}
          loading={save.isPending}
          onPress={async () => {
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
          }}
        />
      }>
      <Stack.Screen options={{ title: existing ? 'Edit role' : 'Post a role' }} />
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="For example, Year 10 IGCSE Chemistry — Tuesdays" />
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
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="When" value={schedule} onChangeText={setSchedule} placeholder="Tuesdays 5pm" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Where" value={location} onChangeText={setLocation} placeholder="Online / Al Barsha" />
        </View>
      </Row>
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="Tutor pay (AED/hour)" value={pay} onChangeText={setPay} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Closes on" value={closesOn} onChangeText={setClosesOn} placeholder="YYYY-MM-DD" />
        </View>
      </Row>
      <Section title="Who can see it">
        <Segmented
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: 'all', label: 'All tutors' },
            { value: 'invited', label: 'Selected tutors' },
          ]}
        />
        {visibility === 'invited' ? (
          <Row gap={Spacing.one} wrap>
            {withoutClosed(tutors.data).map((t) => (
              <Chip key={t.id} label={t.fullName} selected={invited.includes(t.id)} onPress={() => setInvited((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))} />
            ))}
          </Row>
        ) : null}
        <Txt variant="small">Tutors get a notification and an email when you post.</Txt>
      </Section>
      <ErrorNote error={save.error} />
    </Screen>
  );
}
