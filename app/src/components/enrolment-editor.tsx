import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { builtInSyllabusesFor, courseStillFits, enrolmentFieldsFor } from '@/data/curriculum';
import { CURRICULA, EXAM_BOARDS, levelsFor, SUBJECTS } from '@/domain/catalogue';
import { enrolmentTitle, tutorChoicePatch, tutorTeaches, type EnrolmentDraft } from '@/domain/enrolments';
import { enrolmentGivesNewStudent } from '@/domain/vetting';
import { familyPricePlaceholder, parseRate, serviceForEnrolment, tutorPayPlaceholder } from '@/domain/rates';
import { formatAED } from '@/domain/money';
import type { Enrolment, Service, Student, Tutor, TutorCompliance } from '@/domain/types';

import { CataloguePicker } from './catalogue-picker';
import { RateField, rateFieldError, rateFieldText } from './rates';
import { Banner, Button, Card, Chip, Row, Txt } from './ui';
import { tutorChipLabel, VettingWarning } from './vetting';

/** Tutors who teach the subject first, then everyone else, each group in name order. */
export function orderTutorsForSubject(tutors: Tutor[], subject?: string): { tutor: Tutor; teaches: boolean }[] {
  return tutors
    .map((tutor) => ({ tutor, teaches: !!subject && tutorTeaches(tutor, subject) }))
    .sort((a, b) => Number(b.teaches) - Number(a.teaches) || a.tutor.fullName.localeCompare(b.tutor.fullName));
}

/** Removing a saved subject keeps the row (inactive) so the server can retire it; an unsaved row simply goes. */
export function removeDraft(drafts: EnrolmentDraft[], index: number): EnrolmentDraft[] {
  const d = drafts[index];
  if (!d) return drafts;
  if (d.id) return drafts.map((x, i) => (i === index ? { ...x, active: false } : x));
  return drafts.filter((_, i) => i !== index);
}

export function emptyDraft(): EnrolmentDraft {
  return { subject: '', active: true };
}

/** Optional rate fields under the tutor choice; only the admin student editor passes them. */
export interface EnrolmentRatesOptions {
  services: Service[];
  student?: Pick<Student, 'phase'>;
  /** The saved enrolments, so choosing the saved tutor again restores their agreed pay. */
  saved?: Pick<Enrolment, 'id' | 'tutorId' | 'tutorPay'>[];
}

/**
 * The list of subjects a student studies: subject, curriculum, level, exam board and (for staff) the tutor.
 * Omit `tutors` for families, which hides the tutor choice. `forFamily` words the built-in topic lists as
 * courses and drops the staff-only 'Build as we teach' choice. `rates` (admins only) adds the custom tutor pay
 * and family price per hour for each subject. `vetting` (staff) marks tutors whose checks are incomplete and warns
 * under a subject when one is newly chosen, before anything is saved.
 */
