import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { source } from '@/data';
import {
  useAction,
  useAdmissionsCase,
  useAdmissionsDocuments,
  useAdmissionsEvents,
  useAdmissionsKeyDates,
  useAdmissionsTargets,
  useAdmissionsTasks,
  useAdvisoryUpdates,
  useLookup,
} from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { CASE_KIND_LABELS, openTasks, overdueKeyDates, TARGET_STATUS_LABELS, upcomingKeyDates } from '@/domain/admissions';
import type { AdmissionsTask } from '@/domain/admissions';

import { DocumentsPanel, TimelinePanel, type CaseData } from '../admissions/case-panels';
import { adviserLine, adviserName, OFFICE_ADVISER } from '../admissions/format';
import { Actions, Button, Columns, EmptyState, ErrorNote, Figure, Figures, Group, GroupRow, Loading, PageHeader, Screen, Tabs, useToast } from '../ui';
import { dayMonth, firstName } from './format';
import { openMessages } from './hooks';

type ParentCaseTab = 'overview' | 'documents' | 'timeline';

/** An admissions case as the family sees it: what is waiting on them, the shortlist, key dates and updates. */
export function ParentCase({ id, initialTab }: { id: string; initialTab?: string }) {
  const me = useMe();
  const viewing = useViewing();
  const toast = useToast();
  const lookup = useLookup();
  const caseQ = useAdmissionsCase(id);
  const targets = useAdmissionsTargets(id);
  const dates = useAdmissionsKeyDates({ caseId: id });
  const tasks = useAdmissionsTasks(id);
  const documents = useAdmissionsDocuments(id);
  const updates = useAdvisoryUpdates(id);
  const events = useAdmissionsEvents(id);
  const done = useAction(source.setAdmissionsTaskDone);
  const [tab, setTab] = useState<ParentCaseTab>(initialTab === 'documents' || initialTab === 'timeline' ? initialTab : 'overview');
  const [now] = useState(() => new Date());

  const header = <Stack.Screen options={{ headerShown: false, title: 'Admissions' }} />;
  if (caseQ.isLoading || !lookup.ready) return <Loading />;
  const c = caseQ.data;
  if (!c) {
    return (
      <Screen topInset>
        {header}
        <PageHeader back={{ fallback: '/parent' }} kicker="Admissions" title="Case not found" />
        <ErrorNote error={caseQ.error} />
        <EmptyState icon="school" title="Case not found" message="This admissions case may have been closed, or it is not shared with you." />
      </Screen>
    );
  }

  const student = lookup.student(c.studentId);
  const studentName = student?.fullName ?? 'Your child';
  const adviser = adviserName(c, lookup);
  const allTasks = tasks.data ?? [];
  const forYou = openTasks(allTasks, 'family');
  const yoursDone = allTasks.filter((t) => t.owner === 'family' && t.doneAt).slice(0, 3);
  const withAdviser = [...openTasks(allTasks, 'adviser'), ...allTasks.filter((t) => t.owner === 'adviser' && t.doneAt).slice(0, 2)];
  const caseDates = dates.data ?? [];
  const nextDates = [...overdueKeyDates(caseDates, now), ...upcomingKeyDates(caseDates, now, 3650)];
  const shortlist = targets.data ?? [];
  const published = (updates.data ?? []).filter((u) => u.status === 'published').sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  const adviserFirst = adviser === OFFICE_ADVISER ? 'us' : firstName(adviser);
  const data: CaseData = {
    c,
    me,
    student,
    studentName,
    adviser,
    targets: shortlist,
    dates: caseDates,
    tasks: allTasks,
    documents: documents.data ?? [],
    updates: updates.data ?? [],
    events: events.data ?? [],
    now,
    manager: false,
    isAdmin: false,
    setTab: () => undefined,
  };

  async function toggle(t: AdmissionsTask) {
    try {
      await done.mutateAsync([t.id, !t.doneAt]);
      if (!t.doneAt) toast(`Thank you. ${adviser === OFFICE_ADVISER ? 'The office has' : `${firstName(adviser)} has`} been told.`);
    } catch {
      // Shown below by ErrorNote.
    }
  }

  return (
    <Screen
      topInset
      onRefresh={() => {
        caseQ.refetch();
        tasks.refetch();
        dates.refetch();
        updates.refetch();
      }}
      refreshing={caseQ.isRefetching}>
      {header}
      <PageHeader
        back={{ fallback: '/parent' }}
        kicker={`Admissions · ${CASE_KIND_LABELS[c.kind]}`}
        title={c.title}
        sub={[`${firstName(studentName)}.`, c.entryYear ? `Entry ${c.entryYear}.` : '', `${adviserLine(adviser)}.`, c.summary ?? ''].filter(Boolean).join(' ')}
      />
      <Figures>
        <Figure label="Shortlist" value={String(shortlist.length)} hint={shortlist.length === 1 ? 'institution' : 'institutions'} />
        {nextDates[0] ? <Figure label="Next date" value={dayMonth(nextDates[0].dueOn)} hint={nextDates[0].title} /> : null}
        <Figure label="For you" value={String(forYou.length)} hint={forYou.length ? (forYou.length === 1 ? 'task to do' : 'tasks to do') : 'all done'} tone={forYou.length ? 'warn' : 'good'} />
      </Figures>
      <Tabs
        value={tab}
        onChange={setTab}
        accessibilityLabel="Admissions case"
        tabs={[
          { value: 'overview', label: 'Overview', badge: forYou.length || undefined },
          { value: 'documents', label: 'Documents' },
          { value: 'timeline', label: 'Timeline' },
        ]}
      />

      {tab === 'overview' ? (
        <>
          <Columns>
            <Group title="For you to do">
              {forYou.map((t) => (
                <GroupRow
                  key={t.id}
                  icon="radio_button_unchecked"
                  tone="warn"
                  title={t.title}
                  note={[t.dueOn ? `By ${dayMonth(t.dueOn)}` : '', viewing ? '' : 'tap when done', t.details ?? ''].filter(Boolean).join(' · ')}
                  onPress={viewing ? undefined : () => void toggle(t)}
                  accessibilityHint="Marks this task as done"
                />
              ))}
              {yoursDone.map((t) => (
                <GroupRow
                  key={t.id}
                  icon="check_circle"
                  tone="good"
                  title={t.title}
                  note={`Done${t.doneByName ? ` by ${t.doneByName}` : ''}`}
                  onPress={viewing ? undefined : () => void toggle(t)}
                  accessibilityHint="Marks this task as not done"
                />
              ))}
              {!forYou.length && !yoursDone.length ? <GroupRow icon="check_circle" tone="good" title="Nothing for you to do" note="There is nothing waiting on you at present. Thank you." /> : null}
            </Group>
            {shortlist.length ? (
              <Group title="Shortlist">
                {shortlist.map((t) => (
                  <GroupRow
                    key={t.id}
                    icon="account_balance"
                    title={t.institution}
                    note={[t.programme, t.decisionDate ? `Decision ${dayMonth(t.decisionDate)}` : ''].filter(Boolean).join(' · ') || undefined}
                    value={TARGET_STATUS_LABELS[t.status]}
                    valueTone={t.status === 'offer' || t.status === 'accepted' ? 'good' : t.status === 'rejected' ? 'muted' : 'accent'}
                    valueSize={12.5}
                  />
                ))}
              </Group>
            ) : null}
            {nextDates.length ? (
              <Group title="Key dates">
                {nextDates.slice(0, 6).map((d) => (
                  <GroupRow key={d.id} icon="event" tone={d.dueOn < now.toISOString().slice(0, 10) ? 'bad' : 'gold'} title={d.title} value={dayMonth(d.dueOn)} valueTone="text" />
                ))}
              </Group>
            ) : null}
            {withAdviser.length ? (
              <Group title={adviser === OFFICE_ADVISER ? 'With the office' : `With ${firstName(adviser)}`}>
                {withAdviser.map((t) => (
                  <GroupRow
                    key={t.id}
                    icon={t.doneAt ? 'check_circle' : 'pending'}
                    tone={t.doneAt ? 'good' : 'gold'}
                    title={t.title}
                    titleWeight="regular"
                    note={t.doneAt ? `Done ${dayMonth(t.doneAt)}` : t.dueOn ? `By ${dayMonth(t.dueOn)}` : undefined}
                  />
                ))}
              </Group>
            ) : null}
            <Group title="Monthly updates" note={published.length ? undefined : 'Your adviser’s monthly updates will appear here.'}>
              {published.map((u) => (
                <GroupRow
                  key={u.id}
                  icon="mail"
                  title={u.title}
                  note={[u.period, u.publishedAt ? `Sent ${dayMonth(u.publishedAt)}` : ''].filter(Boolean).join(' · ')}
                  onPress={() => router.push({ pathname: '/admissions/update', params: { id: u.id } })}
                />
              ))}
            </Group>
          </Columns>
          <ErrorNote error={done.error} />
          {viewing ? null : (
            <Actions>
              <Button
                title={`Message ${adviserFirst}`}
                icon="forum"
                onPress={() => openMessages(`Hello ${adviser === OFFICE_ADVISER ? '' : `${firstName(adviser)}, `}about ${firstName(studentName)}’s ${c.title}: `.replace('Hello about', 'Hello, about'))}
              />
            </Actions>
          )}
        </>
      ) : tab === 'documents' ? (
        <DocumentsPanel {...data} />
      ) : (
        <TimelinePanel {...data} />
      )}
    </Screen>
  );
}
