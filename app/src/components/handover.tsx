import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/icon';
import { openAttachment } from '@/components/resources';
import { NoHeader, RowMeta } from '@/components/admin-people/kit';
import { Actions, Button, Columns, EmptyState, ErrorNote, Field, FieldsCard, Group, GroupRow, ListItem, Loading, Notice, PageHeader, Screen, Txt, useToast } from '@/components/ui';
import { MasteryColors } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useHandoverPack, useHandovers, useLesson, useLookup, type Lookup } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { formatDate, formatDay, formatTime, toDateKey } from '@/domain/dates';
import { HANDOVER_NOTE_LIMIT, HANDOVER_REASON_LABEL, handoverTitle, validateHandoverNote } from '@/domain/handover';
import { dueLabel, resourceAttachment, resourceMeta } from '@/domain/homework';
import { RATING_LABELS } from '@/domain/progress';
import type { Handover } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { HANDOVER_PROMPTS as PROMPTS, joinHandoverNote, splitHandoverNote } from '@/components/tutor/handover-note';

const handoverPath = (id: string) => ({ pathname: '/handover/[id]' as const, params: { id } });

function tutorName(lookup: Lookup, tutorId: string | undefined, fallback = 'the office') {
  return (tutorId && lookup.tutor(tutorId)?.fullName) || fallback;
}

