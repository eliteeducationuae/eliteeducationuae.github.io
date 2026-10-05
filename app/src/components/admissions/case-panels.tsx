import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useEnrolments, useInvoices, useLesson, useSettings } from '@/data/hooks';
import {
  invoicesForCase,
  KEY_DATE_KIND_LABELS,
  openTasks,
  overdueKeyDates,
  TARGET_STATUS_LABELS,
  TARGET_STATUS_ORDER,
  targetSummaryLine,
  upcomingKeyDates,
  type AdmissionsCase,
  type AdmissionsDocument,
  type AdmissionsEvent,
  type AdmissionsKeyDate,
  type AdmissionsKeyDateInput,
  type AdmissionsTarget,
  type AdmissionsTask,
  type AdvisoryUpdate,
} from '@/domain/admissions';
import { formatAED, invoiceTotals } from '@/domain/billing';
import { formatDay, formatTime, toDateKey } from '@/domain/dates';
import { enrolmentTitle } from '@/domain/enrolments';
import type { Profile, Student } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { shareAdvisoryUpdate } from '@/lib/advisory-update-pdf';

import { InvoiceCard } from '../billing';
import { Icon } from '../icon';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Row, Section, Txt } from '../ui';
import { DocumentList, DocumentUploader } from './document-list';
import { formatDateKey, targetStatusTone, type CaseTab } from './format';
import { KeyDateRow } from './key-date-row';
import { TaskRow } from './task-row';
import { CaseTimeline } from './timeline';
import { UpdateCard } from './update-card';

export interface CaseData {
  c: AdmissionsCase;
  me: Profile;
  student?: Student;
  studentName: string;
  adviser: string;
  targets: AdmissionsTarget[];
  dates: AdmissionsKeyDate[];
  tasks: AdmissionsTask[];
  documents: AdmissionsDocument[];
  updates: AdvisoryUpdate[];
  events: AdmissionsEvent[];
  now: Date;
  /** Admin, or this case's adviser. */
  manager: boolean;
  isAdmin: boolean;
  setTab: (t: CaseTab) => void;
}

/** A key date as a save input, e.g. to tick it off. */
export function keyDateInput(d: AdmissionsKeyDate): AdmissionsKeyDateInput {
  return {
    id: d.id,
    caseId: d.caseId,
    targetId: d.targetId ?? null,
    kind: d.kind,
    title: d.title,
    dueOn: d.dueOn,
    time: d.time ?? null,
    done: d.done,
    enrolmentId: d.enrolmentId ?? null,
    lessonId: d.lessonId ?? null,
    notes: d.notes,
  };
}

const published = (updates: AdvisoryUpdate[]) =>
  updates
    .filter((u) => u.status === 'published')
    .sort((a, b) => ((a.publishedAt ?? a.createdAt) < (b.publishedAt ?? b.createdAt) ? 1 : -1));

function useDownload(d: CaseData) {
  const settings = useSettings();
  return (u: AdvisoryUpdate) =>
    shareAdvisoryUpdate(
      u,
      d.c,
      { fullName: d.studentName },
      d.adviser,
      settings.data?.businessName ?? 'Elite Education',
      upcomingKeyDates(d.dates, d.now, 90),
      d.targets,
    );
}

const openUpdate = (u: AdvisoryUpdate) => router.push({ pathname: '/admissions/update', params: { id: u.id } });

function useToggleDate() {
  const save = useAction(source.saveAdmissionsKeyDate);
  return { save, toggle: (d: AdmissionsKeyDate) => save.mutate([{ ...keyDateInput(d), done: !d.done }]) };
}

function useToggleTask() {
  const done = useAction(source.setAdmissionsTaskDone);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toggle = async (t: AdmissionsTask) => {
    setBusyId(t.id);
    try {
      await done.mutateAsync([t.id, !t.doneAt]);
    } catch {
      // Shown below via done.error.
    } finally {
      setBusyId(null);
    }
  };
  return { done, busyId, toggle };
}

/** Families may complete only family tasks; the adviser and the office may complete any. */
function canTick(d: CaseData, t: AdmissionsTask): boolean {
  return d.manager || t.owner === 'family';
}

// ---------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------

