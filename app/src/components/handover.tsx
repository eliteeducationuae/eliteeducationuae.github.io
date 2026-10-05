import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/icon';
import { openAttachment } from '@/components/resources';
import { Badge, Banner, Button, Card, EmptyState, ErrorNote, Field, ListItem, Loading, ProgressBar, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useHandoverPack, useHandovers, useLesson, useLookup, type Lookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatDate, formatDay, formatTime } from '@/domain/dates';
import { HANDOVER_NOTE_LIMIT, HANDOVER_REASON_LABEL, handoverTitle, validateHandoverNote } from '@/domain/handover';
import { dueLabel, resourceAttachment, resourceMeta } from '@/domain/homework';
import { RATING_LABELS } from '@/domain/progress';
import type { Handover } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';

const handoverPath = (id: string) => ({ pathname: '/handover/[id]' as const, params: { id } });

function tutorName(lookup: Lookup, tutorId: string | undefined, fallback = 'the office') {
  return (tutorId && lookup.tutor(tutorId)?.fullName) || fallback;
}

function studentName(lookup: Lookup, studentId: string) {
  return lookup.student(studentId)?.fullName ?? 'Student';
}

/** e.g. 'From James Wilson to Sarah Ahmed'. */
function fromTo(lookup: Lookup, h: Handover) {
  return `From ${tutorName(lookup, h.fromTutorId)} to ${tutorName(lookup, h.toTutorId, 'the new tutor')}`;
}

// ---------------------------------------------------------------------------
// Lesson detail and tutor dashboard
// ---------------------------------------------------------------------------

/** A link to the lesson's handover pack, for admins and the incoming tutor. */
export function HandoverLink({ lessonId }: { lessonId: string }) {
  const me = useMe();
  if (me.role !== 'admin' && me.role !== 'tutor') return null;
  return <HandoverLinkFor lessonId={lessonId} />;
}

function HandoverLinkFor({ lessonId }: { lessonId: string }) {
  const me = useMe();
  const lookup = useLookup();
  const handovers = useHandovers({ lessonId });
  const theme = useTheme();
  const h = (handovers.data ?? []).find((x) => me.role === 'admin' || (!!me.tutorId && x.toTutorId === me.tutorId));
  if (!h) return null;
  return <ListItem title="Handover pack" subtitle={fromTo(lookup, h)} left={<Icon name="book" size={22} color={theme.accent} />} onPress={() => router.push(handoverPath(h.id))} />;
}

