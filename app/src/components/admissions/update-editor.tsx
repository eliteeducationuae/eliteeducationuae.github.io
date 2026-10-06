import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import {
  useAction,
  useAdmissionsCase,
  useAdmissionsEvents,
  useAdmissionsKeyDates,
  useAdmissionsTargets,
  useAdmissionsTasks,
  useAdvisoryUpdates,
  useLookup,
  useSettings,
} from '@/data/hooks';
import { useMe } from '@/data/session';
import {
  advisoryPeriodLabel,
  canManageCase,
  CASE_KIND_LABELS,
  sentForSameMonth,
  templateAdvisoryUpdate,
  typographic,
  UPDATE_KIND_LABELS,
  UPDATE_STATUS_LABELS,
  upcomingKeyDates,
  validateAdvisoryUpdateInput,
  type AdmissionsCase,
  type AdvisoryUpdate,
  type AdvisoryUpdateInput,
  type AdvisoryUpdateKind,
  type AdvisoryUpdateStatus,
} from '@/domain/admissions';
import { formatDate } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';
import { shareAdvisoryUpdate } from '@/lib/advisory-update-pdf';
import { confirm } from '@/lib/confirm';

import { Badge, Banner, Button, Card, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt } from '../ui';
import { Notice } from './notice';
import { adviserName, OFFICE_ADVISER, updateStatusTone } from './format';

/**
 * Write, review and send an advisory update, or read one that has been sent.
 * Advisers draft and submit; the office approves and sends to the family. A sent update is final.
 */
export function AdvisoryUpdateScreen({ caseId, update }: { caseId: string; update?: AdvisoryUpdate }) {
  const me = useMe();
  const c = useAdmissionsCase(caseId);
  const lookup = useLookup();
  if (c.isLoading || !lookup.ready) return <Loading />;
  if (!c.data) {
    return (
      <Screen>
        <EmptyState icon="mail" title="Update not found" message="This update may have been withdrawn, or it is not shared with you." />
      </Screen>
    );
  }
  const manager = canManageCase(me, c.data);
  if (!manager && !update) {
    return (
      <Screen>
        <EmptyState icon="mail" title="Update not found" />
      </Screen>
    );
  }
  if (manager && (!update || update.status !== 'published')) {
    return <Editor key={update ? `${update.id}:${update.status}` : 'new'} c={c.data} update={update} />;
  }
  return <Reader c={c.data} update={update!} manager={manager} />;
}

function useCaseFacts(c: AdmissionsCase) {
  const targets = useAdmissionsTargets(c.id);
  const dates = useAdmissionsKeyDates({ caseId: c.id });
  const tasks = useAdmissionsTasks(c.id);
  const events = useAdmissionsEvents(c.id);
  const lookup = useLookup();
  const settings = useSettings();
  return {
    loading: targets.isLoading || dates.isLoading || tasks.isLoading || events.isLoading,
    targets: targets.data ?? [],
    dates: dates.data ?? [],
    tasks: tasks.data ?? [],
    events: events.data ?? [],
    studentName: lookup.student(c.studentId)?.fullName ?? 'Student',
    adviser: adviserName(c, lookup),
    addressee: lookup.family(c.familyId)?.parentName,
    businessName: settings.data?.businessName ?? 'Elite Education',
  };
}

