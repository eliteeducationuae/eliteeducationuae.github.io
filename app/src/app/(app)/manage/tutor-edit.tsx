import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { FormWithSummary, NoHeader, SummaryCard } from '@/components/admin-people/kit';
import { CatalogueMultiPicker } from '@/components/catalogue-picker';
import { LoginHint } from '@/components/login-hint';
import { Actions, Button, ErrorNote, Field, FieldsCard, Loading, Notice, PageHeader, Screen, Txt, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useTutors, useVettingEnforced } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { CURRICULA, inCatalogue, PHASES, SUBJECTS } from '@/domain/catalogue';
import { isClosed } from '@/domain/closed-accounts';
import type { Tutor } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { TUTOR_COLORS } from '@/lib/tutor-colors';

/**
 * Add a tutor, or edit one tutor's profile, subjects, pay and colour (`?id=…&edit=1`). Everything else about a tutor
 * (checks, availability, View as, calendar link, history) is on their page, `/manage/tutor/[id]`; an old link to this
 * form without `edit` opens that page.
 */
export default function EditTutor() {
  const { id, edit } = useLocalSearchParams<{ id?: string; edit?: string }>();
  const tutors = useTutors();
  if (id && !edit) return <Redirect href={{ pathname: '/manage/tutor/[id]', params: { id } }} />;
  if (tutors.isLoading) return <Loading />;
  const existing = id ? tutors.data?.find((t) => t.id === id) : undefined;
  // A closed tutor has nothing to edit; their page lists the lessons to reassign.
  if (existing && isClosed(existing)) return <Redirect href={{ pathname: '/manage/tutor/[id]', params: { id: existing.id } }} />;
  return <TutorForm key={existing?.id ?? 'new'} existing={existing} />;
}

function TutorForm({ existing }: { existing?: Tutor }) {
  const theme = useTheme();
  const toast = useToast();
  const save = useAction(source.saveTutor);
  const enforced = useVettingEnforced();
  const [tried, setTried] = useState(false);
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
  const emailInvalid = !/\S+@\S+/.test(email);
  const payInvalid = pay.trim() === '' || !(Number(pay) >= 0);
  const valid = !!fullName.trim() && !emailInvalid && !payInvalid;
  const newPay = Number(pay) || 0;
  const back = () => (router.canGoBack() ? router.back() : router.replace(existing ? { pathname: '/manage/tutor/[id]', params: { id: existing.id } } : '/manage/tutors'));

  async function submit() {
    setTried(true);
    if (!valid) return;
    const saved = await save.mutateAsync([
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
    if (existing) {
      back();
      toast(`${saved.fullName.split(' ')[0]}’s profile is saved.`);
    } else {
      router.replace({ pathname: '/manage/tutor/[id]', params: { id: saved.id } });
      toast(`${saved.fullName} is added. Their onboarding checks have started.`);
    }
  }

  const summary = existing ? (
    <SummaryCard
      kicker="Change summary"
      title={existing.fullName}
      lines={[
        { k: 'Hourly pay', v: !payInvalid && newPay !== existing.hourlyPay ? `${formatAED(existing.hourlyPay ?? 0)} → ${formatAED(newPay)}` : formatAED(existing.hourlyPay ?? 0) },
        { k: 'Subjects', v: subjects.join(', ') || '–' },
      ]}
      note={
        !payInvalid && newPay !== existing.hourlyPay
          ? 'The change is recorded in the tutor’s history and the activity log.'
          : 'Families are charged from Services and rates; this is what the tutor is paid.'
      }
    />
  ) : (
    <SummaryCard
      kicker="Before a first lesson"
      lines={[
        { k: 'Police clearance', v: enforced.data ? 'Required' : 'Not enforced' },
        { k: 'Bank details', v: 'Added by the tutor' },
        { k: 'Availability', v: 'Set by the tutor' },
        { k: 'Tutor handbook', v: 'To acknowledge' },
      ]}
      note="Track progress in Tutor checks. They sign up in the app with this email address."
    />
  );

  return (
    <Screen topInset>
      <NoHeader title={existing ? 'Edit tutor' : 'New tutor'} />
      <PageHeader
        back={{ label: 'Cancel', onPress: back }}
        kicker={existing ? 'Team · Edit' : 'Team · New'}
        title={existing ? existing.fullName : 'Add a tutor'}
        sub={existing ? 'Profile, subjects and pay. Changes to pay are recorded in the activity log.' : 'They create their account in the app and are asked to complete onboarding.'}
      />
      {tried && !valid ? (
        <Notice tone="danger" title="Not saved yet">
          A few details are missing. They are marked below.
        </Notice>
      ) : null}
      <FormWithSummary summary={summary}>
        <FieldsCard title="Profile">
          <Field label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" placeholder="For example, Leila Karimi" error={tried && !fullName.trim()} />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="name@example.com"
            error={tried && emailInvalid ? (email.trim() ? 'Please enter a full email address.' : true) : undefined}
          />
          <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+971 50 000 0000" />
          <LoginHint email={email} who="tutor" name={fullName} />
        </FieldsCard>
        <FieldsCard title="Teaching">
          <CatalogueMultiPicker label="Subjects" options={SUBJECTS} values={subjects} onChange={setSubjects} collapsed={12} otherPlaceholder="For example, Latin" />
          <CatalogueMultiPicker label="Curricula" options={CURRICULA} values={curricula} onChange={setCurricula} />
          <CatalogueMultiPicker label="Phases" options={PHASES} values={phases} onChange={setPhases} />
        </FieldsCard>
        <FieldsCard title="Pay and colour">
          <Field
            label="Pay per hour (AED)"
            value={pay}
            onChangeText={setPay}
            keyboardType="decimal-pad"
            placeholder="For example, 175"
            hint="Families are charged from Services and rates; this is what the tutor is paid."
            error={tried && payInvalid}
          />
          <View style={{ gap: 8 }}>
            <Txt variant="label">Calendar colour</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {TUTOR_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  accessibilityRole="button"
                  accessibilityLabel={`Colour ${c}`}
                  accessibilityState={{ selected: color === c }}
                  hitSlop={4}
                  style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c, borderWidth: 3, borderColor: color === c ? theme.gold : 'transparent' }} />
                </Pressable>
              ))}
            </View>
            <Txt variant="small">Used in the calendar and on lesson cards.</Txt>
          </View>
        </FieldsCard>
      </FormWithSummary>
      <ErrorNote error={save.error} />
      <Actions>
        <Button title={existing ? 'Save changes' : 'Add tutor'} icon="check" loading={save.isPending} onPress={() => void submit().catch(() => undefined)} />
        <Button title="Cancel" variant="secondary" onPress={back} />
      </Actions>
    </Screen>
  );
}
