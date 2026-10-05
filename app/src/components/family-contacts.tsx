import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useFamilyContacts } from '@/data/hooks';
import { useMe } from '@/data/session';
import {
  canRemoveContact,
  CHANNEL_LABELS,
  contactFlagsSummary,
  describeRecipients,
  draftFromContact,
  emptyContactDraft,
  NOTICE_KIND_LABELS,
  normaliseContactDraft,
  RELATIONSHIP_LABELS,
  RELATIONSHIP_ORDER,
  validateContactDraft,
  type NoticeKind,
} from '@/domain/contacts';
import type { ContactChannel, FamilyContact, FamilyContactDraft } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';

import { Avatar, Badge, Button, Card, Chip, ErrorNote, Field, ListItem, Loading, Row, Screen, Section, Segmented, Txt, type Tone } from './ui';

const NOTICE_KINDS: NoticeKind[] = ['invoices', 'reports', 'lesson_notes', 'general'];

const CHANNEL_OPTIONS = (Object.keys(CHANNEL_LABELS) as ContactChannel[]).map((value) => ({ value, label: CHANNEL_LABELS[value] }));

/** The badges on a contact card: what they receive, with 'Signed in' once they have used their login. */
function contactBadges(c: FamilyContact): { label: string; tone: Tone }[] {
  return contactFlagsSummary(c).map((label) => {
    if (label === 'Main contact') return { label, tone: 'gold' };
    if (label === 'Signs in' && c.hasLogin) return { label: 'Signed in', tone: 'neutral' };
    return { label, tone: 'neutral' };
  });
}

/** The family's contacts with what each receives, for the family itself and for admins. */
export function FamilyContactsSection({ familyId, editable, intro }: { familyId: string; editable: boolean; intro?: string }) {
  const contacts = useFamilyContacts(familyId);
  const list = contacts.data ?? [];
  return (
    <Section
      title="Contacts"
      action={
        editable ? (
          <Button title="Add" icon="plus" size="sm" variant="ghost" onPress={() => router.push({ pathname: '/contacts/edit', params: { familyId } })} />
        ) : undefined
      }>
      {intro ? <Txt variant="muted">{intro}</Txt> : null}
      {contacts.isLoading ? (
        <Loading />
      ) : contacts.error ? (
        <ErrorNote error={contacts.error} />
      ) : list.length === 0 ? (
        <Card>
          <Txt variant="muted">No contacts have been added yet.</Txt>
        </Card>
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((c) => (
            <ListItem
              key={c.id}
              title={c.name}
              subtitle={`${RELATIONSHIP_LABELS[c.relationship]}${c.email ? ` · ${c.email}` : ''}`}
              left={<Avatar name={c.name} />}
              below={
                <Row wrap gap={Spacing.one} style={{ flex: 1 }}>
                  {contactBadges(c).map((b) => (
                    <Badge key={b.label} label={b.label} tone={b.tone} />
                  ))}
                </Row>
              }
              onPress={editable ? () => router.push({ pathname: '/contacts/edit', params: { familyId, id: c.id } }) : undefined}
            />
          ))}
          <Card style={{ gap: Spacing.two }}>
            <Txt variant="label">Who receives what</Txt>
            {NOTICE_KINDS.map((kind) => (
              <Txt key={kind} variant="muted">
                <Txt variant="muted" style={{ fontWeight: '700' }}>
                  {NOTICE_KIND_LABELS[kind]}:
                </Txt>{' '}
                {describeRecipients(list, kind)}
              </Txt>
            ))}
            {list.some((c) => !c.canLogIn && !c.hasLogin && !!c.email) ? (
              <Txt variant="small">
                Email only: these contacts receive emails but no app notifications, and cannot sign in.
              </Txt>
            ) : null}
            <Txt variant="small">Bank details are never included in notifications; they appear only on invoices in the app.</Txt>
          </Card>
        </View>
      )}
    </Section>
  );
}

