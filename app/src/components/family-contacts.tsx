import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useFamilyContacts } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { useTheme } from '@/hooks/use-theme';
import {
  canRemoveContact,
  CHANNEL_LABELS,
  contactFlagsSummary,
  describeRecipients,
  describeWhatsAppRecipients,
  draftFromContact,
  emailLockHint,
  emptyContactDraft,
  NOTICE_KIND_LABELS,
  normaliseContactDraft,
  noticeDefaultsFor,
  RELATIONSHIP_LABELS,
  RELATIONSHIP_ORDER,
  validateContactDraft,
  type NoticeKind,
} from '@/domain/contacts';
import type { ContactChannel, FamilyContact, FamilyContactDraft } from '@/domain/types';
import { confirm } from '@/lib/confirm';

import { Actions, Badge, Button, ChipField, ErrorNote, Field, FieldsCard, Group, GroupRow, Loading, Notice, PageHeader, Row, Screen, Toggle, Txt } from './ui';

const NOTICE_KINDS: NoticeKind[] = ['invoices', 'reports', 'lesson_notes', 'general'];

const CHANNEL_OPTIONS = (Object.keys(CHANNEL_LABELS) as ContactChannel[]).map((value) => ({ value, label: CHANNEL_LABELS[value] }));

/** What a contact receives, as one line: 'Main contact, signed in, invoices, reports'. */
function contactFlagsLine(c: FamilyContact): string {
  const flags = contactFlagsSummary(c).map((label) => (label === 'Signs in' && c.hasLogin ? 'Signed in' : label));
  return flags.length ? flags.map((f, i) => (i ? f.toLowerCase() : f)).join(', ') : 'Receives nothing yet';
}

