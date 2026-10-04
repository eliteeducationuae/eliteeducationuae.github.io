import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useBusyBlocks, useLessons, useLookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import { addDays, formatDay, formatTime, relativeDay, startOfDay } from '@/domain/dates';
import { findBusyClashes, findClashes } from '@/domain/scheduling';
import type { LessonRequest, RequestStatus } from '@/domain/types';

import { Badge, Banner, Button, Card, ErrorNote, Field, Row, Txt, type Tone } from './ui';

export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Confirmed', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

const today = startOfDay(new Date());

/** One lesson request, with approve/decline for admins and withdraw for families. */
export function RequestCard({ r }: { r: LessonRequest }) {
  const me = useMe();
  const lookup = useLookup();
  const lessons = useLessons(today, addDays(today, 60));
  const decide = useAction(source.decideRequest);
  const withdraw = useAction(source.withdrawRequest);
  // Google Calendar: a busy time is only a warning; the office may still approve.
  const busyBlocks = useBusyBlocks(today, addDays(today, 60), r.tutorId);
  const [response, setResponse] = useState('');
  const s = REQUEST_STATUS[r.status];
  const original = r.lessonId ? (lessons.data ?? []).find((l) => l.id === r.lessonId) : undefined;
  const clash =
    r.status === 'pending' && me.role === 'admin'
      ? findClashes({ start: new Date(r.start), end: new Date(r.end), tutorId: r.tutorId, studentIds: [r.studentId], ignoreLessonId: r.lessonId }, lessons.data ?? [])
      : [];
  const busy =
    r.status === 'pending' && (me.role === 'admin' || me.role === 'tutor')
      ? findBusyClashes({ start: new Date(r.start), end: new Date(r.end), tutorId: r.tutorId }, busyBlocks.data ?? [])
      : [];

  return (
    <Card style={{ gap: Spacing.two }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">
            {r.kind === 'reschedule' ? 'Move lesson' : 'Extra lesson'} · {lookup.student(r.studentId)?.fullName.split(' ')[0] ?? 'Student'}
          </Txt>
          <Txt>
            {formatDay(r.start)} at {formatTime(r.start)} with {lookup.tutor(r.tutorId)?.fullName}
          </Txt>
          {original ? <Txt variant="muted">Instead of {formatDay(original.start)} {formatTime(original.start)}</Txt> : null}
          {me.role === 'admin' ? <Txt variant="small">{lookup.family(r.familyId)?.parentName} · requested {relativeDay(r.createdAt).toLowerCase()}</Txt> : null}
        </View>
        <Badge label={s.label} tone={s.tone} />
      </Row>
      {r.note ? <Txt variant="muted">“{r.note}”</Txt> : null}
      {r.response ? <Txt variant="muted">Reply: {r.response}</Txt> : null}
      {clash.length ? <Banner tone="warning" icon="alert">This now clashes with another lesson. Please decline it and suggest another time.</Banner> : null}
      {busy.length ? (
        <Banner tone="warning" icon="alert">
          Google Calendar shows the tutor as busy at this time. Please check with them before approving.
        </Banner>
      ) : null}

      {r.status === 'pending' && me.role === 'admin' ? (
        <>
          <Field label="Reply (optional)" value={response} onChangeText={setResponse} placeholder="e.g. Confirmed. Or: Would 5pm suit instead?" />
          <ErrorNote error={decide.error} />
          <Row gap={Spacing.two}>
            <Button title="Decline" variant="danger" style={{ flex: 1 }} loading={decide.isPending} onPress={() => decide.mutate([r.id, false, response])} />
            <Button title="Approve" style={{ flex: 1 }} disabled={clash.length > 0} loading={decide.isPending} onPress={() => decide.mutate([r.id, true, response])} />
          </Row>
        </>
      ) : null}
      {r.status === 'pending' && me.role === 'parent' ? (
        <Button title="Withdraw request" size="sm" variant="ghost" loading={withdraw.isPending} onPress={() => withdraw.mutate([r.id])} />
      ) : null}
    </Card>
  );
}