/** The student's name. An awarded tutor cannot see the student yet, so fall back to the name stored with the handover. */
function studentName(lookup: Lookup, h: Handover) {
  return lookup.student(h.studentId)?.fullName ?? h.studentName ?? 'New student';
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
        <Notice key={`read-${h.id}`} tone="info" icon="menu_book" title="Handover pack ready" link={{ label: 'Open handover pack', onPress: () => router.push(handoverPath(h.id)) }}>
          {`${handoverTitle(h, studentName(lookup, h))}, from ${tutorName(lookup, h.fromTutorId)}. Read it before your first lesson.`}
        </Notice>
      ))}
      {toWrite.map((h) => {
        const student = studentName(lookup, h);
        return (
          <Notice key={`write-${h.id}`} tone="warn" icon="swap_horiz" title={`Handover note for ${student.split(' ')[0]}`} link={{ label: 'Write handover note', onPress: () => router.push(handoverPath(h.id)) }}>
            {`${student} is moving to ${tutorName(lookup, h.toTutorId, 'a new tutor')}. Please leave a short handover note.`}
          </Notice>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Handover packs list
// ---------------------------------------------------------------------------

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
      <Screen topInset onRefresh={() => handovers.refetch()} refreshing={handovers.isRefetching}>
        <NoHeader title="Handover packs" />
        <PageHeader
          back={{ fallback: '/admin' }}
          kicker="Team"
          title="Handover packs"
          sub="Prepared automatically when a lesson is covered or a student changes tutor: goals, recent notes, open homework, plans and topic ratings. Only the incoming tutor and the office can open a pack."
        />
        <ErrorNote error={handovers.error} />
        {list.length ? (
          <Group meta={`${list.length} ${list.length === 1 ? 'pack' : 'packs'}`}>
            {list.map((h) => (
              <GroupRow
                key={h.id}
                avatar={studentName(lookup, h)}
                title={handoverTitle(h, studentName(lookup, h))}
                accessibilityLabel={handoverTitle(h, studentName(lookup, h))}
                note={`${tutorName(lookup, h.fromTutorId)} to ${tutorName(lookup, h.toTutorId, 'the new tutor')} · ${HANDOVER_REASON_LABEL[h.reason]}`}
                right={
                  <RowMeta
                    tag={h.note?.trim() ? (h.viewedAt ? 'Read' : 'Ready') : 'Awaiting note'}
                    tone={h.note?.trim() ? 'good' : 'warn'}
                    meta={`Created ${formatDate(h.createdAt)}`}
                  />
                }
                onPress={() => router.push(handoverPath(h.id))}
              />
            ))}
          </Group>
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
  const row = (h: Handover, incoming: boolean) => (
    <GroupRow
      key={h.id}
      icon={incoming ? 'menu_book' : 'swap_horiz'}
      title={handoverTitle(h, studentName(lookup, h))}
      note={`${HANDOVER_REASON_LABEL[h.reason]} · ${incoming ? `from ${tutorName(lookup, h.fromTutorId)}` : `to ${tutorName(lookup, h.toTutorId, 'the new tutor')}`} · ${formatDate(h.createdAt)}`}
      value={incoming && !h.viewedAt ? 'New' : !incoming && !h.note?.trim() ? 'To write' : undefined}
      valueTone="accent"
      valueSize={12.5}
      onPress={() => router.push(handoverPath(h.id))}
    />
  );
  return (
    <Screen topInset onRefresh={() => handovers.refetch()} refreshing={handovers.isRefetching}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader back kicker="Handover" title="Handover notes" sub="Packs from tutors whose students you take on, and the notes you leave when a student moves on." />
      <ErrorNote error={handovers.error} />
      {!forMe.length && !fromMe.length ? empty : null}
      {toWrite.length ? <Group title="Notes to write">{toWrite.map((h) => row(h, false))}</Group> : null}
      {forMe.length ? <Group title="Handover packs for you">{forMe.map((h) => row(h, true))}</Group> : null}
      {written.length ? <Group title="Handover notes you have written">{written.map((h) => row(h, false))}</Group> : null}
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
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/handover' }} kicker="Handover pack" title="Handover pack not found" />
        <EmptyState icon="book" title="Handover pack not found" message="It may have been removed, or it may be for another tutor." />
      </Screen>
    );
  }
  const toName = tutorName(lookup, h.toTutorId, 'the new tutor');

  if (!admin && !incoming) {
    return <HandoverWriter key={h.noteUpdatedAt ?? 'none'} handover={h} studentName={studentName(lookup, h)} toName={toName} />;
  }

  return (
    <HandoverPackView
      id={h.id}
      markViewed={incoming && !h.viewedAt}
      footer={admin ? <HandoverNoteEditor key={h.noteUpdatedAt ?? 'none'} handover={h} label={`Handover note for ${toName}`} /> : null}
    />
  );
}

/** The outgoing tutor's handover note: three short prompts, joined into the one note the incoming tutor reads. */
function HandoverWriter({ handover: h, studentName: name, toName }: { handover: Handover; studentName: string; toName: string }) {
  const viewing = !!useViewing();
  const toast = useToast();
  const first = name.split(' ')[0];
  const [parts, setParts] = useState<[string, string, string]>(() => splitHandoverNote(h.note ?? '', first));
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(source.saveHandoverNote);
  const set = (i: 0 | 1 | 2) => (v: string) => setParts((p) => (i === 0 ? [v, p[1], p[2]] : i === 1 ? [p[0], v, p[2]] : [p[0], p[1], v]));
  const missing = !parts[0].trim() || !parts[1].trim();
  return (
    <Screen topInset>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        back
        kicker="Handover"
        title={`${name} to ${toName}`}
        sub={`${HANDOVER_REASON_LABEL[h.reason]}${h.subject ? ` · ${h.subject}` : ''}. Only ${toName} and the office can read this note.`}
      />
      {h.note?.trim() ? (
        <Notice tone="good" title={`Sent to ${toName}`}>
          Thank you. You can still change the note below; {toName} always sees the latest version.
        </Notice>
      ) : (
        <Notice tone="info" icon="edit_note">
          A few lines are enough. {toName} also receives the recent lesson notes, open homework and topic ratings automatically.
        </Notice>
      )}
      <FieldsCard>
        <Field label={PROMPTS[0].replace('{first}', first)} multiline value={parts[0]} onChangeText={set(0)} error={tried && !parts[0].trim()} placeholder="For example, what works well in lessons" />
        <Field label={PROMPTS[1].replace('{first}', first)} multiline value={parts[1]} onChangeText={set(1)} error={tried && !parts[1].trim()} placeholder="Where you are in the course, what is secure and what is not" />
        <Field label={PROMPTS[2]} multiline value={parts[2]} onChangeText={set(2)} placeholder="Optional: what to set or revisit next" />
      </FieldsCard>
      <Group title="Included automatically">
        <GroupRow icon="notes" title="Recent lesson notes" titleWeight="regular" />
        <GroupRow icon="assignment" title="Open homework" titleWeight="regular" />
        <GroupRow icon="bar_chart" title="Topic ratings" titleWeight="regular" />
        <GroupRow icon="target" title="Target and current grades" titleWeight="regular" />
      </Group>
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
      <ErrorNote error={save.error} />
      {!viewing ? (
        <Actions>
          <Button
            title={h.note?.trim() ? 'Save changes' : `Send to ${toName.split(' ')[0]}`}
            icon="send"
            loading={save.isPending}
            onPress={async () => {
              setTried(true);
              if (missing) return;
              const note = joinHandoverNote(parts, first);
              const message = validateHandoverNote(note);
              setProblem(message);
              if (message) return;
              try {
                await save.mutateAsync([h.id, note]);
                toast(`Handover note sent to ${toName.split(' ')[0]}`);
              } catch {
                // Shown by ErrorNote.
              }
            }}
          />
        </Actions>
      ) : null}
    </Screen>
  );
}

function HandoverHeader({
  handover: h,
  studentName: name,
  lookup,
  canOpenLesson,
}: {
  handover: Handover;
  studentName: string;
  lookup: Lookup;
  /** The outgoing tutor no longer has the covered lesson, so it is shown without a link. */
  canOpenLesson: boolean;
}) {
  return (
    <>
      <NoHeader title={name} />
      <PageHeader
        back={{ fallback: '/handover' }}
        kicker={['Handover pack', h.subject].filter(Boolean).join(' · ')}
        title={name}
        sub={`${fromTo(lookup, h)}. ${HANDOVER_REASON_LABEL[h.reason]}.`}>
        {h.lessonId ? <CoveredLessonLink lessonId={h.lessonId} canOpen={canOpenLesson} /> : null}
      </PageHeader>
    </>
  );
}

function CoveredLessonLink({ lessonId, canOpen }: { lessonId: string; canOpen: boolean }) {
  const lesson = useLesson(lessonId);
  const start = lesson.data?.start;
  if (!canOpen) return start ? <Txt variant="muted">Covered lesson: {formatDay(start)}, {formatTime(start)}</Txt> : null;
  return (
    <Txt color="accent" accessibilityRole="link" onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: lessonId } })}>
      {start ? `Covered lesson: ${formatDay(start)}, ${formatTime(start)}` : 'Open the covered lesson'}
    </Txt>
  );
}