function useDownload(c: AdmissionsCase) {
  const facts = useCaseFacts(c);
  return (u: AdvisoryUpdate, now: Date) =>
    shareAdvisoryUpdate(u, c, { fullName: facts.studentName }, facts.adviser, facts.businessName, upcomingKeyDates(facts.dates, now, 90), facts.targets);
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

function Reader({ c, update, manager }: { c: AdmissionsCase; update: AdvisoryUpdate; manager: boolean }) {
  const theme = useTheme();
  const facts = useCaseFacts(c);
  const download = useDownload(c);
  const [now] = useState(() => new Date());
  const paragraphs = typographic(update.body).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <Screen footer={<Button title="Download PDF" icon="share" variant="gold" style={{ flex: 1 }} onPress={() => download(update, now)} />}>
      <Stack.Screen options={{ title: UPDATE_KIND_LABELS[update.kind] }} />
      <Card style={{ gap: Spacing.three, padding: Spacing.four }}>
        <View style={{ gap: Spacing.one }}>
          <Txt variant="label">
            {[facts.studentName, CASE_KIND_LABELS[c.kind], update.period].filter(Boolean).join(' · ')}
          </Txt>
          <Txt variant="title" style={{ fontSize: 26, lineHeight: 33 }} accessibilityRole="header">
            {typographic(update.title)}
          </Txt>
          <View style={[styles.rule, { backgroundColor: theme.gold }]} />
          <Txt variant="small">
            {[
              update.publishedAt ? `Sent ${formatDate(update.publishedAt)}` : '',
              // The family hears from their adviser (or the office), whoever drafted the update.
              manager && update.authorName ? `Written by ${update.authorName}` : facts.adviser === OFFICE_ADVISER ? 'Elite Education' : `From ${facts.adviser}, your adviser`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Txt>
        </View>
        {paragraphs.map((p, i) => (
          <Txt key={i} style={{ lineHeight: 25 }}>
            {p}
          </Txt>
        ))}
        <Txt variant="small" style={{ marginTop: Spacing.two }}>
          Elite Education | eliteeducation.me
        </Txt>
      </Card>
      {manager ? <Notice icon="check">This update has been sent to the family and can no longer be changed.</Notice> : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

function Editor({ c, update }: { c: AdmissionsCase; update?: AdvisoryUpdate }) {
  const me = useMe();
  const facts = useCaseFacts(c);
  const download = useDownload(c);
  const save = useAction(source.saveAdvisoryUpdate);
  const setStatus = useAction(source.setAdvisoryUpdateStatus);
  const remove = useAction(source.deleteAdvisoryUpdate);
  const caseUpdates = useAdvisoryUpdates(c.id);
  const [now] = useState(() => new Date());
  const [kind, setKind] = useState<AdvisoryUpdateKind>(update?.kind ?? 'monthly');
  const [period, setPeriod] = useState(update?.period ?? advisoryPeriodLabel(now));
  const [title, setTitle] = useState(update?.title ?? '');
  const [body, setBody] = useState(update?.body ?? '');
  const [notes, setNotes] = useState('');
  const [aiAssisted, setAiAssisted] = useState(update?.aiAssisted ?? false);
  const [drafting, setDrafting] = useState(false);
  const [draftSource, setDraftSource] = useState<'ai' | 'template' | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const isAdmin = me.role === 'admin';
  const status: AdvisoryUpdateStatus = update?.status ?? 'draft';
  // An approved update is with the office: the adviser may read it but no longer change it.
  const editable = isAdmin || status === 'draft' || status === 'submitted';
  const busy = save.isPending || setStatus.isPending || remove.isPending;

  const input = (): AdvisoryUpdateInput => ({
    id: update?.id,
    caseId: c.id,
    kind,
    title: title.trim(),
    period: period.trim() || undefined,
    body: body.trim(),
    aiAssisted,
  });

  /** Save, then return the saved update (a new one is opened at its own address afterwards). */
  async function persist(): Promise<AdvisoryUpdate | null> {
    const i = input();
    const invalid = validateAdvisoryUpdateInput(i) ?? (i.body ? null : 'Please write the update.');
    setValidation(invalid);
    if (invalid) return null;
    return save.mutateAsync([i]);
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    }
  }

  const saveDraft = () =>
    run(async () => {
      const saved = await persist();
      if (saved && !update) router.replace({ pathname: '/admissions/update', params: { id: saved.id } });
    });

  const moveTo = (next: AdvisoryUpdateStatus) =>
    run(async () => {
      const saved = editable ? await persist() : (update ?? null);
      if (!saved) return;
      await setStatus.mutateAsync([saved.id, next]);
      if (!update) router.replace({ pathname: '/admissions/update', params: { id: saved.id } });
    });

  const publish = () => {
    // A second monthly letter for the same month reads like a duplicate to the family, so the office is asked first.
    const earlier = sentForSameMonth(caseUpdates.data ?? [], { id: update?.id, kind, period });
    if (earlier) {
      confirm(
        `An update for ${period.trim()} has already been sent`,
        `The family received “${earlier.title}” on ${formatDate(earlier.publishedAt ?? earlier.createdAt)}. Send this one as well? If it adds to that letter, you may prefer to choose Other update instead of Monthly update.`,
        () => moveTo('published'),
        'Send anyway',
      );
      return;
    }
    confirm('Send this update to the family?', 'The family will be notified, and the update can no longer be changed.', () => moveTo('published'), 'Send');
  };

  async function draft() {
    setDrafting(true);
    setError(null);
    try {
      const ai = await source
        .aiAssist?.({
          task: 'admissions-update',
          caseId: c.id,
          kind,
          period: period.trim() || undefined,
          notes: notes.trim() || undefined,
          addressee: facts.addressee,
          adviser: c.adviserTutorId ? facts.adviser : undefined,
        }).catch(() => null);
      const usedAi = !!ai && ai.task === 'admissions-update';
      const d =
        ai && ai.task === 'admissions-update'
          ? ai
          : templateAdvisoryUpdate({
              studentName: facts.studentName.split(' ')[0],
              kind,
              period: period.trim() || undefined,
              targets: facts.targets,
              dates: facts.dates,
              tasks: facts.tasks,
              events: facts.events,
              now,
              caseKind: c.kind,
              addressee: facts.addressee,
              adviser: facts.adviser,
            });
      setTitle(d.title);
      setBody(d.body);
      setDraftSource(usedAi ? 'ai' : 'template');
      if (usedAi) setAiAssisted(true);
    } catch (err) {
      setError(err);
    } finally {
      setDrafting(false);
    }
  }

  const runDraft = () =>
    title.trim() || body.trim() ? confirm('Replace what you have written?', 'The draft will replace the title and the update below.', draft, 'Replace') : draft();

  const preview = () => {
    const i = input();
    const draftUpdate: AdvisoryUpdate = {
      id: update?.id ?? 'preview',
      caseId: c.id,
      kind,
      title: i.title || 'Advisory update',
      period: i.period,
      body: i.body,
      status,
      aiAssisted,
      authorName: update?.authorName ?? me.fullName,
      createdAt: update?.createdAt ?? now.toISOString(),
      submittedAt: update?.submittedAt,
      approvedAt: update?.approvedAt,
    };
    download(draftUpdate, now);
  };

  const deleteDraft = () =>
    confirm('Delete this draft?', 'The update will be removed. This cannot be undone.', () =>
      run(async () => {
        if (update) await remove.mutateAsync([update.id]);
        router.back();
      }),
    'Delete');

  // Footer: the next step for this role and status.
  let primary: { title: string; onPress: () => void } | null = null;
  let secondary: { title: string; onPress: () => void } | null = null;
  if (isAdmin) {
    if (status === 'approved') {
      primary = { title: 'Send to family', onPress: publish };
      secondary = { title: 'Save', onPress: saveDraft };
    } else {
      primary = { title: 'Approve', onPress: () => moveTo('approved') };
      secondary = { title: 'Save draft', onPress: saveDraft };
    }
  } else if (status === 'draft') {
    primary = { title: 'Submit for approval', onPress: () => moveTo('submitted') };
    secondary = { title: 'Save draft', onPress: saveDraft };
  } else if (status === 'submitted') {
    primary = { title: 'Save changes', onPress: saveDraft };
  }

  const footer = primary ? (
    <Row gap={Spacing.two} style={{ flex: 1 }}>
      {secondary ? <Button title={secondary.title} variant="secondary" style={{ flex: 1 }} disabled={busy} onPress={secondary.onPress} /> : null}
      <Button title={primary.title} variant="gold" icon={primary.title === 'Send to family' ? 'check' : undefined} style={{ flex: 2 }} loading={busy} onPress={primary.onPress} />
    </Row>
  ) : undefined;

  return (
    <Screen footer={footer}>
      <Stack.Screen options={{ title: update ? 'Advisory update' : 'Write an update' }} />
      <Card style={{ gap: Spacing.one }}>
        {/* The badge shares a row with the small label only, so the student's name keeps the full width on a phone. */}
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }} gap={Spacing.two} wrap>
          <Txt variant="label" style={{ flexShrink: 1 }}>
            {CASE_KIND_LABELS[c.kind]}
          </Txt>
          <Badge label={UPDATE_STATUS_LABELS[status]} tone={updateStatusTone(status)} />
        </Row>
        <Txt variant="h2">{facts.studentName}</Txt>
        <Txt variant="muted">{c.title}</Txt>
        {update?.authorName ? <Txt variant="small">Written by {update.authorName}</Txt> : null}
      </Card>

      {status === 'submitted' && isAdmin ? (
        <Notice icon="sparkle">Please read the update through. Approve it, then send it to the family when you are ready.</Notice>
      ) : status === 'submitted' ? (
        <Notice icon="clock">Submitted for approval. The office will review it before it is sent to the family.</Notice>
      ) : status === 'approved' && !isAdmin ? (
        <Notice icon="check">Approved by the office. It will be sent to the family shortly.</Notice>
      ) : null}

      {editable ? (
        <>
          <Segmented<AdvisoryUpdateKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'monthly', label: 'Monthly update' },
              { value: 'ad-hoc', label: 'Other update' },
            ]}
          />
          <Section title="Draft">
            <Card style={{ gap: Spacing.three }}>
              <Field
                label="Notes for the draft (optional)"
                value={notes}
                onChangeText={setNotes}
                multiline
                maxLength={4000}
                placeholder="A few private bullet points: progress, concerns, what comes next."
                hint="Used only to prepare the draft. Not saved and never shown to the family."
              />
              <Button title={drafting ? 'Drafting…' : 'Draft for me'} icon="sparkle" variant="gold" loading={drafting} disabled={facts.loading} onPress={runDraft} />
              {draftSource === 'ai' ? (
                <Notice icon="sparkle">Drafted with AI — please review before sending.</Notice>
              ) : draftSource === 'template' ? (
                <Notice icon="sparkle">Drafted from a template using the case’s shortlist, key dates and tasks. Please read it through and make it your own.</Notice>
              ) : (
                <Txt variant="muted">We will prepare a draft from the shortlist, key dates and tasks on this case, and your notes.</Txt>
              )}
            </Card>
          </Section>
          <Section title="Update">
            <Card style={{ gap: Spacing.three }}>
              {kind === 'monthly' ? <Field label="Period" value={period} onChangeText={setPeriod} maxLength={60} /> : null}
              <Field label="Title" value={title} onChangeText={setTitle} maxLength={200} placeholder="For example, October 2026 advisory update" />
              <Field label="Update" value={body} onChangeText={setBody} multiline maxLength={12000} style={{ minHeight: 260 }} placeholder="Dear family, …" />
            </Card>
          </Section>
        </>
      ) : (
        <Card style={{ gap: Spacing.three }}>
          <Txt variant="h2">{title}</Txt>
          {body.split(/\n{2,}/).map((p, i) => (
            <Txt key={i}>{p}</Txt>
          ))}
        </Card>
      )}

      {validation ? (
        <Banner tone="warning" icon="alert">
          {validation}
        </Banner>
      ) : null}
      <ErrorNote error={error ?? save.error ?? setStatus.error ?? remove.error} />

      <Row gap={Spacing.two} wrap>
        <Button title="Preview PDF" icon="share" variant="outline" size="sm" onPress={preview} />
        {status === 'submitted' || (status === 'approved' && isAdmin) ? (
          <Button title="Return to draft" variant="ghost" size="sm" disabled={busy} onPress={() => moveTo('draft')} />
        ) : null}
        {update && (status === 'draft' || isAdmin) ? <Button title="Delete draft" variant="ghost" size="sm" disabled={busy} onPress={deleteDraft} /> : null}
      </Row>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rule: { width: 28, height: 2 },
});
