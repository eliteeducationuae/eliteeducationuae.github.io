import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { CatalogueMultiPicker } from '@/components/catalogue-picker';
import { HistorySection } from '@/components/history';
import { LoginHint } from '@/components/login-hint';
import { TutorChecksSummary } from '@/components/vetting';
import { TUTOR_COLORS } from '@/lib/tutor-colors';
import { Banner, Button, ErrorNote, Field, ListItem, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { ViewAsActions } from '@/components/view-as';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useLessons, useLookup, useTutors } from '@/data/hooks';
import { CURRICULA, inCatalogue, PHASES, SUBJECTS } from '@/domain/catalogue';
import { isClosed } from '@/domain/closed-accounts';
import { addDays, formatDate, formatDay, formatTime } from '@/domain/dates';
import type { Tutor } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

export default function EditTutor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const tutors = useTutors();
  if (tutors.isLoading) return <Loading />;
  const existing = id ? tutors.data?.find((t) => t.id === id) : undefined;
  if (existing && isClosed(existing)) return <ClosedTutor tutor={existing} />;
  return <TutorForm key={existing?.id ?? 'new'} existing={existing} />;
}

/**
 * A closed tutor is kept only for past lessons and pay records: nothing to edit and no login to send. Their upcoming
 * lessons are listed so the office can open each one and reassign it.
 */
function ClosedTutor({ tutor }: { tutor: Tutor }) {
  const [range] = useState(() => {
    const from = new Date();
    return { from, to: addDays(from, 366) };
  });
  const lessons = useLessons(range.from, range.to);
  const lookup = useLookup();
  const upcoming = (lessons.data ?? [])
    .filter((l) => l.tutorId === tutor.id && l.status === 'scheduled')
    .sort((a, b) => a.start.localeCompare(b.start));
  const count = upcoming.length;
  return (
    <Screen>
      <Stack.Screen options={{ title: tutor.fullName }} />
      <Banner icon="person">
        {`This tutor’s account was closed on ${formatDate(tutor.deletedAt!)}. Their name, contact details, availability and bank details have been removed. Past lessons and pay records are kept.`}
      </Banner>
      {lessons.isLoading ? (
        <Loading />
      ) : (
        <Section title="Upcoming lessons">
          {count ? (
            <View style={{ gap: Spacing.two }}>
              <Banner tone="warning" icon="calendar">
                {`${count} upcoming ${count === 1 ? 'lesson needs' : 'lessons need'} another tutor. Open each lesson to reassign it.`}
              </Banner>
              {upcoming.map((l) => (
                <ListItem
                  key={l.id}
                  title={`${formatDay(l.start)} at ${formatTime(l.start)}`}
                  subtitle={[l.subject, l.studentIds.map((id) => lookup.student(id)?.fullName).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                  onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: l.id } })}
                />
              ))}
            </View>
          ) : (
            <Txt variant="muted">No upcoming lessons need another tutor.</Txt>
          )}
        </Section>
      )}
    </Screen>
  );
}

function TutorForm({ existing }: { existing?: Tutor }) {
  const theme = useTheme();
  const save = useAction(source.saveTutor);
  const [fullName, setFullName] = useState(existing?.fullName ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [pay, setPay] = useState(existing ? String(existing.hourlyPay) : '');
  // Before round 4 'subjects' held curricula ('IB', 'IGCSE'); show any such legacy values under Curricula.
  const legacy = !existing?.curricula?.length ? (existing?.subjects ?? []).filter((v) => v === 'IB' || (inCatalogue(CURRICULA, v) && !inCatalogue(SUBJECTS, v))) : [];
  const [subjects, setSubjects] = useState<string[]>((existing?.subjects ?? []).filter((v) => !legacy.includes(v)));
  const [curricula, setCurricula] = useState<string[]>(existing?.curricula?.length ? existing.curricula : legacy.map((v) => (v === 'IB' ? 'IB DP' : v)));
  const [phases, setPhases] = useState<string[]>(existing?.phases ?? []);
  const [color, setColor] = useState(existing?.color ?? TUTOR_COLORS[0]);
  const valid = fullName.trim() && /\S+@\S+/.test(email) && Number(pay) >= 0 && pay !== '';

  return (
    <Screen
      footer={
        <Button
          title={existing ? 'Save changes' : 'Add tutor'}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!valid}
          loading={save.isPending}
          onPress={async () => {
            await save.mutateAsync([
              {
                id: existing?.id,
                fullName: fullName.trim(),
                email: email.trim(),
                phone: phone.trim() || undefined,
                hourlyPay: Number(pay),
                subjects,
                curricula,
                phases,
                color,
              },
            ]);
            router.back();
          }}
        />
      }>
      <Stack.Screen options={{ title: existing ? 'Edit tutor' : 'New tutor' }} />
      <Field label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <LoginHint email={email} who="tutor" name={fullName} />
      {existing ? (
        <Button
          title="Availability and time off"
          icon="clock"
          variant="secondary"
          onPress={() => router.push({ pathname: '/availability', params: { tutorId: existing.id } })}
        />
      ) : null}
      {existing ? <TutorChecksSummary tutorId={existing.id} /> : null}
      <Field label="Pay per hour (AED)" value={pay} onChangeText={setPay} keyboardType="decimal-pad" />
      <Section title="Teaches">
        <View style={{ gap: Spacing.three }}>
          <CatalogueMultiPicker label="Subjects" options={SUBJECTS} values={subjects} onChange={setSubjects} collapsed={12} otherPlaceholder="For example, Latin" />
          <CatalogueMultiPicker label="Curricula" options={CURRICULA} values={curricula} onChange={setCurricula} />
          <CatalogueMultiPicker label="Phases" options={PHASES} values={phases} onChange={setPhases} />
        </View>
      </Section>
      <Section title="Calendar colour">
        <Row gap={Spacing.two} wrap>
          {TUTOR_COLORS.map((c) => (
            <Pressable key={c} onPress={() => setColor(c)} accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected: color === c }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c, borderWidth: 3, borderColor: color === c ? theme.text : 'transparent' }} />
            </Pressable>
          ))}
        </Row>
      </Section>
      <ErrorNote error={save.error} />
      {existing ? <ViewAsActions tutorId={existing.id} /> : null}
      {existing ? <HistorySection filter={{ tutorId: existing.id }} /> : null}
    </Screen>
  );
}