function HandoverNoteEditor({ handover, label }: { handover: Handover; label: string }) {
  const [note, setNote] = useState(() => handover.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(source.saveHandoverNote);
  const toast = useToast();
  return (
    <>
      <FieldsCard title="Write the handover note">
        <Field
          label={label}
          multiline
          value={note}
          onChangeText={setNote}
          maxLength={HANDOVER_NOTE_LIMIT}
          placeholder="For example: what works well in lessons, where you are in the course, and what to set next."
          error={problem ?? undefined}
        />
        <ErrorNote error={save.error} />
      </FieldsCard>
      <Actions>
        <Button
          title="Save handover note"
          icon="check"
          loading={save.isPending}
          onPress={async () => {
            const message = validateHandoverNote(note);
            setProblem(message);
            if (message) return;
            try {
              await save.mutateAsync([handover.id, note.trim()]);
              toast('Handover note saved. The incoming tutor can now read it.');
            } catch {
              // Shown by ErrorNote.
            }
          }}
        />
      </Actions>
    </>
  );
}

/** The full handover pack. Marks it as read when the incoming tutor opens it. */
export function HandoverPackView({ id, markViewed, footer }: { id: string; markViewed: boolean; footer?: ReactNode }) {
  const theme = useTheme();
  const me = useMe();
  const lookup = useLookup();
  const queryClient = useQueryClient();
  const { pack, isLoading, error, refetch } = useHandoverPack(id);
  const [now] = useState(() => new Date());
  const today = toDateKey(now);
  // The incoming tutor cannot open another tutor's lessons, so only their own (or any, for admins) link through.
  const canOpenLesson = (tutorId: string) => me.role === 'admin' || (!!me.tutorId && tutorId === me.tutorId);
  const canOpenHomework = (studentId: string) => me.role === 'admin' || !!lookup.student(studentId);

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
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/handover' }} kicker="Handover pack" title="Handover pack not found" />
        <ErrorNote error={error} />
        <EmptyState icon="book" title="Handover pack not found" />
      </Screen>
    );
  }
  const h = pack.handover;
  const s = pack.student;
  const grades = [s.currentGrade ? `Current grade ${s.currentGrade}` : '', s.targetGrade ? `Target grade ${s.targetGrade}` : ''].filter(Boolean).join(' · ');
  const profile = [s.school, s.yearGroup, s.phase].filter(Boolean).join(' · ');

  const noteSection = (
    <Group title="Handover note" note={pack.handoverNote || 'No handover note has been added yet.'}>
      <GroupRow icon="edit_note" title={`From ${tutorName(lookup, h.fromTutorId)}`} note={h.noteUpdatedAt ? `Written ${formatDate(h.noteUpdatedAt)}` : undefined} />
    </Group>
  );
  const status = pack.handoverNote ? (
    <Notice tone="good" title={h.viewedAt ? 'Read' : 'Ready'}>
      {h.viewedAt
        ? `${tutorName(lookup, h.toTutorId, 'The new tutor')} opened this pack on ${formatDate(h.viewedAt)}.`
        : 'Everything is in place. The incoming tutor can open the pack from the lesson or their Today screen.'}
    </Notice>
  ) : (
    <Notice tone="warn" title="Awaiting note">
      {`${tutorName(lookup, h.fromTutorId)} has not added a handover note yet. The rest was gathered from lesson records.`}
    </Notice>
  );

  // The tutor no longer teaches the student: only the handover and its note remain.
  if (pack.closed) {
    return (
      <Screen topInset onRefresh={refetch}>
        <HandoverHeader handover={h} studentName={s.fullName} lookup={lookup} canOpenLesson={false} />
        <Notice tone="info">
          {`You no longer teach ${handoverTitle(h, s.fullName)}, so this pack now shows only the handover note. Please contact the office if this is unexpected.`}
        </Notice>
        {noteSection}
        {footer}
      </Screen>
    );
  }

  return (
    <Screen topInset onRefresh={refetch}>
      <HandoverHeader handover={h} studentName={s.fullName} lookup={lookup} canOpenLesson />
      {me.role === 'admin' ? status : null}

      <Columns>
        {noteSection}
        <Group
          title="Student profile and goals"
          note={!profile && !grades && !pack.examDate && !pack.goals.length ? 'No profile details have been recorded yet.' : undefined}>
          {profile || pack.subject ? <GroupRow icon="school" title={profile || (pack.subject ?? '')} note={profile && pack.subject ? `Subject: ${pack.subject}` : undefined} /> : null}
          {grades ? <GroupRow icon="trending_up" title={grades} /> : null}
          {pack.examDate ? (
            <GroupRow
              icon="event"
              title={`Exam on ${formatDate(`${pack.examDate.slice(0, 10)}T12:00:00`)}`}
              note={pack.daysToExam !== undefined && pack.daysToExam >= 0 ? `${pack.daysToExam} ${pack.daysToExam === 1 ? 'day' : 'days'} to go` : undefined}
            />
          ) : null}
          {pack.goals.map((g, i) => (
            <GroupRow key={i} icon="flag" title={g} />
          ))}
        </Group>
      </Columns>

      <Columns>
        <Group title="Tutor notes" note={pack.tutorNotes || 'No tutor notes have been recorded.'}>
          <GroupRow icon="lock" tone="neutral" title="Visible to tutors and the office only." titleWeight="regular" />
        </Group>
        <View style={{ gap: 26 }}>
          <Group title="Progress" note={pack.mastery ? undefined : 'No topic ratings have been recorded for this subject yet.'}>
            {pack.mastery ? (
              <>
                <GroupRow title={`Mastery ${pack.mastery.masteryPercent}%`} progress={pack.mastery.masteryPercent} titleWeight="regular" />
                <GroupRow
                  title={`Coverage ${pack.mastery.coveragePercent}% (${pack.mastery.covered} of ${pack.mastery.total} topics)`}
                  progress={pack.mastery.coveragePercent}
                  titleWeight="regular"
                  note={pack.mastery.weakUnits.length ? `Units to strengthen: ${pack.mastery.weakUnits.join(', ')}` : undefined}
                />
              </>
            ) : null}
          </Group>
          <Group title="Focus topics" note={pack.focusTopics.length ? undefined : 'No topics need particular attention yet.'}>
            {pack.focusTopics.map((t) => {
              const r = Math.max(1, Math.min(5, Math.round(t.rating)));
              return (
                <GroupRow
                  key={t.topicId}
                  title={t.name}
                  titleWeight="regular"
                  progress={r * 20}
                  progressLabel={`${t.name} mastery`}
                  progressColor={MasteryColors[r - 1]}
                  value={RATING_LABELS[r] ?? `${t.rating}`}
                  valueTone={t.rating < 3 ? 'warn' : 'muted'}
                />
              );
            })}
          </Group>
        </View>
      </Columns>

      <Columns>
        <Group title="Last five lessons" note={pack.recentLessons.length ? undefined : 'No lessons have been recorded yet.'}>
          {pack.recentLessons.map((l) => (
            <GroupRow
              key={l.lessonId}
              icon="edit_note"
              title={`${formatDay(l.start)} · ${tutorName(lookup, l.tutorId, 'Tutor')}`}
              note={l.summary || (l.status === 'no-show' ? 'The student did not attend.' : 'No summary was written.')}
              onPress={canOpenLesson(l.tutorId) ? () => router.push({ pathname: '/lesson/[id]', params: { id: l.lessonId } }) : undefined}>
              {l.topicNames.length ? <Txt variant="small">{`Topics: ${l.topicNames.join(', ')}`}</Txt> : null}
              {l.privateNote ? (
                <Txt variant="small" style={{ color: theme.warning }}>
                  Private: {l.privateNote}
                </Txt>
              ) : null}
            </GroupRow>
          ))}
        </Group>
        <View style={{ gap: 26 }}>
          <Group title="Open homework" note={pack.openHomework.length ? undefined : 'There is no open homework.'}>
            {pack.openHomework.map((hw) => (
              <GroupRow
                key={hw.id}
                icon="assignment"
                tone={hw.dueDate.slice(0, 10) < today ? 'warn' : 'gold'}
                title={hw.title}
                note={dueLabel(hw.dueDate, now)}
                value={hw.dueDate.slice(0, 10) < today ? 'Overdue' : undefined}
                valueTone="warn"
                // A newly awarded tutor cannot open the student's homework until the office moves the enrolment.
                onPress={canOpenHomework(hw.studentId) ? () => router.push({ pathname: '/homework/[id]', params: { id: hw.id } }) : undefined}
              />
            ))}
          </Group>
          <Group title="Resources used" note={pack.resources.length ? undefined : 'No resources have been used yet.'}>
            {pack.resources.map((r) => (
              <GroupRow key={r.id} icon="description" title={r.title} note={resourceMeta(r) || undefined} onPress={() => openAttachment(resourceAttachment(r))} />
            ))}
          </Group>
        </View>
      </Columns>

      <Group title="Recent lesson plans" note={pack.recentPlans.length ? undefined : 'No lesson plans have been written yet.'}>
        {pack.recentPlans.map((p) => (
          <GroupRow key={p.lessonId} icon="event_available" title={formatDay(p.lessonStart)} note={p.objectives || undefined}>
            {p.topicNames.length ? <Txt variant="small">{`Topics: ${p.topicNames.join(', ')}`}</Txt> : null}
            {p.homeworkTitles.length ? <Txt variant="small">Planned homework: {p.homeworkTitles.join('; ')}</Txt> : null}
          </GroupRow>
        ))}
      </Group>

      {footer}
    </Screen>
  );
}
