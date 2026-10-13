import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { FactsGroup, NoHeader } from '@/components/admin-people/kit';
import { PackageCard } from '@/components/billing';
import { AdminIcsResetActions } from '@/components/calendar-sync';
import { FamilyContactsSection } from '@/components/family-contacts';
import { HistorySection } from '@/components/history';
import { LoginHint } from '@/components/login-hint';
import { FamilyCardAdmin } from '@/components/payments';
import { Actions, Button, Columns, EmptyState, Figure, Figures, Group, GroupRow, Loading, Notice, PageHeader, Screen, Section, Txt } from '@/components/ui';
import { ViewAsActions } from '@/components/view-as';
import { useEnrolments, useFamilies, useInvoices, useLoginEmails, usePackages, useStudents } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED, invoiceTotals, packageRemaining } from '@/domain/billing';
import { isClosed } from '@/domain/closed-accounts';
import { formatPhoneForDisplay } from '@/domain/contacts';
import { formatDate } from '@/domain/dates';
import { studentSubjects } from '@/domain/enrolments';
import type { Family } from '@/domain/types';

const STATUS_LABEL = { prospect: 'Prospect', active: 'Active', archived: 'Archived' } as const;

/**
 * Admin: one family, read only. Children, contacts (edited in place), billing details, packages, the saved card,
 * View as, the calendar link and the history. "Edit details" opens the form for the name, status and billing details.
 */
export default function FamilyProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const families = useFamilies();
  if (families.isLoading) return <Loading />;
  const family = families.data?.find((f) => f.id === id);
  if (me.role !== 'admin' || !family) {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/manage/families' }} kicker="Families" title="Family not found" />
        <EmptyState icon="people" title="Family not found" message="It may have been removed, or it is only available to the Elite Education office." />
      </Screen>
    );
  }
  if (isClosed(family)) return <ClosedFamily family={family} />;
  return <Profile family={family} />;
}

/** A closed family is kept only for its invoices and payments: nothing to edit and no login to send. */
function ClosedFamily({ family }: { family: Family }) {
  return (
    <Screen topInset>
      <NoHeader title={`${family.name} family`} />
      <PageHeader back={{ fallback: '/manage/families' }} kicker="Closed account" title={`The ${family.name} family`} />
      <Notice tone="info" icon="person">
        {`This family’s account was closed on ${formatDate(family.deletedAt!)}. Contact details, the children’s profiles, lesson notes, messages and homework have been removed. Invoices, payments and lesson dates are kept for the period UAE law requires.`}
      </Notice>
      <HistorySection filter={{ familyId: family.id }} />
    </Screen>
  );
}

function Profile({ family }: { family: Family }) {
  const students = useStudents();
  const enrolments = useEnrolments();
  const packages = usePackages(family.id);
  const invoices = useInvoices(family.id);
  const logins = new Set(useLoginEmails().data ?? []);
  const kids = (students.data ?? []).filter((s) => s.familyId === family.id && !isClosed(s));
  const open = (invoices.data ?? []).filter((i) => i.status === 'sent').map((i) => ({ i, balance: invoiceTotals(i).balance })).filter((x) => x.balance > 0.005);
  const owed = open.reduce((n, x) => n + x.balance, 0);
  const credits = (packages.data ?? []).reduce((n, p) => n + packageRemaining(p), 0);
  const canSignIn = logins.has(family.email.toLowerCase());
  const status = family.status ?? 'active';
  const edit = () => router.push({ pathname: '/manage/family-edit', params: { id: family.id, edit: '1' } });

  return (
    <Screen topInset onRefresh={() => invoices.refetch()} refreshing={invoices.isRefetching}>
      <NoHeader title={`${family.name} family`} />
      <PageHeader
        back={{ fallback: '/manage/families' }}
        kicker={`${STATUS_LABEL[status]} family`}
        title={`The ${family.name} family`}
        sub={[family.parentName, family.email, family.phone ? formatPhoneForDisplay(family.phone) : null].filter(Boolean).join(' · ')}
      />

      {status === 'archived' ? <Notice tone="info">Archived. The family keeps its records; change the status from Edit details to make it active again.</Notice> : null}

      <Figures>
        <Figure
          label="Owed"
          value={invoices.isLoading ? '…' : owed > 0 ? formatAED(owed) : 'Nothing'}
          hint={owed > 0 ? `on ${open.length} open ${open.length === 1 ? 'invoice' : 'invoices'}` : 'all paid'}
          tone={owed > 0 ? 'bad' : 'good'}
        />
        <Figure label="Lesson credits" value={String(credits)} hint={credits ? 'left on packages' : 'no package'} />
        <Figure label="Payment" value={family.autopay ? 'Autopay' : 'Manual'} hint={family.savedCard ? 'card on file' : 'no card saved'} />
        <Figure label="App access" value={canSignIn ? 'Signed up' : 'Not signed up yet'} hint={canSignIn ? 'main contact can sign in' : 'main contact has no account'} tone={canSignIn ? undefined : 'warn'} />
      </Figures>

      {canSignIn ? null : <LoginHint email={family.email} who="parent" name={family.parentName} />}

      <Columns>
        <Group
          title="Children"
          link={{ label: 'Add a child', onPress: () => router.push({ pathname: '/students/edit', params: { familyId: family.id } }) }}
          note={kids.length ? undefined : 'No children added yet.'}>
          {kids.map((s) => (
            <GroupRow
              key={s.id}
              avatar={s.fullName}
              title={s.fullName}
              note={[s.yearGroup, studentSubjects(enrolments.data ?? [], s.id) || 'No subjects yet'].filter(Boolean).join(' · ')}
              onPress={() => router.push({ pathname: '/students/[id]', params: { id: s.id } })}
            />
          ))}
        </Group>
        <FactsGroup
          title="Billing details"
          link={{ label: 'Edit', onPress: edit }}
          note={family.billingName || family.billingAddress || family.trn ? 'Printed on this family’s tax invoices.' : 'None added. Invoices are made out to the main contact.'}
          facts={[
            { k: 'Billed to', v: family.billingName },
            { k: 'Billing address', v: family.billingAddress },
            { k: 'Customer TRN', v: family.trn },
          ]}
        />
      </Columns>

      <FamilyContactsSection familyId={family.id} editable intro="Contact changes are saved as soon as you make them." />

      <Columns>
        <Section
          title="Lesson packages"
          action={<Button title="Sell a package" icon="sell" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/manage/package-new', params: { familyId: family.id } })} />}>
          <View style={{ gap: 12 }}>
            {(packages.data ?? []).length ? (
              (packages.data ?? []).map((p) => <PackageCard key={p.id} pkg={p} />)
            ) : (
              <Txt variant="muted">No packages bought yet.</Txt>
            )}
          </View>
        </Section>
        <Section title="Card and autopay">
          <FamilyCardAdmin family={family} />
        </Section>
      </Columns>

      <Actions>
        <Button title="Message the family" icon="forum" onPress={() => router.push({ pathname: '/messages/[familyId]', params: { familyId: family.id } })} />
        <Button title="Edit details" icon="edit" variant="secondary" onPress={edit} />
      </Actions>

      <ViewAsActions familyId={family.id} />
      <AdminIcsResetActions familyId={family.id} />
      <HistorySection filter={{ familyId: family.id }} />
    </Screen>
  );
}