/** The family's contacts with what each receives, for the family itself and for admins. */
export function FamilyContactsSection({ familyId, editable, intro }: { familyId: string; editable: boolean; intro?: string }) {
  const theme = useTheme();
  const viewing = useViewing();
  const contacts = useFamilyContacts(familyId);
  const list = contacts.data ?? [];
  const canEdit = editable && !viewing;
  const edit = (id?: string) => router.push({ pathname: '/contacts/edit', params: id ? { familyId, id } : { familyId } });
  if (contacts.isLoading) return <Loading />;
  if (contacts.error) return <ErrorNote error={contacts.error} />;
  return (
    <View style={{ gap: 12 }}>
      <Group title="Family contacts" note={intro}>
        {list.map((c) => (
          <GroupRow
            key={c.id}
            avatar={c.name}
            title={c.name}
            note={`${RELATIONSHIP_LABELS[c.relationship]}${c.email ? ` · ${c.email}` : ''}`}
            accessibilityLabel={c.name}
            onPress={canEdit ? () => edit(c.id) : undefined}>
            <Txt variant="note" style={{ color: theme.accent }}>
              {contactFlagsLine(c)}
            </Txt>
          </GroupRow>
        ))}
        {list.length === 0 ? <GroupRow icon="group" title="No contacts have been added yet." /> : null}
        {canEdit ? <GroupRow icon="add" title="Add a contact" onPress={() => edit()} /> : null}
      </Group>
      {list.length ? (
        <Group>
          <View style={{ paddingHorizontal: 18, paddingVertical: 16, gap: 8 }}>
            <Txt variant="label">Who receives what</Txt>
            {NOTICE_KINDS.map((kind) => (
              <Txt key={kind} variant="note" style={{ color: theme.textBody }}>
                <Txt variant="note" style={{ fontWeight: '700', color: theme.textBody }}>
                  {NOTICE_KIND_LABELS[kind]}:
                </Txt>{' '}
                {describeRecipients(list, kind)}
              </Txt>
            ))}
            <Txt variant="note" style={{ color: theme.textBody }}>
              <Txt variant="note" style={{ fontWeight: '700', color: theme.textBody }}>
                WhatsApp (lesson reminders and the notices above):
              </Txt>{' '}
              {describeWhatsAppRecipients(list)}
            </Txt>
            {list.some((c) => !c.canLogIn && !c.hasLogin && !!c.email) ? (
              <Txt variant="small">Email only: these contacts receive emails but no app notifications, and cannot sign in.</Txt>
            ) : null}
            <Txt variant="small">Bank details are never included in notifications; they appear only on invoices in the app.</Txt>
          </View>
        </Group>
      ) : null}
    </View>
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

/** A labelled switch with a one-line explanation (the redesign's Toggle). */
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
  return <Toggle title={label} note={explanation} value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />;
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
  // Until someone sets the notices of a new contact by hand, they follow the relationship (see noticeDefaultsFor).
  const [noticesChosen, setNoticesChosen] = useState(false);

  const others = all.filter((c) => c.id !== existing?.id);
  const problem = validateContactDraft({ ...draft, hasLogin: existing?.hasLogin }, others, me.role);
  const alreadyPrimary = !!existing?.isPrimary || firstContact;
  const whatsappManaged = !!existing?.hasLogin;
  const removal = existing ? canRemoveContact(existing, all, me.role) : undefined;

  function set<K extends keyof FamilyContactDraft>(key: K, value: FamilyContactDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setTouched(true);
  }

  function setNotice(key: 'receivesInvoices' | 'receivesReports' | 'receivesLessonNotes', value: boolean) {
    set(key, value);
    setNoticesChosen(true);
  }

  function setRelationship(r: FamilyContactDraft['relationship']) {
    if (existing || noticesChosen) set('relationship', r);
    else {
      setDraft((d) => ({ ...d, relationship: r, ...noticeDefaultsFor(r) }));
      setTouched(true);
    }
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
      topInset
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
            icon={existing ? 'check' : 'person_add'}
            disabled={!!problem}
            loading={save.isPending}
            onPress={() => {
              onSave().catch(() => undefined);
            }}
          />
        </View>
      }>
      <PageHeader
        back
        kicker="Family contacts"
        title={existing ? existing.name : 'Add a contact'}
        sub={existing?.hasLogin ? 'They sign in with their own login and see only what you choose here.' : 'Choose what they receive. They see only what you choose here.'}
      />
      <FieldsCard>
        <Field label="Name" value={draft.name} onChangeText={(t) => set('name', t)} autoCapitalize="words" autoComplete="name" placeholder="e.g. Khalid Al Mansoori" />
        <ChipField
          label="Relationship"
          options={RELATIONSHIP_ORDER.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] }))}
          value={draft.relationship}
          onChange={setRelationship}
        />
        <Field
          label="Email"
          value={draft.email ?? ''}
          onChangeText={(t) => set('email', t)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          editable={!existing?.hasLogin}
          hint={existing?.hasLogin ? emailLockHint(existing, all, me) : undefined}
        />
        <Field
          label="Telephone"
          value={draft.phone ?? ''}
          onChangeText={(t) => set('phone', t)}
          keyboardType="phone-pad"
          autoComplete="tel"
          hint="Include the country code, for example +971 50 123 4567."
        />
        <ChipField label="Preferred way to reach them" options={CHANNEL_OPTIONS} value={draft.preferredChannel} onChange={(v) => set('preferredChannel', v)} />
      </FieldsCard>
      <FieldsCard title="They receive">
        <SwitchRow
          label="Can sign in to the app"
          explanation="They sign in with this email address and see the family’s lessons, progress, invoices and messages."
          value={draft.canLogIn}
          onChange={(v) => set('canLogIn', v)}
        />
        <SwitchRow
          label="Receives invoices and payment notices"
          explanation="Invoices, receipts and payment reminders."
          value={draft.receivesInvoices}
          onChange={(v) => setNotice('receivesInvoices', v)}
        />
        <SwitchRow
          label="Receives reports"
          explanation="Progress reports and termly updates from the tutors."
          value={draft.receivesReports}
          onChange={(v) => setNotice('receivesReports', v)}
        />
        <SwitchRow
          label="Receives lesson notes and homework"
          explanation="Notes after each lesson and the homework set."
          value={draft.receivesLessonNotes}
          onChange={(v) => setNotice('receivesLessonNotes', v)}
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
              ? "The family’s first contact becomes the main contact, so they need an email address. Invoices are addressed to them."
              : 'Invoices are addressed to the main contact. Making this the main contact replaces the current one.'
          }
          value={alreadyPrimary || draft.isPrimary}
          onChange={(v) => set('isPrimary', v)}
          disabled={alreadyPrimary}
        />
      </FieldsCard>
      <ErrorNote error={save.error} />
      <ErrorNote error={remove.error} />
      {existing && removal ? (
        removal.ok ? (
          <Actions>
            <Button title={`Remove ${existing.name}`} icon="person_remove" variant="danger" loading={remove.isPending} onPress={onRemove} />
          </Actions>
        ) : (
          <Notice tone="info">{removal.reason}</Notice>
        )
      ) : null}
    </Screen>
  );
}