export function EnrolmentEditor({
  value,
  onChange,
  tutors,
  forFamily,
  rates,
  vetting,
}: {
  value: EnrolmentDraft[];
  onChange: (v: EnrolmentDraft[]) => void;
  tutors?: Tutor[];
  forFamily?: boolean;
  rates?: EnrolmentRatesOptions;
  vetting?: Map<string, TutorCompliance>;
}) {
  const update = (index: number, patch: Partial<EnrolmentDraft>) => onChange(value.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const visible = value.map((d, index) => ({ d, index })).filter(({ d }) => d.active);

  return (
    <View style={{ gap: Spacing.three }}>
      {visible.map(({ d, index }, n) => (
        <SubjectCard
          key={d.id ?? `new-${index}`}
          draft={d}
          number={n + 1}
          tutors={tutors}
          forFamily={forFamily}
          rates={rates}
          vetting={vetting}
          onChange={(patch) => update(index, patch)}
          onRemove={() => onChange(removeDraft(value, index))}
        />
      ))}
      {!visible.length ? <Txt variant="muted">No subjects have been added yet.</Txt> : null}
      <Button title="+ Add a subject" variant="outline" onPress={() => onChange([...value, emptyDraft()])} />
    </View>
  );
}

function SubjectCard({
  draft,
  number,
  tutors,
  forFamily,
  rates,
  vetting,
  onChange,
  onRemove,
}: {
  draft: EnrolmentDraft;
  number: number;
  tutors?: Tutor[];
  forFamily?: boolean;
  rates?: EnrolmentRatesOptions;
  vetting?: Map<string, TutorCompliance>;
  onChange: (patch: Partial<EnrolmentDraft>) => void;
  onRemove: () => void;
}) {
  const subject = draft.subject.trim();
  const lists = subject ? builtInSyllabusesFor(subject, draft.curriculum) : [];
  const title = subject ? enrolmentTitle({ ...draft, subject }) : 'New subject';
  const ordered = tutors ? orderTutorsForSubject(tutors, subject) : [];
  const saved = draft.id ? rates?.saved?.find((e) => e.id === draft.id) : undefined;
  const choose = (tutorId?: string) => onChange(tutorChoicePatch(draft, tutorId, saved));
  // Warn before saving that a different tutor does not inherit the pay agreed with the saved tutor.
  const savedTutor = saved?.tutorId ? tutors?.find((t) => t.id === saved.tutorId) : undefined;
  const lostPay =
    saved?.tutorId && typeof saved.tutorPay === 'number' && draft.tutorId !== saved.tutorId
      ? `Changing the tutor removes the custom pay of ${formatAED(saved.tutorPay)} per hour agreed with ${savedTutor?.fullName ?? 'the previous tutor'}.`
      : undefined;

  return (
    <Card style={{ gap: Spacing.three }}>
      <View style={{ gap: Spacing.half }}>
        <Txt variant="label">Subject {number}</Txt>
        <Txt variant="h3">{title}</Txt>
      </View>
      <CataloguePicker
        label="Subject"
        options={SUBJECTS}
        value={draft.subject || undefined}
        onChange={(v) => {
          const next = v ?? '';
          // A built-in topic list only fits the subject it was chosen for.
          const keepList = next && draft.syllabusId && builtInSyllabusesFor(next, draft.curriculum).some((s) => s.id === draft.syllabusId);
          onChange({ subject: next, syllabusId: keepList ? draft.syllabusId : undefined });
        }}
        otherPlaceholder="For example, Latin"
        collapsed={10}
      />
      <CataloguePicker
        label="Curriculum"
        options={CURRICULA}
        value={draft.curriculum}
        onChange={(v) => {
          const keepList = draft.syllabusId && builtInSyllabusesFor(subject, v).some((s) => s.id === draft.syllabusId);
          onChange({ curriculum: v, syllabusId: keepList ? draft.syllabusId : undefined });
        }}
        optional
        collapsed={8}
      />
      <CataloguePicker
        label="Level"
        options={levelsFor(draft.curriculum, draft.level)}
        value={draft.level}
        onChange={(v) => onChange({ level: v, syllabusId: courseStillFits(draft, { level: v }) })}
        otherPlaceholder="For example, Year 10 or Grade 8"
        optional
        collapsed={8}
      />
      <CataloguePicker
        label="Exam board"
        options={EXAM_BOARDS}
        value={draft.examBoard}
        onChange={(v) => onChange({ examBoard: v, syllabusId: courseStillFits(draft, { examBoard: v }) })}
        optional
        collapsed={6}
      />

      {tutors ? (
        <View style={{ gap: Spacing.one }}>
          <Txt variant="label">Tutor</Txt>
          <Row wrap>
            <Chip label="Not yet assigned" selected={!draft.tutorId} onPress={() => choose(undefined)} />
            {ordered.map(({ tutor, teaches }) => (
              <Chip
                key={tutor.id}
                label={tutorChipLabel(teaches ? `${tutor.fullName} ✓` : tutor.fullName, vetting?.get(tutor.id))}
                selected={draft.tutorId === tutor.id}
                // Custom pay belongs to the student, subject and tutor together, so a new tutor starts at their usual rate.
                onPress={() => choose(tutor.id)}
              />
            ))}
          </Row>
          {subject && ordered.some((t) => t.teaches) ? <Txt variant="small">✓ Teaches {subject}</Txt> : null}
          {vetting && draft.tutorId && enrolmentGivesNewStudent(draft, rates?.saved ?? []) ? (
            // The same warning as the lesson form, shown as soon as the tutor is chosen rather than after Save.
            <VettingWarning key={draft.tutorId} tutorId={draft.tutorId} action="enrolment" checksLink />
          ) : null}
          {rates && lostPay ? (
            <Banner tone="warning" icon="alert">
              {lostPay}
            </Banner>
          ) : null}
        </View>
      ) : null}

      {rates && tutors ? (
        <SubjectRates
          draft={draft}
          tutor={draft.tutorId ? tutors.find((t) => t.id === draft.tutorId) : undefined}
          service={serviceForEnrolment(rates.services, draft, rates.student)}
          onChange={onChange}
        />
      ) : null}

      {lists.length ? (
        <View style={{ gap: Spacing.one }}>
          <Txt variant="label">{forFamily ? 'Course (optional)' : 'Topic list'}</Txt>
          {forFamily ? <Txt variant="small">If you know the course your child follows, please choose it. Otherwise, we will confirm it with you.</Txt> : null}
          <Row wrap>
            {lists.map((s) => (
              <Chip
                key={s.id}
                label={s.name}
                selected={draft.syllabusId === s.id}
                // Choosing a built-in list also sets its curriculum, level and exam board, so the enrolment shares
                // its topics with every other student on the same course.
                onPress={() => onChange(draft.syllabusId === s.id && forFamily ? { syllabusId: undefined } : enrolmentFieldsFor(s, subject))}
              />
            ))}
            <Chip label={forFamily ? 'Not sure' : 'Build as we teach'} selected={!draft.syllabusId} onPress={() => onChange({ syllabusId: undefined })} />
          </Row>
        </View>
      ) : null}

      <Row style={{ justifyContent: 'flex-end' }}>
        <Button title="Remove subject" variant="ghost" size="sm" onPress={onRemove} />
      </Row>
    </Card>
  );
}

/**
 * A rate field holding text that is not a valid amount is stored as NaN, so the form can refuse to save it
 * (and the problem disappears with the subject if it is removed). Only the admin student editor sees this.
 */
export function draftRatesInvalid(d: Pick<EnrolmentDraft, 'tutorPay' | 'familyPrice'>): boolean {
  return Number.isNaN(d.tutorPay) || Number.isNaN(d.familyPrice);
}

const isSet = (n?: number) => typeof n === 'number' && !Number.isNaN(n);

function SubjectRates({
  draft,
  tutor,
  service,
  onChange,
}: {
  draft: EnrolmentDraft;
  tutor?: Tutor;
  service?: Service;
  onChange: (patch: Partial<EnrolmentDraft>) => void;
}) {
  // The raw text is kept locally so that typing '1' and then '.' is not rewritten while the amount is half-typed.
  const [price, setPrice] = useState(() => rateFieldText(draft.familyPrice));

  return (
    <View style={{ gap: Spacing.three }}>
      <TutorPayField
        // Only the pay field remounts when the tutor changes, so its text follows the cleared or restored pay while
        // the family price keeps whatever was typed.
        key={draft.tutorId ?? 'none'}
        tutorPay={draft.tutorPay}
        tutor={tutor}
        onChange={(tutorPay) => onChange({ tutorPay })}
      />
      <RateField
        label="Family price per hour"
        value={price}
        placeholder={familyPricePlaceholder(service)}
        custom={isSet(draft.familyPrice)}
        error={rateFieldError(price)}
        onChange={(t) => {
          setPrice(t);
          onChange({ familyPrice: storeRate(t) });
        }}
      />
    </View>
  );
}

/** Field text to draft value: blank is undefined (the default applies), text that is not an amount is NaN. */
function storeRate(text: string): number | undefined {
  const r = parseRate(text);
  return r === 'invalid' ? NaN : (r ?? undefined);
}

function TutorPayField({ tutorPay, tutor, onChange }: { tutorPay?: number; tutor?: Tutor; onChange: (pay: number | undefined) => void }) {
  const [pay, setPay] = useState(() => rateFieldText(tutorPay));
  return (
    <RateField
      label="Tutor pay per hour"
      value={pay}
      placeholder={tutorPayPlaceholder(tutor)}
      disabled={!tutor}
      custom={isSet(tutorPay)}
      error={rateFieldError(pay)}
      onChange={(t) => {
        setPay(t);
        onChange(storeRate(t));
      }}
    />
  );
}