/** Names and relationships only, for tutors and the admin student page. No email addresses or telephone numbers. */
export function FamilyContactsReadOnly({ familyId }: { familyId: string }) {
  const contacts = useFamilyContacts(familyId);
  const list = contacts.data ?? [];
  if (contacts.isLoading || list.length === 0) return null;
  return (
    <View style={{ gap: Spacing.one }}>
      {list.map((c) => (
        <Row key={c.id} wrap gap={Spacing.two}>
          <Txt style={{ flexShrink: 1 }}>{c.name}</Txt>
          <Txt variant="muted">{RELATIONSHIP_LABELS[c.relationship]}</Txt>
          {c.isPrimary ? <Badge label="Main contact" tone="gold" /> : null}
        </Row>
      ))}
    </View>
  );
}

/** A labelled switch with a one-line explanation, styled as on the WhatsApp card. */
function SwitchRow({
  label,
  explanation,
  value,
  onChange,
  disabled,
}: {
  label: string;
  explanation?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Row gap={Spacing.three} style={{ justifyContent: 'space-between' }}>
        <Txt style={{ flex: 1 }}>{label}</Txt>
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ true: theme.accent, false: theme.textMuted }}
          thumbColor={value ? theme.onGold : theme.text}
          {...({ activeThumbColor: theme.onGold } as object)}
          accessibilityLabel={label}
        />
      </Row>
      {explanation ? <Txt variant="small">{explanation}</Txt> : null}
    </View>
  );
}

/** The confirmation text for removing a contact. */
function removalMessage(c: FamilyContact, all: FamilyContact[], isAdmin: boolean): string {
  let text = 'They will no longer receive messages from Elite Education';
  if (c.hasLogin) text += ' and will no longer be able to sign in to see this family';
  text += '.';
  if (isAdmin && c.canLogIn && !all.some((o) => o.id !== c.id && o.canLogIn)) {
    text += ' Nobody in the family will then be able to sign in.';
  }
  return text;
}

