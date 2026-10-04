import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { builtInSyllabusesFor } from '@/data/curriculum';
import { CURRICULA, EXAM_BOARDS, LEVELS, SUBJECTS } from '@/domain/catalogue';
import { enrolmentTitle, tutorTeaches, type EnrolmentDraft } from '@/domain/enrolments';
import type { Tutor } from '@/domain/types';

import { CataloguePicker } from './catalogue-picker';
import { Button, Card, Chip, Row, Txt } from './ui';

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

/**
 * The list of subjects a student studies: subject, curriculum, level, exam board and (for staff) the tutor.
 * Omit `tutors` for families, which hides the tutor choice.
 */
export function EnrolmentEditor({
  value,
  onChange,
  tutors,
}: {
  value: EnrolmentDraft[];
  onChange: (v: EnrolmentDraft[]) => void;
  tutors?: Tutor[];
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
  onChange,
  onRemove,
}: {
  draft: EnrolmentDraft;
  number: number;
  tutors?: Tutor[];
  onChange: (patch: Partial<EnrolmentDraft>) => void;
  onRemove: () => void;
}) {
  const subject = draft.subject.trim();
  const lists = subject ? builtInSyllabusesFor(subject, draft.curriculum) : [];
  const title = subject ? enrolmentTitle({ ...draft, subject }) : 'New subject';

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
        otherPlaceholder="Name the subject"
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
        options={LEVELS}
        value={draft.level}
        onChange={(v) => onChange({ level: v })}
        otherPlaceholder="For example Year 10 or Grade 8"
        optional
        collapsed={8}
      />
      <CataloguePicker label="Exam board" options={EXAM_BOARDS} value={draft.examBoard} onChange={(v) => onChange({ examBoard: v })} optional collapsed={6} />

      {tutors ? (
        <View style={{ gap: Spacing.one }}>
          <Txt variant="label">Tutor</Txt>
          <Row wrap>
            <Chip label="Not yet assigned" selected={!draft.tutorId} onPress={() => onChange({ tutorId: undefined })} />
            {orderTutorsForSubject(tutors, subject).map(({ tutor, teaches }) => (
              <View key={tutor.id} style={{ gap: 2 }}>
                <Chip label={tutor.fullName} selected={draft.tutorId === tutor.id} onPress={() => onChange({ tutorId: tutor.id })} />
                {teaches ? (
                  <Txt variant="small" style={{ paddingLeft: Spacing.two }}>
                    Teaches {subject}
                  </Txt>
                ) : null}
              </View>
            ))}
          </Row>
        </View>
      ) : null}

      {lists.length ? (
        <View style={{ gap: Spacing.one }}>
          <Txt variant="label">Topic list</Txt>
          <Row wrap>
            {lists.map((s) => (
              <Chip key={s.id} label={s.name} selected={draft.syllabusId === s.id} onPress={() => onChange({ syllabusId: s.id })} />
            ))}
            <Chip label="Build as we teach" selected={!draft.syllabusId} onPress={() => onChange({ syllabusId: undefined })} />
          </Row>
        </View>
      ) : null}

      <Row style={{ justifyContent: 'flex-end' }}>
        <Button title="Remove subject" variant="ghost" size="sm" onPress={onRemove} />
      </Row>
    </Card>
  );
}
