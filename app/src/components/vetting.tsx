import * as Linking from 'expo-linking';
import { router, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useTutorCompliance, useTutors } from '@/data/hooks';
import { useMe } from '@/data/session';
import type { TutorCompliance, TutorDocument, TutorDocumentType, VettingStatus } from '@/domain/types';
import {
  blockedReasonPhrase,
  canAssignTutor,
  describeDateInput,
  DOCUMENT_TYPES,
  documentState,
  documentTypeLabel,
  formatLongDate,
  isCleared,
  maskDateInput,
  needsAttention,
  onboardingChecklist,
  onboardingProgress,
  validateDocumentDates,
  vettingSummary,
  type ChecklistKey,
  type DocumentState,
} from '@/domain/vetting';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/confirm';

import { pickFile } from './file-pick';
import { Icon } from './icon';
import { Badge, Banner, Button, Card, Chip, ErrorNote, Field, ListItem, ProgressBar, Row, Txt, type Tone } from './ui';
import type { PickedFile } from '@/data/source';

// ---------------------------------------------------------------------------
// Labels and tones
// ---------------------------------------------------------------------------

export const VETTING_TONE: Record<VettingStatus, { label: string; tone: Tone }> = {
  cleared: { label: 'Cleared', tone: 'success' },
  expiring: { label: 'Expiring soon', tone: 'warning' },
  pending: { label: 'Awaiting review', tone: 'info' },
  expired: { label: 'Expired', tone: 'danger' },
  missing: { label: 'Clearance missing', tone: 'danger' },
};

export const DOC_STATE_TONE: Record<DocumentState, { label: string; tone: Tone }> = {
  pending: { label: 'Awaiting review', tone: 'info' },
  verified: { label: 'Verified', tone: 'success' },
  expiring: { label: 'Expiring soon', tone: 'warning' },
  expired: { label: 'Expired', tone: 'danger' },
  rejected: { label: 'Not accepted', tone: 'danger' },
};

/** How a tutor's clearance reads inside a sentence, e.g. 'This tutor’s police clearance is missing.' */
export const VETTING_PHRASE: Record<VettingStatus, string> = {
  cleared: 'verified',
  expiring: 'expiring soon',
  pending: 'awaiting review',
  expired: 'expired',
  missing: 'missing',
};

/** Today's date, fixed for the life of the component (render stays pure). */
export function useToday(): Date {
  const [today] = useState(() => new Date());
  return today;
}

/** The compliance row for one tutor (admins see every tutor, a tutor sees their own). */
export function useComplianceFor(tutorId: string | null | undefined): { compliance?: TutorCompliance; isLoading: boolean } {
  const all = useTutorCompliance();
  return { compliance: tutorId ? all.data?.find((c) => c.tutorId === tutorId) : undefined, isLoading: all.isLoading };
}

export function VettingBadge({ status }: { status: VettingStatus }) {
  const t = VETTING_TONE[status];
  return <Badge label={t.label} tone={t.tone} />;
}

export async function openVettingFile(path: string) {
  const url = source.fileUrl ? await source.fileUrl('vetting', path) : null;
  if (url) Linking.openURL(url);
  else notify('Document', 'This file cannot be opened here. Files uploaded in demo mode are not stored.');
}

// ---------------------------------------------------------------------------
// Onboarding checklist
// ---------------------------------------------------------------------------

const CHECKLIST_LINKS: Record<ChecklistKey, Href> = {
  clearance: '/checks',
  bank: '/payment-details',
  availability: '/availability',
  // The Google Calendar and WhatsApp cards live on the tutor's Me page (AccountScreen).
  calendar: '/tutor/account',
  whatsapp: '/tutor/account',
  handbook: '/handbook',
};