/** Reminders on the tutor's Today screen: packs to read, and notes to leave for the next tutor. */
export function HandoverBanners() {
  const me = useMe();
  const lookup = useLookup();
  const handovers = useHandovers();
  if (!me.tutorId || !lookup.ready) return null;
  const list = handovers.data ?? [];
  const toRead = list.filter((h) => h.toTutorId === me.tutorId && !h.viewedAt);
  const toWrite = list.filter((h) => h.fromTutorId === me.tutorId && !h.note?.trim());
  if (!toRead.length && !toWrite.length) return null;
  return (
    <>
      {toRead.map((h) => (
        <Banner key={`read-${h.id}`} icon="book">
          Handover pack ready: {handoverTitle(h, studentName(lookup, h.studentId))}.{' '}
          <Txt variant="muted" color="accent" onPress={() => router.push(handoverPath(h.id))}>
            Open handover pack
          </Txt>
        </Banner>
      ))}
      {toWrite.map((h) => (
        <Banner key={`write-${h.id}`} icon="chat">
          Please leave a handover note for {tutorName(lookup, h.toTutorId, 'the new tutor')} about {studentName(lookup, h.studentId)}.{' '}
          <Txt variant="muted" color="accent" onPress={() => router.push(handoverPath(h.id))}>
            Write handover note
          </Txt>
        </Banner>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Handover packs list
// ---------------------------------------------------------------------------

function HandoverItem({ h, lookup, incoming }: { h: Handover; lookup: Lookup; incoming: boolean }) {
  const theme = useTheme();
  return (
    <ListItem
      title={handoverTitle(h, studentName(lookup, h.studentId))}
      subtitle={`${HANDOVER_REASON_LABEL[h.reason]} · ${tutorName(lookup, h.fromTutorId)} to ${tutorName(lookup, h.toTutorId, 'the new tutor')} · ${formatDate(h.createdAt)}`}
      left={<Icon name="book" size={22} color={theme.accent} />}
      right={incoming && !h.viewedAt ? <Badge label="New" tone="gold" /> : undefined}
      onPress={() => router.push(handoverPath(h.id))}
    />
  );
}

/** Every handover the viewer may see: all for admins; for tutors, packs to read and notes to write. */
export function HandoverList() {
  const me = useMe();
  const lookup = useLookup();
  const handovers = useHandovers();
  if (handovers.isLoading || !lookup.ready) return <Loading />;
  const list = handovers.data ?? [];
  const empty = <EmptyState icon="book" title="No handover packs yet" message="Packs are prepared when a lesson is covered or a student changes tutor." />;

  if (me.role === 'admin') {
    return (
      <Screen onRefresh={() => handovers.refetch()} refreshing={handovers.isRefetching}>
        <ErrorNote error={handovers.error} />
        {list.length ? (
          <Section title={`Handover packs (${list.length})`}>
            {list.map((h) => (
              <HandoverItem key={h.id} h={h} lookup={lookup} incoming={false} />
            ))}
          </Section>
        ) : (
          empty
        )}
      </Screen>
    );
  }

  const forMe = list.filter((h) => !!me.tutorId && h.toTutorId === me.tutorId);
  const fromMe = list.filter((h) => !!me.tutorId && h.fromTutorId === me.tutorId);
  const toWrite = fromMe.filter((h) => !h.note?.trim());
  const written = fromMe.filter((h) => !!h.note?.trim());
  return (
    <Screen onRefresh={() => handovers.refetch()} refreshing={handovers.isRefetching}>
      <ErrorNote error={handovers.error} />
      {!forMe.length && !fromMe.length ? empty : null}
      {forMe.length ? (
        <Section title="Handover packs for you">
          {forMe.map((h) => (
            <HandoverItem key={h.id} h={h} lookup={lookup} incoming />
          ))}
        </Section>
      ) : null}
      {toWrite.length ? (
        <Section title="Notes to write">
          {toWrite.map((h) => (
            <HandoverItem key={h.id} h={h} lookup={lookup} incoming={false} />
          ))}
        </Section>
      ) : null}
      {written.length ? (
        <Section title="Handover notes you have written">
          {written.map((h) => (
            <HandoverItem key={h.id} h={h} lookup={lookup} incoming={false} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One handover
// ---------------------------------------------------------------------------

/** The pack for admins and the incoming tutor; the note editor for the outgoing tutor and admins. */
export function HandoverScreen({ id }: { id: string | undefined }) {
  const me = useMe();
  const lookup = useLookup();
  const handovers = useHandovers();
  if (handovers.isLoading || !lookup.ready) return <Loading />;
  const h = (handovers.data ?? []).find((x) => x.id === id);
  const admin = me.role === 'admin';
  const incoming = !!h && me.role === 'tutor' && !!me.tutorId && h.toTutorId === me.tutorId;
  const outgoing = !!h && me.role === 'tutor' && !!me.tutorId && h.fromTutorId === me.tutorId;
  if (!h || (!admin && !incoming && !outgoing)) {
    return (
      <Screen>
        <EmptyState icon="book" title="Handover pack not found" message="It may have been removed, or it may be for another tutor." />
      </Screen>
    );
  }
  const toName = tutorName(lookup, h.toTutorId, 'the new tutor');

  if (!admin && !incoming) {
    return (
      <Screen>
        <HandoverHeader handover={h} studentName={studentName(lookup, h.studentId)} lookup={lookup} />
        <Banner icon="alert">Only the incoming tutor and the office can see the full handover pack.</Banner>
        <HandoverNoteEditor key={h.noteUpdatedAt ?? 'none'} handover={h} label={`Your handover note for ${toName}`} />
      </Screen>
    );
  }

  return (
    <HandoverPackView
      id={h.id}
      markViewed={incoming && !h.viewedAt}
      footer={admin ? <HandoverNoteEditor key={h.noteUpdatedAt ?? 'none'} handover={h} label={`Handover note for ${toName}`} /> : null}
    />
  );
}

function HandoverHeader({ handover: h, studentName: name, lookup }: { handover: Handover; studentName: string; lookup: Lookup }) {
  return (
    <Card style={{ gap: Spacing.two }}>
      <Txt variant="h2">{name}</Txt>
      <Row gap={Spacing.two} wrap>
        <Badge label={HANDOVER_REASON_LABEL[h.reason]} tone="gold" />
        {h.subject ? <Badge label={h.subject} /> : null}
      </Row>
      <Txt variant="muted">{fromTo(lookup, h)}</Txt>
      {h.lessonId ? <CoveredLessonLink lessonId={h.lessonId} /> : null}
    </Card>
  );
}

function CoveredLessonLink({ lessonId }: { lessonId: string }) {
  const lesson = useLesson(lessonId);
  const start = lesson.data?.start;
  return (
    <Txt color="accent" onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: lessonId } })}>
      {start ? `Covered lesson: ${formatDay(start)}, ${formatTime(start)}` : 'Open the covered lesson'}
    </Txt>
  );
}

function HandoverNoteEditor({ handover, label }: { handover: Handover; label: string }) {
  const [note, setNote] = useState(() => handover.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(source.saveHandoverNote);
  return (
    <Section title="Write the handover note">
      <Field
        label={label}
        multiline
        value={note}
        onChangeText={setNote}
        maxLength={HANDOVER_NOTE_LIMIT}
        placeholder="For example: what works well in lessons, where you are in the course, and what to set next."
      />
      {problem ? (
        <Banner tone="danger" icon="alert">
          {problem}
        </Banner>
      ) : null}
      <ErrorNote error={save.error} />
      <Button
        title="Save handover note"
        icon="check"
        variant="gold"
        loading={save.isPending}
        onPress={async () => {
          const message = validateHandoverNote(note);
          setProblem(message);
          if (message) return;
          try {
            await save.mutateAsync([handover.id, note.trim()]);
            notify('Handover note saved', 'Thank you. The incoming tutor can now read your note.');
          } catch {
            // Shown by ErrorNote.
          }
        }}
      />
    </Section>
  );
}

/** The full handover pack. Marks it as read when the incoming tutor opens it. */
export function HandoverPackView({ id, markViewed, footer }: { id: string; markViewed: boolean; footer?: ReactNode }) {
  const theme = useTheme();
  const lookup = useLookup();
  const queryClient = useQueryClient();
  const { pack, isLoading, error, refetch } = useHandoverPack(id);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (!markViewed) return;
    source
      .markHandoverViewed(id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['handovers'] }))
      .catch(() => {
        // Not being marked as read is harmless; the reminder simply stays.
      });
  }, [id, markViewed, queryClient]);

  if (isLoading) return <Loading />;
  if (!pack) {
    return (
      <Screen>
        <ErrorNote error={error} />
        <EmptyState icon="book" title="Handover pack not found" />
      </Screen>
    );
  }
  const h = pack.handover;
  const s = pack.student;
  const grades = [s.currentGrade ? `Current grade ${s.currentGrade}` : '', s.targetGrade ? `Target grade ${s.targetGrade}` : ''].filter(Boolean).join(' · ');
  const profile = [s.school, s.yearGroup, s.phase].filter(Boolean).join(' · ');

  return (
    <Screen onRefresh={refetch}>
      <HandoverHeader handover={h} studentName={s.fullName} lookup={lookup} />

      <Section title="Handover note">
        <Card style={{ gap: Spacing.one }}>
          <Txt variant="label">From {tutorName(lookup, h.fromTutorId)}</Txt>
          {pack.handoverNote ? <Txt>{pack.handoverNote}</Txt> : <Txt variant="muted">No handover note has been added yet.</Txt>}
        </Card>
      </Section>

      <Section title="Student profile and goals">
        <Card style={{ gap: Spacing.one }}>
          {profile ? <Txt>{profile}</Txt> : null}
          {pack.subject ? <Txt variant="muted">Subject: {pack.subject}</Txt> : null}
          {grades ? <Txt>{grades}</Txt> : null}
          {pack.examDate ? (
            <Txt>
              Exam on {formatDate(`${pack.examDate.slice(0, 10)}T12:00:00`)}
              {pack.daysToExam !== undefined && pack.daysToExam >= 0 ? ` · ${pack.daysToExam} ${pack.daysToExam === 1 ? 'day' : 'days'} to go` : ''}
            </Txt>
          ) : null}
          {pack.goals.length ? (
            <View style={{ gap: 2 }}>
              <Txt variant="label">Goals</Txt>
              {pack.goals.map((g, i) => (
                <Txt key={i}>• {g}</Txt>
              ))}
            </View>
          ) : null}
          {!profile && !grades && !pack.examDate && !pack.goals.length ? <Txt variant="muted">No profile details have been recorded yet.</Txt> : null}
        </Card>
      </Section>

      <Section title="Tutor notes">
        <Card style={{ gap: Spacing.one }}>
          {pack.tutorNotes ? <Txt>{pack.tutorNotes}</Txt> : <Txt variant="muted">No tutor notes have been recorded.</Txt>}
          <Txt variant="small">Visible to tutors and the office only.</Txt>
        </Card>
      </Section>

      <Section title="Progress">
        {pack.mastery ? (
          <Card style={{ gap: Spacing.two }}>
            <View style={{ gap: 4 }}>
              <Txt>Mastery {pack.mastery.masteryPercent}%</Txt>
              <ProgressBar value={pack.mastery.masteryPercent} />
            </View>
            <View style={{ gap: 4 }}>
              <Txt>
                Coverage {pack.mastery.coveragePercent}% ({pack.mastery.covered} of {pack.mastery.total} topics)
              </Txt>
              <ProgressBar value={pack.mastery.coveragePercent} />
            </View>
            {pack.mastery.weakUnits.length ? <Txt variant="muted">Units to strengthen: {pack.mastery.weakUnits.join(', ')}</Txt> : null}
          </Card>
        ) : (
          <Txt variant="muted">No topic ratings have been recorded for this subject yet.</Txt>
        )}
      </Section>

      <Section title="Focus topics">
        {pack.focusTopics.length ? (
          <Card style={{ gap: Spacing.one }}>
            {pack.focusTopics.map((t) => (
              <Row key={t.topicId} style={{ justifyContent: 'space-between' }} gap={Spacing.two}>
                <Txt style={{ flex: 1 }}>{t.name}</Txt>
                <Badge label={RATING_LABELS[Math.round(t.rating)] ?? `${t.rating}`} tone={t.rating < 3 ? 'warning' : 'neutral'} />
              </Row>
            ))}
          </Card>
        ) : (
          <Txt variant="muted">No topics need particular attention yet.</Txt>
        )}
      </Section>

      <Section title="Last five lessons">
        {pack.recentLessons.length ? (
          pack.recentLessons.map((l) => (
            <Card key={l.lessonId} style={{ gap: Spacing.one }} onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: l.lessonId } })}>
              <Txt variant="h3">
                {formatDay(l.start)} · {tutorName(lookup, l.tutorId, 'Tutor')}
              </Txt>
              <Txt>{l.summary || (l.status === 'no-show' ? 'The student did not attend.' : 'No summary was written.')}</Txt>
              {l.topicNames.length ? (
                <Row gap={4} wrap>
                  {l.topicNames.map((t, i) => (
                    <Badge key={`${t}-${i}`} label={t} />
                  ))}
                </Row>
              ) : null}
              {l.privateNote ? (
                <Txt variant="small" style={{ color: theme.warning }}>
                  Private: {l.privateNote}
                </Txt>
              ) : null}
            </Card>
          ))
        ) : (
          <Txt variant="muted">No lessons have been recorded yet.</Txt>
        )}
      </Section>

      <Section title="Open homework">
        {pack.openHomework.length ? (
          pack.openHomework.map((hw) => (
            <ListItem key={hw.id} title={hw.title} subtitle={dueLabel(hw.dueDate, now)} onPress={() => router.push({ pathname: '/homework/[id]', params: { id: hw.id } })} />
          ))
        ) : (
          <Txt variant="muted">There is no open homework.</Txt>
        )}
      </Section>

      <Section title="Recent lesson plans">
        {pack.recentPlans.length ? (
          pack.recentPlans.map((p) => (
            <Card key={p.lessonId} style={{ gap: Spacing.one }}>
              <Txt variant="h3">{formatDay(p.lessonStart)}</Txt>
              {p.objectives ? <Txt>{p.objectives}</Txt> : null}
              {p.topicNames.length ? (
                <Row gap={4} wrap>
                  {p.topicNames.map((t, i) => (
                    <Badge key={`${t}-${i}`} label={t} />
                  ))}
                </Row>
              ) : null}
              {p.homeworkTitles.length ? <Txt variant="muted">Planned homework: {p.homeworkTitles.join('; ')}</Txt> : null}
            </Card>
          ))
        ) : (
          <Txt variant="muted">No lesson plans have been written yet.</Txt>
        )}
      </Section>

      <Section title="Resources used">
        {pack.resources.length ? (
          pack.resources.map((r) => (
            <ListItem key={r.id} title={r.title} subtitle={resourceMeta(r) || undefined} onPress={() => openAttachment(resourceAttachment(r))} />
          ))
        ) : (
          <Txt variant="muted">No resources have been used yet.</Txt>
        )}
      </Section>

      {footer}
    </Screen>
  );
}
