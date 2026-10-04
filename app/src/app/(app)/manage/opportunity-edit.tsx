import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Chip, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { getSyllabus } from '@/data/curriculum';
import { source } from '@/data';
import { useAction, useEnquiries, useOpportunities, useStudents, useTutors } from '@/data/hooks';
import { addDays, toDateKey } from '@/domain/dates';
import type { Opportunity } from '@/domain/types';

/** Post (or edit) a role. Prefills from `?enquiryId=` or `?studentId=`. */
export default function EditOpportunity() {
  const params = useLocalSearchParams<{ id?: string; enquiryId?: string; studentId?: string }>();
  const opportunities = useOpportunities();
  const enquiries = useEnquiries();
  const students = useStudents();
  if (opportunities.isLoading || enquiries.isLoading || students.isLoading) return <Loading />;
  const existing = params.id ? opportunities.data?.find((o) => o.id === params.id) : undefined;
  const enquiry = params.enquiryId ? enquiries.data?.find((e) => e.id === params.enquiryId) : undefined;
  const student = params.studentId ? students.data?.find((s) => s.id === params.studentId) : undefined;
  const defaults: Partial<Opportunity> = existing ?? {
    title: student
      ? `${student.yearGroup ? `${student.yearGroup} ` : ''}${getSyllabus(student.syllabusId)?.name ?? student.curriculum} — ${student.fullName.split(' ')[0]}`
      : enquiry
        ? `${enquiry.yearGroup ? `${enquiry.yearGroup} ` : ''}${enquiry.curriculum ?? 'Maths'} — ${enquiry.studentName ?? 'new student'}`
        : '',
    description: enquiry?.message ?? (student ? `Current grade ${student.currentGrade ?? '–'}, target ${student.targetGrade ?? '–'}.` : ''),
    curriculum: student?.curriculum ?? enquiry?.curriculum,
    syllabusId: student?.syllabusId,
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
  const [curriculum, setCurriculum] = useState(defaults.curriculum ?? '');
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
                curriculum: curriculum || undefined,
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
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Year 12 IB AA HL — Tuesdays" />
      <Field
        label="About the student (shared with tutors)"
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="Level, goals, what they find hard. Don’t include family contact details."
      />
      <Section title="Curriculum">
        <Row gap={Spacing.one} wrap>
          {['IB', 'IGCSE', 'A-Level'].map((c) => (
            <Chip key={c} label={c} selected={curriculum === c} onPress={() => setCurriculum(curriculum === c ? '' : c)} />
          ))}
        </Row>
      </Section>
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
            {(tutors.data ?? []).map((t) => (
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
