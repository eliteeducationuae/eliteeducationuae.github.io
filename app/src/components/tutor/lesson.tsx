/**
 * The lesson page as the lesson's tutor sees it (2026 redesign). The tutor sees their own pay, never the
 * family's price, and never the family's email or phone. "I can't make it" writes to the office in the family
 * conversation (which the office reads); the office then arranges a new time or cover. A tutor never cancels
 * a lesson or creates a charge from here.
 */
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { HandoverLink } from '@/components/handover';
import { Actions, Badge, Button, Columns, EmptyState, Group, GroupRow, Loading, Notice, PageHeader, Prose, Row, Screen, Txt } from '@/components/ui';
import { LessonVettingNote } from '@/components/vetting';
import { useEnrolments, useLesson, useLessonPlan, useLookup, useNotes, useTopicLookup } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { formatTime, minutesBetween, relativeDay } from '@/domain/dates';
import { lessonSubject } from '@/domain/enrolments';
import { isPlanEmpty } from '@/domain/plans';
import { safeMeetingUrl } from '@/lib/safe-url';

import { isCancelled, lessonPay, lessonWhere, longDay, needsRecording, studentFirstNames } from './common';

export function TutorLessonPage({ id }: { id: string }) {
  const me = useMe();
  const viewing = !!useViewing();
  const lookup = useLookup();
  const lesson = useLesson(id);
  const notes = useNotes({ lessonId: id });
  const enrolments = useEnrolments();
  const topics = useTopicLookup();
  const plan = useLessonPlan(id);
  const [cantMake, setCantMake] = useState(false);
  const [now] = useState(() => new Date());

  if (lesson.isLoading || !lookup.ready) return <Loading />;
  const l = lesson.data;
  if (!l || l.tutorId !== me.tutorId) {
    return (
      <Screen topInset>
        <PageHeader back={{ fallback: '/tutor' }} title="Lesson" />
        <EmptyState title="Lesson not found" message="It may have moved to another tutor, or it may have been removed." />
      </Screen>
    );
  }

  const tutor = lookup.tutor(l.tutorId);
  const subject = lessonSubject(l, enrolments.data ?? []);
  const service = lookup.service(l.serviceId)?.name;
  const note = notes.data?.[0];
  const scheduled = l.status === 'scheduled';
  const started = new Date(l.start) <= now;
  const record = needsRecording(l, now);
  const pay = lessonPay(l, tutor, enrolments.data ?? []);
  const minutes = minutesBetween(new Date(l.start), new Date(l.end));
  const url = l.location === 'online' ? safeMeetingUrl(l.meetingUrl) : null;
  const names = studentFirstNames(l, lookup);
  const families = [...new Set(l.studentIds.map((sid) => lookup.student(sid)?.familyId).filter((f): f is string => !!f))];
  const p = plan.data && !isPlanEmpty(plan.data) ? plan.data : null;
  const openPlan = () => router.push({ pathname: '/plan/[id]', params: { id: l.id } });
  const openRecord = () => router.push({ pathname: '/complete/[id]', params: { id: l.id } });
  const draftFor = `Hello. I’m sorry, but I can’t make ${names}’s lesson on ${longDay(l.start)} at ${formatTime(l.start)}, because `;

  return (
    <Screen topInset onRefresh={() => lesson.refetch()} refreshing={lesson.isRefetching}>
      <PageHeader
        back={{ fallback: '/tutor' }}
        kicker={`Lesson · ${relativeDay(l.start, now)}`}
        title={[names, subject].filter(Boolean).join(' · ')}
        sub={`${longDay(l.start)} · ${formatTime(l.start)} to ${formatTime(l.end)} · ${lessonWhere(l)}`}
      />

      {scheduled ? <LessonVettingNote tutorId={l.tutorId} /> : null}
      {record ? (
        <Notice tone="warn" icon="edit_note" title="To record" link={!viewing ? { label: 'Record this lesson', onPress: openRecord } : undefined}>
          Please record this lesson so that the family receives the note and the lesson is billed and paid.
        </Notice>
      ) : null}
      {l.status === 'completed' || l.status === 'no-show' ? (
        <Notice tone="good" title={l.status === 'no-show' ? 'Recorded as a no-show' : 'Recorded'}>
          {l.status === 'no-show' ? 'The office has been told that the student did not attend.' : 'The note has gone to the family and the lesson is on your pay.'}
        </Notice>
      ) : null}
      {isCancelled(l) ? (
        <Notice tone="info" icon="event_busy" title="Cancelled">
          {l.cancelReason ? `This lesson was cancelled: ${l.cancelReason}.` : 'This lesson was cancelled.'}
        </Notice>
      ) : null}

      <Columns>
        <Group title="Details">
          {l.studentIds.map((sid) => {
            const s = lookup.student(sid);
            return (
              <GroupRow
                key={sid}
                avatar={s?.fullName ?? 'Student'}
                title={s?.fullName ?? 'Student'}
                note={[s?.yearGroup, s?.school].filter(Boolean).join(' · ') || subject}
                onPress={s ? () => router.push({ pathname: '/students/[id]', params: { id: sid } }) : undefined}
              />
            );
          })}
          {families.map((fid) => {
            const family = lookup.family(fid);
            return (
              <GroupRow
                key={fid}
                icon="family_restroom"
                title={family ? `The ${family.name} family` : 'The family'}
                note="Message them in the app. The office can also see the conversation."
                action={!viewing ? { label: 'Message', onPress: () => router.push({ pathname: '/messages/[familyId]', params: { familyId: fid } }) } : undefined}
              />
            );
          })}
          <GroupRow
            icon={l.location === 'online' ? 'videocam' : 'location_on'}
            title={lessonWhere(l)}
            note={l.location === 'online' ? (url ? 'The link opens ten minutes before the lesson' : 'The link will follow') : `${minutes} minutes${service ? ` · ${service}` : ''}`}
          />
          {pay ? (
            <GroupRow
              icon="payments"
              title={formatAED(pay.amount)}
              note={`Your pay for this lesson${pay.custom ? `, at your agreed rate of ${formatAED(pay.rate)} an hour` : ''}`}
            />
          ) : null}
        </Group>

        <Group title="Lesson plan">
          {p ? (
            <GroupRow
              icon="edit_note"
              title="Plan"
              note={p.objectives || `${p.topicIds.length} topics planned`}
              value={p.sharedWithFamily ? 'Shared' : undefined}
              valueTone="accent"
              valueSize={12.5}
              onPress={scheduled ? openPlan : undefined}>
              {p.topicIds.length ? (
                <Row gap={4} wrap style={{ marginTop: 4 }}>
                  {p.topicIds.map((t) => (
                    <Badge key={t} label={topics.name(t)} />
                  ))}
                </Row>
              ) : null}
            </GroupRow>
          ) : (
            <GroupRow
              icon="edit_note"
              title="No plan yet"
              note={scheduled ? 'Write a short plan. The family sees it only if you choose to share it.' : 'No plan was written for this lesson.'}
              action={scheduled && !viewing ? { label: 'Write', onPress: openPlan } : undefined}
            />
          )}
        </Group>
      </Columns>

      {note ? (
        <Prose title="Lesson note" by={l.status === 'completed' ? 'Sent to the family' : undefined}>
          <Txt style={{ fontSize: 15.5, lineHeight: 24.8 }}>{note.summary || 'No summary was written.'}</Txt>
          {note.topicIds.length ? (
            <Row gap={4} wrap>
              {note.topicIds.map((t) => (
                <Badge key={t} label={topics.name(t)} />
              ))}
            </Row>
          ) : null}
          {note.privateNote ? <Txt variant="note">For the office only: {note.privateNote}</Txt> : null}
        </Prose>
      ) : null}

      <HandoverLink lessonId={l.id} />

      {cantMake ? (
        <Notice tone="info" icon="event_busy" title="Tell the office">
          <View style={{ gap: 10 }}>
            <Txt style={{ fontSize: 14.5, lineHeight: 21.75 }}>
              Write to the office in the family’s conversation, which the office reads. The family can see it too. The lesson stays booked until the office arranges a new time or cover with the family; you are never asked to cancel it yourself.
            </Txt>
            <Actions>
              {families[0] ? (
                <Button
                  title="Write the message"
                  icon="forum"
                  onPress={() => router.push({ pathname: '/messages/[familyId]', params: { familyId: families[0], draft: draftFor } })}
                />
              ) : null}
              <Button title="Not now" variant="secondary" onPress={() => setCantMake(false)} />
            </Actions>
          </View>
        </Notice>
      ) : null}

      {!viewing ? (
        <Actions>
          {url && scheduled ? <Button title="Join the lesson" icon="videocam" onPress={() => Linking.openURL(url)} /> : null}
          {scheduled ? (
            <Button
              title={started ? 'Record this lesson' : 'Record the lesson early'}
              icon="edit_note"
              variant={started ? 'primary' : 'secondary'}
              onPress={openRecord}
            />
          ) : null}
          {l.studentIds[0] ? (
            <Button title="Set homework" icon="assignment" variant="secondary" onPress={() => router.push(`/homework/new?studentId=${l.studentIds[0]}`)} />
          ) : null}
          {scheduled && !started && !cantMake ? <Button title="I can’t make it" icon="event_busy" variant="secondary" onPress={() => setCantMake(true)} /> : null}
        </Actions>
      ) : null}
    </Screen>
  );
}