export function OverviewPanel(d: CaseData) {
  const { c, dates, targets, tasks, now, manager } = d;
  const theme = useTheme();
  const tick = useToggleTask();
  const download = useDownload(d);
  const overdue = overdueKeyDates(dates, now);
  const upcoming = upcomingKeyDates(dates, now, 60);
  const soon = [...overdue, ...upcoming].slice(0, 5);
  const forFamily = openTasks(tasks, 'family');
  const latest = published(d.updates)[0];
  const prep = dates.filter((x) => (x.kind === 'test' || x.kind === 'interview') && !x.done).sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1));

  return (
    <>
      <Section
        title="Coming up"
        action={dates.length ? <Button title="All key dates" size="sm" variant="ghost" onPress={() => d.setTab('dates')} /> : undefined}>
        {soon.length ? (
          soon.map((x) => <KeyDateRow key={x.id} date={x} targets={targets} now={now} />)
        ) : (
          <Card>
            <Txt variant="muted">There are no deadlines in the next 60 days.</Txt>
          </Card>
        )}
      </Section>

      <Section
        title="Shortlist"
        action={<Button title={targets.length ? 'View shortlist' : manager ? 'Add institutions' : 'View'} size="sm" variant="ghost" onPress={() => d.setTab('targets')} />}>
        <Card style={{ gap: Spacing.one }}>
          <Txt>{targetSummaryLine(targets, c.kind)}</Txt>
          {targets.length ? (
            <Txt variant="muted">
              {[...targets]
                .sort((a, b) => a.sort - b.sort)
                .slice(0, 4)
                .map((t) => t.institution)
                .join(' · ')}
              {targets.length > 4 ? ` and ${targets.length - 4} more` : ''}
            </Txt>
          ) : null}
        </Card>
      </Section>

      <Section title={manager ? 'For the family' : 'For you'}>
        {forFamily.length ? (
          forFamily.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              targets={targets}
              now={now}
              busy={tick.busyId === t.id}
              onToggle={canTick(d, t) ? () => tick.toggle(t) : undefined}
            />
          ))
        ) : (
          <Card>
            <Txt variant="muted">{manager ? 'Nothing is waiting on the family.' : 'There is nothing for you to do at present. Thank you.'}</Txt>
          </Card>
        )}
        <ErrorNote error={tick.done.error} />
      </Section>

      {latest ? (
        <Section title="Latest update">
          <UpdateCard update={latest} highlight onRead={() => openUpdate(latest)} onDownload={() => download(latest)} />
        </Section>
      ) : null}

      {prep.length || manager ? (
        <Section title="Preparation">
          {prep.length ? (
            prep.map((x) => <PrepRow key={x.id} date={x} studentId={c.studentId} targets={targets} />)
          ) : (
            <Card>
              <Txt variant="muted">No entrance tests or interviews are planned yet.</Txt>
            </Card>
          )}
          {manager ? (
            <Button
              title="Schedule a preparation session"
              icon="calendar"
              variant="outline"
              onPress={() => router.push({ pathname: '/lesson/new', params: { studentId: c.studentId } })}
            />
          ) : null}
        </Section>
      ) : null}

      {d.isAdmin ? <BillingCard c={c} /> : null}

      {!manager && !latest && !soon.length && !forFamily.length ? (
        <Row gap={Spacing.two} style={{ justifyContent: 'center' }}>
          <Icon name="sparkle" size={14} color={theme.accent} />
          <Txt variant="small">Your adviser will share news here as the application progresses.</Txt>
        </Row>
      ) : null}
    </>
  );
}

/** A test or interview with the subject and lesson set aside to prepare for it. */
function PrepRow({ date, studentId, targets }: { date: AdmissionsKeyDate; studentId: string; targets: AdmissionsTarget[] }) {
  const theme = useTheme();
  const enrolments = useEnrolments(studentId);
  const lesson = useLesson(date.lessonId);
  const enrolment = date.enrolmentId ? enrolments.data?.find((e) => e.id === date.enrolmentId) : undefined;
  const target = date.targetId ? targets.find((t) => t.id === date.targetId) : undefined;
  const l = lesson.data;
  return (
    <Card style={{ gap: Spacing.one + 2 }}>
      <Txt variant="label">
        {KEY_DATE_KIND_LABELS[date.kind]} · {formatDateKey(date.dueOn)}
        {date.time ? ` at ${date.time}` : ''}
      </Txt>
      <Txt variant="h3">
        {date.title}
        {target ? ` · ${target.institution}` : ''}
      </Txt>
      {enrolment ? (
        <Row gap={Spacing.two}>
          <Icon name="book" size={15} color={theme.accent} />
          <Txt variant="muted" style={{ flex: 1 }}>
            Prepared in {enrolmentTitle(enrolment)} lessons
          </Txt>
        </Row>
      ) : null}
      {l ? (
        <Button
          title={`Preparation lesson: ${formatDay(l.start)}, ${formatTime(l.start)}`}
          size="sm"
          variant="secondary"
          icon="calendar"
          onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: l.id } })}
        />
      ) : null}
      {!enrolment && !l ? <Txt variant="small">No preparation lesson has been linked yet.</Txt> : null}
      {date.notes ? <Txt variant="small">{date.notes}</Txt> : null}
    </Card>
  );
}