export function OnboardingChecklist({
  compliance,
  today,
  links,
  unlinked = [],
}: {
  compliance: TutorCompliance;
  today: Date;
  links?: boolean;
  /** Steps not to link, e.g. those whose card is already on the current page. */
  unlinked?: ChecklistKey[];
}) {
  const theme = useTheme();
  const items = onboardingChecklist(compliance, today);
  const progress = onboardingProgress(items);
  return (
    <View style={{ gap: Spacing.two }}>
      <View style={{ gap: Spacing.one }}>
        <Txt variant="small">
          {progress.done} of {progress.total} complete
        </Txt>
        <ProgressBar value={(progress.done / Math.max(progress.total, 1)) * 100} color={progress.complete ? theme.success : undefined} />
      </View>
      {items.map((item) => {
        const body = (
          <Row gap={Spacing.two} style={{ alignItems: 'flex-start', paddingVertical: 4 }}>
            <Icon name={item.done ? 'check' : 'circle'} size={20} color={item.done ? theme.success : theme.textMuted} />
            <View style={{ flex: 1, gap: 2 }}>
              <Row gap={Spacing.two} wrap>
                <Txt style={{ flexShrink: 1 }}>{item.label}</Txt>
                {item.optional ? <Badge label="Optional" /> : null}
              </Row>
              {item.detail ? <Txt variant="small">{item.detail}</Txt> : null}
            </View>
            {links && !item.done && !unlinked.includes(item.key) ? <Icon name="chevron" size={16} color={theme.textMuted} /> : null}
          </Row>
        );
        const spoken = `${item.label}${item.optional ? ', optional' : ''}, ${item.done ? 'complete' : 'to do'}`;
        if (!links || item.done || unlinked.includes(item.key)) {
          return (
            <View key={item.key} accessible accessibilityRole="checkbox" accessibilityState={{ checked: item.done }} accessibilityLabel={spoken}>
              {body}
            </View>
          );
        }
        return (
          <Pressable
            key={item.key}
            accessibilityRole="link"
            accessibilityLabel={spoken}
            accessibilityHint="Opens the page to complete this step"
            onPress={() => router.navigate(CHECKLIST_LINKS[item.key])}
            style={({ pressed }) => pressed && { opacity: 0.7 }}>
            {body}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The tutor's onboarding on their Me page. Hidden once complete, unless the clearance is expiring or expired. */
export function OnboardingCard({ compliance }: { compliance?: TutorCompliance }) {
  const me = useMe();
  const today = useToday();
  const own = useComplianceFor(me.tutorId);
  const c = compliance ?? own.compliance;
  if (!c) return null;
  const progress = onboardingProgress(onboardingChecklist(c, today));
  const clearanceAlert = c.vettingStatus === 'expiring' || c.vettingStatus === 'expired';
  if (progress.complete && !clearanceAlert) return null;
  return (
    <Card style={{ gap: Spacing.three }}>
      <Row style={{ justifyContent: 'space-between' }} wrap>
        <Txt variant="h2">{progress.complete ? 'Your police clearance' : 'Your onboarding'}</Txt>
        <VettingBadge status={c.vettingStatus} />
      </Row>
      {progress.complete ? (
        <Txt variant="muted">{vettingSummary(c, today)}. Please upload your renewed certificate so that we can continue to assign you lessons.</Txt>
      ) : (
        <Txt variant="muted">Please complete these steps so that we can assign you lessons and pay you promptly.</Txt>
      )}
      {/* The Google Calendar and WhatsApp cards are further down this page, so those steps are not links here. */}
      <OnboardingChecklist compliance={c} today={today} links unlinked={['calendar', 'whatsapp']} />
      <Button title="My checks and documents" variant="outline" size="sm" icon="doc" onPress={() => router.push('/checks')} />
    </Card>
  );
}

/** A compact vetting summary for admin tutor pages, linking to the full checks page. */
export function TutorChecksSummary({ tutorId }: { tutorId: string }) {
  const today = useToday();
  const { compliance: c, isLoading } = useComplianceFor(tutorId);
  if (isLoading) return null;
  const open = () => router.push({ pathname: '/manage/vetting/[tutorId]', params: { tutorId } });
  if (!c) {
    return (
      <Card style={{ gap: Spacing.two }}>
        <Txt variant="h3">Tutor checks</Txt>
        <Txt variant="muted">Police clearance and onboarding will appear here once the tutor profile is saved.</Txt>
        <Button title="Open tutor checks" variant="outline" size="sm" onPress={open} />
      </Card>
    );
  }
  const progress = onboardingProgress(onboardingChecklist(c, today));
  return (
    <Card style={{ gap: Spacing.two }}>
      <Row style={{ justifyContent: 'space-between' }} wrap>
        <Txt variant="h3">Tutor checks</Txt>
        <VettingBadge status={c.vettingStatus} />
      </Row>
      <Txt variant="muted">{vettingSummary(c, today)}</Txt>
      <Txt variant="small">
        {progress.done} of {progress.total} onboarding steps complete
        {c.documentsPending ? ` · ${c.documentsPending} ${c.documentsPending === 1 ? 'document' : 'documents'} awaiting review` : ''}
      </Txt>
      <ProgressBar value={(progress.done / Math.max(progress.total, 1)) * 100} />
      <Button title="Open tutor checks" icon="check" variant="outline" size="sm" onPress={open} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Overrides and assignment warnings
// ---------------------------------------------------------------------------

const OVERRIDE_DAYS = [7, 30, 90] as const;

export function OverrideForm({ tutorId, tutorName, onDone }: { tutorId: string; tutorName: string; onDone?: () => void }) {
  const grant = useAction(source.grantVettingOverride);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<number>(30);
  const short = reason.trim().length < 10;
  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">Record an override for {tutorName}</Txt>
      <Txt variant="muted">
        An override allows new lessons, students and roles to be assigned before the police clearance is verified. Existing lessons are unaffected.
      </Txt>
      <Field
        label="Reason"
        value={reason}
        onChangeText={setReason}
        multiline
        placeholder="For example, certificate seen in person; the upload will follow this week."
        hint="At least 10 characters. The reason is recorded with your name and the time."
      />
      <View style={{ gap: Spacing.one }}>
        <Txt variant="label">Duration</Txt>
        <Row gap={Spacing.one} wrap>
          {OVERRIDE_DAYS.map((d) => (
            <Chip key={d} label={`${d} days`} selected={days === d} onPress={() => setDays(d)} />
          ))}
        </Row>
      </View>
      <ErrorNote error={grant.error} />
      <Button
        title="Record override"
        variant="gold"
        disabled={short}
        loading={grant.isPending}
        onPress={async () => {
          const ok = await grant.mutateAsync([tutorId, reason.trim(), days]).then(
            () => true,
            () => false, // shown from grant.error
          );
          if (!ok) return;
          setReason('');
          notify('Override recorded', `${tutorName} can be assigned new work for the next ${days} days.`);
          onDone?.();
        }}
      />
    </Card>
  );
}

/**
 * Shown before assigning work to a tutor. Blocked: a danger banner, and admins can reveal the override form.
 * Overridden: an info banner with the reason. Not enforced but not cleared, or expiring soon: a gentle warning.
 */
export function VettingWarning({
  tutorId,
  action,
  expanded,
  checksLink,
}: {
  tutorId: string;
  action: 'lesson' | 'enrolment' | 'role';
  /** Open the override form straight away, e.g. after the server refused the assignment. */
  expanded?: boolean;
  /** Offer admins a link to the tutor's checks as well, e.g. from the student editor. */
  checksLink?: boolean;
}) {
  const me = useMe();
  const today = useToday();
  const tutors = useTutors();
  const { compliance: c } = useComplianceFor(tutorId);
  const [open, setOpen] = useState(false);
  if (!c) return null;
  const name = tutors.data?.find((t) => t.id === tutorId)?.fullName ?? 'This tutor';
  const verdict = canAssignTutor(c, today);
  const what = action === 'lesson' ? 'new lessons' : action === 'enrolment' ? 'new students' : 'new roles';
  const checks =
    checksLink && me.role === 'admin' ? (
      <>
        {' '}
        <Txt
          variant="muted"
          color="accent"
          accessibilityRole="link"
          onPress={() => router.push({ pathname: '/manage/vetting/[tutorId]', params: { tutorId } })}>
          Record their checks
        </Txt>
      </>
    ) : null;
  if (!verdict.allowed) {
    const showForm = me.role === 'admin' && (open || expanded);
    return (
      <View style={{ gap: Spacing.two }}>
        <Banner tone="danger" icon="alert">
          {name} cannot be assigned {what} until their police clearance has been verified; {blockedReasonPhrase(c)}.
          {checks}
          {me.role === 'admin' && !showForm ? (
            <>
              {checks ? ' · ' : ' '}
              <Txt variant="muted" color="accent" accessibilityRole="link" onPress={() => setOpen(true)}>
                Record an override
              </Txt>
            </>
          ) : null}
        </Banner>
        {showForm ? <OverrideForm tutorId={tutorId} tutorName={name} onDone={() => setOpen(false)} /> : null}
      </View>
    );
  }
  if (!c.enforced && notCleared(c)) {
    return (
      <Banner tone="warning" icon="alert">
        {name}’s police clearance is {VETTING_PHRASE[c.vettingStatus]}. Police clearance is not enforced at present, so they can still be assigned {what}, but we
        recommend verifying their certificate first.
        {checks}
      </Banner>
    );
  }
  if (verdict.overridden && c.override) {
    return (
      <Banner tone="info" icon="alert">
        Override in place until {formatLongDate(c.override.until)}: {c.override.reason}
      </Banner>
    );
  }
  if (c.vettingStatus === 'expiring') {
    return (
      <Banner tone="warning" icon="clock">
        {name}’s police clearance {vettingSummary(c, today).replace(/^E/, 'e')}. They can still be assigned {what}, but a renewed certificate is needed before then.
      </Banner>
    );
  }
  return null;
}

function attentionLine(c: TutorCompliance, today: Date): string {
  switch (c.vettingStatus) {
    case 'missing':
      return 'police clearance missing';
    case 'pending':
      return 'police clearance awaiting review';
    case 'expired':
      return 'police clearance expired';
    case 'expiring':
      return vettingSummary(c, today).split(' · ')[0].replace(/^E/, 'e');
    case 'cleared':
      return c.documentsPending === 1 ? 'a document awaiting review' : `${c.documentsPending} documents awaiting review`;
  }
}

/** Tutors whose checks need the office's attention (for the dashboard sum and the More badge). */
export function useTutorChecksCount(): number {
  const all = useTutorCompliance();
  return needsAttention(all.data ?? []).length;
}

/** The first 'Needs attention' row on the admin dashboard. */
export function TutorChecksRow() {
  const theme = useTheme();
  const today = useToday();
  const all = useTutorCompliance();
  const tutors = useTutors();
  const list = needsAttention(all.data ?? []);
  if (!list.length) return null;
  const name = (id: string) => tutors.data?.find((t) => t.id === id)?.fullName ?? 'A tutor';
  return (
    <ListItem
      title={list.length === 1 ? '1 tutor check to review' : `${list.length} tutor checks to review`}
      subtitle={list.map((c) => `${name(c.tutorId)}: ${attentionLine(c, today)}`).join(' · ')}
      left={<Icon name="alert" size={22} color={theme.warning} />}
      onPress={() => router.push('/manage/vetting')}
    />
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** One uploaded document: type, file, dates, review state, and View/Remove actions. */
export function DocumentRow({ doc, today, canRemove, children }: { doc: TutorDocument; today: Date; canRemove?: boolean; children?: ReactNode }) {
  const remove = useAction(source.deleteTutorDocument);
  const state = DOC_STATE_TONE[documentState(doc, today)];
  const dates = [doc.issueDate ? `Issued ${formatLongDate(doc.issueDate)}` : null, doc.expiryDate ? `Expires ${formatLongDate(doc.expiryDate)}` : null].filter(Boolean).join(' · ');
  const removable = canRemove && (doc.status === 'pending' || doc.status === 'rejected');
  return (
    <Card style={{ gap: Spacing.two }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.two}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{doc.type === 'other' && doc.title ? doc.title : documentTypeLabel(doc.type)}</Txt>
          <Txt variant="small">{doc.fileName ?? doc.filePath.split('/').pop()}</Txt>
          {dates ? <Txt variant="muted">{dates}</Txt> : null}
          {doc.status === 'verified' && doc.verifiedAt ? (
            <Txt variant="small">
              Verified {formatLongDate(doc.verifiedAt)}
              {doc.verifiedByName ? ` by ${doc.verifiedByName}` : ''}
            </Txt>
          ) : null}
        </View>
        <Badge label={state.label} tone={state.tone} />
      </Row>
      {doc.status === 'rejected' && doc.reviewNote ? <Banner tone="danger" icon="alert">{doc.reviewNote}</Banner> : null}
      <Row gap={Spacing.two} wrap>
        <Button title="View" icon="doc" size="sm" variant="secondary" onPress={() => openVettingFile(doc.filePath)} />
        {removable ? (
          <Button
            title="Remove"
            size="sm"
            variant="ghost"
            loading={remove.isPending}
            onPress={() => confirm('Remove this document?', 'The file will be deleted. You can upload a new one at any time.', () => remove.mutate([doc.id]), 'Remove')}
          />
        ) : null}
      </Row>
      <ErrorNote error={remove.error} />
      {children}
    </Card>
  );
}

/** Upload a vetting document for a tutor (the tutor themselves, or an admin on their behalf). */
export function DocumentUploadCard({ tutorId, onBehalf }: { tutorId: string; onBehalf?: boolean }) {
  const today = useToday();
  const tutors = useTutors();
  const tutorFirstName = tutors.data?.find((t) => t.id === tutorId)?.fullName.split(' ')[0];
  const submit = useAction(source.submitTutorDocument);
  const [type, setType] = useState<TutorDocumentType>('police_clearance');
  const [title, setTitle] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const needsExpiry = DOCUMENT_TYPES.find((d) => d.type === type)?.needsExpiry;

  async function send() {
    const problem =
      validateDocumentDates({ type, issueDate, expiryDate }, today) ??
      (!file ? 'Please choose the file to upload.' : type === 'other' && !title.trim() ? 'Please give the document a title.' : null);
    setError(problem);
    if (problem || !file) return;
    setUploading(true);
    let uploaded: string | null = null;
    try {
      const folder = `tutors/${tutorId}`;
      const filePath = source.uploadFile ? await source.uploadFile('vetting', folder, file) : `${folder}/${file.name}`;
      if (source.uploadFile) uploaded = filePath;
      await submit.mutateAsync([
        {
          tutorId,
          type,
          filePath,
          fileName: file.name,
          title: type === 'other' ? title.trim() : undefined,
          issueDate: issueDate.trim() || undefined,
          expiryDate: expiryDate.trim() || undefined,
        },
      ]);
      notify('Thank you', onBehalf ? 'The document has been recorded and is ready to review.' : 'We will review your document shortly and let you know once it has been verified.');
      setFile(null);
      setTitle('');
      setIssueDate('');
      setExpiryDate('');
      setType('police_clearance');
    } catch (e) {
      // The file reached storage but was not recorded: remove it so no orphan is left in the private bucket.
      if (uploaded && source.removeFile) await source.removeFile('vetting', uploaded).catch(() => undefined);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">{onBehalf ? 'Upload on their behalf' : 'Upload a document'}</Txt>
      <View style={{ gap: Spacing.one }}>
        <Txt variant="label">Type of document</Txt>
        <Row gap={Spacing.one} wrap>
          {DOCUMENT_TYPES.map((d) => (
            <Chip key={d.type} label={d.label} selected={type === d.type} onPress={() => setType(d.type)} />
          ))}
        </Row>
      </View>
      {type === 'other' ? <Field label="Title" value={title} onChangeText={setTitle} placeholder="For example, first aid certificate" /> : null}
      <Row gap={Spacing.two} wrap style={{ alignItems: 'flex-start' }}>
        <View style={{ flexGrow: 1, flexBasis: 140 }}>
          <DateKeyField
            label="Issue date"
            value={issueDate}
            onChange={(v) => {
              setIssueDate(v);
              setError(null);
            }}
          />
        </View>
        <View style={{ flexGrow: 1, flexBasis: 140 }}>
          <DateKeyField
            label={needsExpiry ? 'Expiry date' : 'Expiry date (optional)'}
            value={expiryDate}
            onChange={(v) => {
              setExpiryDate(v);
              setError(null);
            }}
          />
        </View>
      </Row>
      <Row gap={Spacing.two} wrap>
        <Button
          title={file ? 'Choose another file' : 'Choose file'}
          icon="attach"
          size="sm"
          variant="secondary"
          onPress={async () => {
            const picked = await pickFile(['application/pdf', 'image/*']);
            if (picked) setFile(picked);
          }}
        />
        {file ? (
          <Txt variant="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {file.name}
          </Txt>
        ) : (
          <Txt variant="small">PDF or photo</Txt>
        )}
      </Row>
      {error ? <Banner tone="danger" icon="alert">{error}</Banner> : null}
      <Button title="Submit for review" variant="gold" loading={uploading} onPress={send} />
      <Txt variant="small">
        {onBehalf
          ? `Documents are private. Only ${tutorFirstName ?? 'the tutor'} and the Elite Education office can see them.`
          : 'Your documents are private. Only you and the Elite Education office can see them.'}
      </Txt>
    </Card>
  );
}

/** True when the tutor may not take new work right now (for chip suffixes and badges). */
export function notCleared(c: TutorCompliance | undefined): boolean {
  return !!c && !isCleared(c.vettingStatus);
}

/** Compliance rows by tutor id (empty for viewers who cannot see them). */
export function useComplianceMap(): Map<string, TutorCompliance> {
  const all = useTutorCompliance();
  return new Map((all.data ?? []).map((c) => [c.tutorId, c]));
}

/** A tutor chip label with a short suffix when their checks are not complete, e.g. 'James Wilson · checks needed'. */
export function tutorChipLabel(name: string, c: TutorCompliance | undefined): string {
  return notCleared(c) ? `${name} · checks needed` : name;
}

/** On a scheduled lesson (admin and the lesson's tutor): the lesson stands, but new work waits for clearance. */
export function LessonVettingNote({ tutorId }: { tutorId: string }) {
  const me = useMe();
  const today = useToday();
  const { compliance: c } = useComplianceFor(tutorId);
  if (!c || !notCleared(c)) return null;
  const verdict = canAssignTutor(c, today);
  const rest = !c.enforced
    ? 'Police clearance is not enforced at present.'
    : verdict.overridden && c.override
      ? `This lesson can go ahead. Override in place until ${formatLongDate(c.override.until)}.`
      : 'This lesson can go ahead, but no new lessons can be assigned until it is verified.';
  const tone = c.enforced && !verdict.overridden ? 'warning' : 'info';
  if (me.tutorId === tutorId) {
    // The lesson's own tutor reads about themselves in the second person, with a way to put it right.
    const action =
      c.vettingStatus === 'pending'
        ? 'We are reviewing your certificate and will let you know once it has been verified.'
        : 'Please upload your certificate under My checks so that we can continue to assign you lessons.';
    return (
      <View style={{ gap: Spacing.two }}>
        <Banner tone={tone} icon="alert">
          Your police clearance is {VETTING_PHRASE[c.vettingStatus]}. This lesson will go ahead as planned. {action}
        </Banner>
        <Button title="My checks" variant="outline" size="sm" icon="doc" onPress={() => router.push('/checks')} />
      </View>
    );
  }
  return (
    <Banner tone={tone} icon="alert">
      This tutor’s police clearance is {VETTING_PHRASE[c.vettingStatus]}. {rest}
    </Banner>
  );
}

/**
 * A `YYYY-MM-DD` date field with a number pad, dashes added as the user types, and the date in words beneath
 * it (for example '5 October 2027') so the entry can be checked at a glance.
 */
export function DateKeyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const words = describeDateInput(value);
  return (
    <Field
      label={label}
      value={value}
      onChangeText={(text) => onChange(maskDateInput(text))}
      placeholder="YYYY-MM-DD"
      autoCapitalize="none"
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={10}
      hint={words ?? (value.trim() ? 'Please enter the full date, for example 2026-10-06.' : undefined)}
    />
  );
}

/** One banner on the tutor's home when their clearance needs action, linking to My checks. */
export function ClearanceBanner() {
  const me = useMe();
  const today = useToday();
  const { compliance: c } = useComplianceFor(me.tutorId);
  if (!c || c.vettingStatus === 'cleared') return null;
  const message: Record<Exclude<VettingStatus, 'cleared'>, string> = {
    expiring: `Your police clearance ${vettingSummary(c, today).split(' · ')[0].replace(/^E/, 'e')}. Please upload your renewed certificate.`,
    expired: 'Your police clearance has expired. Please upload your renewed certificate so that we can continue to assign you lessons.',
    missing: 'Please upload your police clearance certificate so that we can begin to assign you lessons.',
    pending: 'Thank you for uploading your police clearance. We will let you know once it has been verified.',
  };
  return (
    <Banner tone={c.vettingStatus === 'pending' ? 'info' : c.vettingStatus === 'expiring' ? 'warning' : 'danger'} icon={c.vettingStatus === 'pending' ? 'clock' : 'alert'}>
      {message[c.vettingStatus]}{' '}
      <Txt variant="muted" color="accent" accessibilityRole="link" onPress={() => router.push('/checks')}>
        My checks
      </Txt>
    </Banner>
  );
}