/** Add or edit one family contact. Admins and the family's own parents use it. */
export function ContactEditor({
  familyId,
  existing,
  all,
  onDone,
}: {
  familyId: string;
  existing?: FamilyContact;
  all: FamilyContact[];
  onDone: () => void;
}) {
  const me = useMe();
  const save = useAction(source.saveFamilyContact);
  const remove = useAction(source.removeFamilyContact);
  // A family's first contact becomes its main contact (the server insists), so the switch starts on and stays on.
  const firstContact = !existing && all.length === 0;
  const [draft, setDraft] = useState<FamilyContactDraft>(() =>
    existing ? draftFromContact(existing) : { ...emptyContactDraft(), isPrimary: firstContact },
  );
  const [touched, setTouched] = useState(false);

  const others = all.filter((c) => c.id !== existing?.id);
  const problem = validateContactDraft({ ...draft, hasLogin: existing?.hasLogin }, others, me.role);
  const alreadyPrimary = !!existing?.isPrimary || firstContact;
  const whatsappManaged = !!existing?.hasLogin;
  const removal = existing ? canRemoveContact(existing, all, me.role) : undefined;

  function set<K extends keyof FamilyContactDraft>(key: K, value: FamilyContactDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setTouched(true);
  }

  async function onSave() {
    await save.mutateAsync([familyId, normaliseContactDraft(draft)]);
    onDone();
  }

  function onRemove() {
    if (!existing) return;
    confirm(
      `Remove ${existing.name}?`,
      removalMessage(existing, all, me.role === 'admin'),
      async () => {
        try {
          await remove.mutateAsync([existing.id]);
          onDone();
        } catch {
          // Shown below via remove.error.
        }
      },
      'Remove',
    );
  }

  return (
    <Screen
      footer={
        // The reason Save is unavailable sits beside it, so it is seen however far down the form the person is.
        <View style={{ flex: 1, gap: Spacing.two }}>
          {touched && problem ? (
            <Txt variant="small" color="danger" accessibilityRole="alert">
              {problem}
            </Txt>
          ) : null}
          <Button
            title={existing ? 'Save changes' : 'Add contact'}
            variant="gold"
            disabled={!!problem}
            loading={save.isPending}
            onPress={() => {
              onSave().catch(() => undefined);
            }}
          />
        </View>
      }>
      <Field label="Name" value={draft.name} onChangeText={(t) => set('name', t)} autoCapitalize="words" autoComplete="name" />
      <View style={{ gap: Spacing.one }}>
        <Txt variant="label">Relationship</Txt>
        <Row wrap gap={Spacing.two}>
          {RELATIONSHIP_ORDER.map((r) => (
            <Chip key={r} label={RELATIONSHIP_LABELS[r]} selected={draft.relationship === r} onPress={() => set('relationship', r)} />
          ))}
        </Row>
      </View>
      <Field
        label="Email"
        value={draft.email ?? ''}
        onChangeText={(t) => set('email', t)}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
      />
      <Field
        label="Telephone"
        value={draft.phone ?? ''}
        onChangeText={(t) => set('phone', t)}
        keyboardType="phone-pad"
        autoComplete="tel"
        hint="Include the country code, for example +971 50 123 4567."
      />
      <View style={{ gap: Spacing.one }}>
        <Txt variant="label">Preferred way to reach them</Txt>
        <Segmented value={draft.preferredChannel} onChange={(v) => set('preferredChannel', v)} options={CHANNEL_OPTIONS} />
      </View>
      <Card style={{ gap: Spacing.three }}>
        <SwitchRow
          label="Can sign in to the app"
          explanation="They sign in with this email address and see the family's lessons, progress, invoices and messages."
          value={draft.canLogIn}
          onChange={(v) => set('canLogIn', v)}
        />
        <SwitchRow
          label="Receives invoices and payment notices"
          explanation="Invoices, receipts and payment reminders."
          value={draft.receivesInvoices}
          onChange={(v) => set('receivesInvoices', v)}
        />
        <SwitchRow
          label="Receives reports"
          explanation="Progress reports and termly updates from the tutors."
          value={draft.receivesReports}
          onChange={(v) => set('receivesReports', v)}
        />
        <SwitchRow
          label="Receives lesson notes and homework"
          explanation="Notes after each lesson and the homework set."
          value={draft.receivesLessonNotes}
          onChange={(v) => set('receivesLessonNotes', v)}
        />
        <SwitchRow
          label="Receives WhatsApp messages"
          explanation={
            whatsappManaged
              ? 'Managed by this contact in their own Account settings.'
              : 'Lesson reminders and the notices ticked above, sent by WhatsApp to the mobile number above. Please switch this on only if they have agreed to receive WhatsApp messages.'
          }
          value={draft.receivesWhatsApp}
          onChange={(v) => set('receivesWhatsApp', v)}
          disabled={whatsappManaged}
        />
        <SwitchRow
          label="Emergency contact"
          explanation="We contact them if we cannot reach the main contact about a pupil."
          value={draft.emergencyContact}
          onChange={(v) => set('emergencyContact', v)}
        />
        <SwitchRow
          label="Main contact"
          explanation={
            firstContact
              ? "The family's first contact becomes the main contact, so they need an email address. Invoices are addressed to them."
              : 'Invoices are addressed to the main contact. Making this the main contact replaces the current one.'
          }
          value={alreadyPrimary || draft.isPrimary}
          onChange={(v) => set('isPrimary', v)}
          disabled={alreadyPrimary}
        />
      </Card>
      <ErrorNote error={save.error} />
      <ErrorNote error={remove.error} />
      {existing && removal ? (
        removal.ok ? (
          <Button title={`Remove ${existing.name}`} variant="danger" loading={remove.isPending} onPress={onRemove} />
        ) : (
          <Txt variant="muted">{removal.reason}</Txt>
        )
      ) : null}
    </Screen>
  );
}