function BillingCard({ c }: { c: AdmissionsCase }) {
  const invoices = useInvoices(c.familyId);
  const list = invoicesForCase(invoices.data ?? [], c.id);
  const totals = list.filter((i) => i.status !== 'void' && i.status !== 'draft').reduce(
    (acc, i) => {
      const t = invoiceTotals(i);
      return { billed: acc.billed + t.total, outstanding: acc.outstanding + (i.status === 'sent' ? t.balance : 0) };
    },
    { billed: 0, outstanding: 0 },
  );
  return (
    <Section title="Billing">
      <Card style={{ gap: Spacing.two }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ gap: 2 }}>
            <Txt variant="label">Advisory fees billed</Txt>
            <Txt variant="number">{formatAED(totals.billed)}</Txt>
          </View>
          {totals.outstanding > 0 ? <Badge label={`${formatAED(totals.outstanding)} outstanding`} tone="warning" /> : list.length ? <Badge label="Settled" tone="success" /> : null}
        </Row>
        <Txt variant="small">Only visible to the office.</Txt>
        <Button
          title="Bill advisory fee"
          icon="money"
          variant="outline"
          onPress={() => router.push({ pathname: '/admissions/bill', params: { caseId: c.id } })}
        />
      </Card>
      {list.map((inv) => (
        <InvoiceCard key={inv.id} invoice={inv} />
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Shortlist
// ---------------------------------------------------------------------------------------------

export function TargetsPanel(d: CaseData) {
  const { c, targets, manager } = d;
  const theme = useTheme();
  const sorted = [...targets].sort(
    (a, b) => TARGET_STATUS_ORDER.indexOf(a.status) - TARGET_STATUS_ORDER.indexOf(b.status) || a.sort - b.sort,
  );
  return (
    <>
      {manager ? (
        <Button title="Add institution" icon="plus" variant="gold" onPress={() => router.push({ pathname: '/admissions/target', params: { caseId: c.id } })} />
      ) : null}
      {sorted.length === 0 ? (
        <EmptyState icon="school" title="No shortlist yet" message={manager ? 'Add the schools or universities under consideration.' : 'Your adviser will add the shortlist here.'} />
      ) : (
        sorted.map((t) => (
          <Card
            key={t.id}
            onPress={manager ? () => router.push({ pathname: '/admissions/target', params: { caseId: c.id, id: t.id } }) : undefined}
            accessibilityLabel={t.institution}
            style={{ gap: Spacing.one + 2 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.two}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="h3">{t.institution}</Txt>
                <Txt variant="muted">{[t.programme, t.country, t.entryYear ? `Entry ${t.entryYear}` : ''].filter(Boolean).join(' · ')}</Txt>
              </View>
              <Badge label={TARGET_STATUS_LABELS[t.status]} tone={targetStatusTone(t.status)} />
            </Row>
            {t.requirements ? (
              <View style={{ gap: 2, borderLeftWidth: 1.5, borderLeftColor: theme.gold, paddingLeft: Spacing.two + 2 }}>
                <Txt variant="label">Entry requirements</Txt>
                <Txt variant="muted">{t.requirements}</Txt>
              </View>
            ) : null}
            {t.decisionDate ? <Txt variant="small">Decision expected {formatDateKey(t.decisionDate)}</Txt> : null}
            {t.notes ? <Txt variant="small">{t.notes}</Txt> : null}
          </Card>
        ))
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Key dates
// ---------------------------------------------------------------------------------------------

export function DatesPanel(d: CaseData) {
  const { c, dates, targets, now, manager } = d;
  const { save, toggle } = useToggleDate();
  const today = toDateKey(now);
  const ahead = dates.filter((x) => !x.done && x.dueOn >= today).sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
  const overdue = overdueKeyDates(dates, now);
  const past = dates.filter((x) => x.done).sort((a, b) => (a.dueOn < b.dueOn ? 1 : -1));
  const row = (x: AdmissionsKeyDate) => (
    <KeyDateRow
      key={x.id}
      date={x}
      targets={targets}
      now={now}
      onToggleDone={manager ? () => toggle(x) : undefined}
      onPress={manager ? () => router.push({ pathname: '/admissions/date', params: { caseId: c.id, id: x.id } }) : undefined}
    />
  );
  return (
    <>
      {manager ? (
        <Button title="Add a key date" icon="plus" variant="gold" onPress={() => router.push({ pathname: '/admissions/date', params: { caseId: c.id } })} />
      ) : null}
      <ErrorNote error={save.error} />
      {dates.length === 0 ? (
        <EmptyState icon="calendar" title="No key dates yet" message="Deadlines, entrance tests, interviews and open days will appear here, with reminders as each one approaches." />
      ) : null}
      {overdue.length ? <Section title="Overdue">{overdue.map(row)}</Section> : null}
      {ahead.length ? <Section title="Upcoming">{ahead.map(row)}</Section> : null}
      {past.length ? <Section title="Done">{past.map(row)}</Section> : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------

export function TasksPanel(d: CaseData) {
  const { c, tasks, targets, now, manager } = d;
  const tick = useToggleTask();
  const family = openTasks(tasks, 'family');
  const adviser = openTasks(tasks, 'adviser');
  const done = tasks.filter((t) => t.doneAt).sort((a, b) => ((a.doneAt ?? '') < (b.doneAt ?? '') ? 1 : -1));
  const row = (t: AdmissionsTask) => (
    <TaskRow
      key={t.id}
      task={t}
      targets={targets}
      now={now}
      busy={tick.busyId === t.id}
      onToggle={canTick(d, t) ? () => tick.toggle(t) : undefined}
      onPress={manager ? () => router.push({ pathname: '/admissions/task', params: { caseId: c.id, id: t.id } }) : undefined}
    />
  );
  return (
    <>
      {manager ? (
        <Button title="Add a task" icon="plus" variant="gold" onPress={() => router.push({ pathname: '/admissions/task', params: { caseId: c.id } })} />
      ) : null}
      <ErrorNote error={tick.done.error} />
      <Section title={manager ? 'For the family' : 'For you'}>
        {family.length ? family.map(row) : <Card><Txt variant="muted">Nothing outstanding.</Txt></Card>}
      </Section>
      <Section title={manager ? 'For the adviser' : 'Your adviser is working on'}>
        {adviser.length ? adviser.map(row) : <Card><Txt variant="muted">Nothing outstanding.</Txt></Card>}
      </Section>
      {done.length ? <Section title="Completed">{done.map(row)}</Section> : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------

export function DocumentsPanel(d: CaseData) {
  const { c, documents, manager, me } = d;
  return (
    <>
      <DocumentUploader caseId={c.id} isManager={manager} />
      {documents.length ? (
        <DocumentList documents={documents} showVisibility={manager} canDelete={(doc) => manager || (!!doc.uploadedBy && doc.uploadedBy === me.id)} />
      ) : (
        <EmptyState icon="folder" title="No documents yet" message="School reports, test results and personal statements shared for this application will be kept here, privately." />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------------------------

export function UpdatesPanel(d: CaseData) {
  const { c, updates, manager } = d;
  const download = useDownload(d);
  const list = manager
    ? [...updates].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    : published(updates);
  return (
    <>
      {manager ? (
        <Button title="Write an update" icon="sparkle" variant="gold" onPress={() => router.push({ pathname: '/admissions/update', params: { caseId: c.id } })} />
      ) : null}
      {list.length === 0 ? (
        <EmptyState
          icon="mail"
          title="No updates yet"
          message={manager ? 'Monthly updates are written by the adviser and approved by the office before they reach the family.' : 'Your adviser’s monthly updates will appear here.'}
        />
      ) : (
        list.map((u) => (
          <UpdateCard
            key={u.id}
            update={u}
            showStatus={manager}
            onRead={() => openUpdate(u)}
            onDownload={u.status === 'published' || manager ? () => download(u) : undefined}
          />
        ))
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------

export function TimelinePanel(d: CaseData) {
  const { c, events, dates, targets, now, manager } = d;
  const add = useAction(source.addAdmissionsMilestone);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [open, setOpen] = useState(false);
  const upcoming = upcomingKeyDates(dates, now, 60).slice(0, 3);
  return (
    <>
      {manager ? (
        open ? (
          <Card style={{ gap: Spacing.three }}>
            <Txt variant="h3">Add a milestone</Txt>
            <Field label="Milestone" value={title} onChangeText={setTitle} placeholder="For example, Personal statement finalised" maxLength={200} />
            <Field label="Detail (optional)" value={detail} onChangeText={setDetail} multiline maxLength={2000} />
            <Row gap={Spacing.two}>
              <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setOpen(false)} />
              <Button
                title="Add milestone"
                variant="gold"
                style={{ flex: 2 }}
                disabled={!title.trim()}
                loading={add.isPending}
                onPress={async () => {
                  await add.mutateAsync([c.id, title.trim(), detail.trim() || undefined]);
                  setTitle('');
                  setDetail('');
                  setOpen(false);
                }}
              />
            </Row>
            <ErrorNote error={add.error} />
          </Card>
        ) : (
          <Button title="Add a milestone" icon="plus" variant="outline" onPress={() => setOpen(true)} />
        )
      ) : null}
      {events.length || upcoming.length ? (
        <Card style={{ paddingVertical: Spacing.four }}>
          <CaseTimeline events={events} upcoming={upcoming} targets={targets} showPrivate={manager} />
        </Card>
      ) : (
        <EmptyState icon="clock" title="Nothing recorded yet" message="Each step of the application will be recorded here." />
      )}
    </>
  );
}
