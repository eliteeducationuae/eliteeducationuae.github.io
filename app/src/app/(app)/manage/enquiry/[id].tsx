import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ENQUIRY_STATUS } from '@/components/enquiries';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { SYLLABUSES } from '@/data/curriculum';
import { source } from '@/data';
import { useAction, useEnquiries, useFamilies, useStudents } from '@/data/hooks';
import { addDays, formatDate, relativeDay, toDateKey } from '@/domain/dates';
import type { Curriculum, Enquiry, EnquiryStatus } from '@/domain/types';

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
        {e.studentName || e.curriculum ? <Txt>{[e.studentName, e.curriculum, e.yearGroup].filter(Boolean).join(' · ')}</Txt> : null}
        {e.preferredTimes ? <Txt variant="muted">Best times: {e.preferredTimes}</Txt> : null}
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
              <Field label="Why lost?" value={lostReason} onChangeText={setLostReason} placeholder="e.g. Price, timing, chose another tutor" />
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

/** Turn an enquiry into a family + student so a trial lesson can be booked. */
function ConvertCard({ e }: { e: Enquiry }) {
  const saveFamily = useAction(source.saveFamily);
  const saveStudent = useAction(source.saveStudent);
  const update = useAction(source.updateEnquiry);
  const families = useFamilies();
  const [studentName, setStudentName] = useState(e.studentName ?? '');
  const curriculum = (['IB', 'IGCSE', 'A-Level'] as Curriculum[]).includes(e.curriculum as Curriculum) ? (e.curriculum as Curriculum) : 'IGCSE';
  const [syllabusId, setSyllabusId] = useState(SYLLABUSES.find((s) => s.curriculum === curriculum)?.id ?? '');
  const existing = e.familyId ? families.data?.find((f) => f.id === e.familyId) : undefined;
  const lastName = e.parentName.trim().split(' ').pop() ?? e.parentName;

  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">Add as a family</Txt>
      <Txt variant="muted">
        {existing ? `Adds the student to the ${existing.name} family` : `Creates the ${lastName} family and the student`} so you can book a trial lesson.
        {e.email ? ' They’ll be able to sign up with the same email.' : ''}
      </Txt>
      <Field label="Student’s full name" value={studentName} onChangeText={setStudentName} autoCapitalize="words" placeholder={`e.g. ${e.studentName ?? 'Zara'} ${lastName}`} />
      <Row gap={Spacing.one} wrap>
        {SYLLABUSES.filter((s) => s.curriculum === curriculum).map((s) => (
          <Chip key={s.id} label={s.name} selected={syllabusId === s.id} onPress={() => setSyllabusId(s.id)} />
        ))}
      </Row>
      <ErrorNote error={saveFamily.error ?? saveStudent.error} />
      <Button
        title="Create family & student"
        variant="gold"
        disabled={!studentName.trim() || !syllabusId}
        loading={saveFamily.isPending || saveStudent.isPending}
        onPress={async () => {
          const family =
            existing ??
            (await saveFamily.mutateAsync([{ name: lastName, parentName: e.parentName, email: e.email ?? '', phone: e.phone, status: 'prospect' }]));
          const student = await saveStudent.mutateAsync([
            { familyId: family.id, fullName: studentName.trim(), curriculum, syllabusId, yearGroup: e.yearGroup },
          ]);
          await update.mutateAsync([e.id, { familyId: family.id, studentId: student.id, status: e.status === 'new' ? 'contacted' : e.status }]);
        }}
      />
    </Card>
  );
}
