import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, Platform } from 'react-native';

import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '@/config';
import { source } from '@/data';
import { useAdmissionsCases, useEnrolments, useSettings, useStudents } from '@/data/hooks';
import { queryClient } from '@/data/query';
import { useMe, useSession, useViewing } from '@/data/session';
import { flagViewError } from '@/data/view-as';
import { withoutClosed } from '@/domain/closed-accounts';
import { studentSubjects } from '@/domain/enrolments';
import { canUseWhatsApp } from '@/domain/whatsapp';
import { confirm, notify } from '@/lib/confirm';
import { saveDataExport, shareDataSummaryPdf } from '@/lib/data-export';
import { reportError } from '@/lib/error-reporting';

import { RESET_ICS_CONFIRM, RESET_ICS_DONE, RESET_ICS_TITLE, useCalendarFeed } from '../calendar-sync';
import { FamilyContactsSection } from '../family-contacts';
import { Actions, Button, Columns, ErrorNote, Group, GroupRow, Notice, PageHeader, Screen, Section, useToast } from '../ui';
import { WhatsAppCard } from '../whatsapp-card';
import { firstName } from './format';

async function openLink(url: string) {
  if (Platform.OS === 'web') {
    globalThis.open?.(url, '_blank', 'noopener');
    return;
  }
  await WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url));
}

/** The parent's Account tab: their details (read only), children, contacts, calendar, notifications, policy and privacy. */
export function ParentAccount() {
  const me = useMe();
  const viewing = useViewing();
  const signOut = useSession((s) => s.signOut);
  const exitViewAs = useSession((s) => s.exitViewAs);
  const resetMyIcsToken = useSession((s) => s.resetMyIcsToken);
  const toast = useToast();
  const settings = useSettings();
  const students = useStudents();
  const enrolments = useEnrolments();
  const cases = useAdmissionsCases();
  const feed = useCalendarFeed();
  const [busy, setBusy] = useState<'json' | 'pdf' | 'ics' | 'reset' | 'demo' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const kids = withoutClosed(students.data);
  const s = settings.data;
  const whatsapp = canUseWhatsApp(me.role, me.tutorId) && !!source.setWhatsApp;

  async function download(kind: 'json' | 'pdf') {
    setBusy(kind);
    try {
      const data = await source.exportMyData();
      if (kind === 'json') await saveDataExport(data);
      else await shareDataSummaryPdf(data);
    } catch (err) {
      // While an admin is viewing as someone, the refusal is shown as the calm view-only notice instead.
      if (flagViewError(err)) return;
      reportError(err, { source: 'manual', route: 'data-export' });
      notify('We could not prepare your data', `Please try again in a moment. If the problem continues, please email ${SUPPORT_EMAIL}.`);
    } finally {
      setBusy(null);
    }
  }

  async function exportCalendar() {
    setBusy('ics');
    try {
      await feed.exportFile();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  function resetCalendar() {
    confirm(
      RESET_ICS_TITLE,
      RESET_ICS_CONFIRM,
      async () => {
        setBusy('reset');
        setError(null);
        try {
          await resetMyIcsToken();
          toast(RESET_ICS_DONE);
        } catch (err) {
          setError(err);
        } finally {
          setBusy(null);
        }
      },
      'Reset',
    );
  }

  const policy = s
    ? `Please give at least ${s.cancellationHours} hours’ notice to move or cancel a lesson. Lessons cancelled with less notice are charged${
        s.lateCancelFee < 1 ? ` at ${Math.round(s.lateCancelFee * 100)}% of the lesson price` : ' in full'
      }. If we or your tutor cancel, the lesson is not charged. Invoices are due within ${s.invoiceDueDays} days.`
    : undefined;

  return (
    <Screen topInset>
      <PageHeader kicker="Account" title={me.fullName} sub={[me.email, me.phone].filter(Boolean).join(' · ')} />

      <Columns>
        <Group title="Your details" note="To change your name, email or mobile number, please send us a message and we will update it for you.">
          <GroupRow icon="person" title={me.fullName} note="Name" />
          <GroupRow icon="mail" title={me.email} note="Email · you sign in with this address" />
          <GroupRow icon="call" title={me.phone || 'No number on file'} note="Mobile" />
        </Group>

        <Group title="Children">
          {kids.map((k) => (
            <GroupRow
              key={k.id}
              avatar={k.fullName}
              title={k.fullName}
              note={[k.yearGroup, k.school, studentSubjects(enrolments.data ?? [], k.id)].filter(Boolean).join(' · ') || 'Consultation to arrange'}
              onPress={() => router.navigate({ pathname: '/parent/progress', params: { child: k.id } })}
            />
          ))}
          {viewing ? null : <GroupRow icon="person_add" title={kids.length ? 'Add a child' : 'Add my child'} onPress={() => router.push('/onboarding')} />}
        </Group>

        {me.familyId ? (
          <FamilyContactsSection
            familyId={me.familyId}
            editable
            intro="Add a second parent, a personal assistant or your family office, and choose what each person receives."
          />
        ) : null}

        {(cases.data ?? []).length ? (
          <Group title="Admissions">
            {(cases.data ?? []).map((c) => (
              <GroupRow key={c.id} icon="travel_explore" title={c.title} note="Applications, key dates and updates from your adviser" onPress={() => router.push({ pathname: '/admissions/[id]', params: { id: c.id } })} />
            ))}
          </Group>
        ) : null}

        <Group title="Calendar">
          <GroupRow
            icon="calendar_month"
            title="Add lessons to your calendar"
            note={
              feed.feedUrl
                ? 'Subscribe once and your lessons stay up to date in Apple, Google or Outlook, including any changes and cancellations.'
                : 'Export your upcoming lessons as a file for Apple, Google or Outlook.'
            }
            action={
              feed.feedUrl
                ? { label: 'Subscribe', onPress: feed.subscribe, accessibilityLabel: 'Subscribe in Calendar' }
                : { label: busy === 'ics' ? 'Exporting…' : 'Export', onPress: () => void exportCalendar(), disabled: busy === 'ics', accessibilityLabel: 'Export lessons (.ics)' }
            }
          />
          {(feed.feedUrl || source.kind === 'demo') && !viewing && source.resetIcsToken ? (
            <GroupRow
              icon="refresh"
              title={RESET_ICS_TITLE}
              note="Use this if your calendar link has been shared by mistake. The old link stops working at once."
              action={{ label: 'Reset', onPress: resetCalendar, disabled: busy === 'reset', accessibilityLabel: RESET_ICS_TITLE }}
            />
          ) : null}
        </Group>

        {whatsapp ? (
          <Section title="Notifications">
            <WhatsAppCard />
          </Section>
        ) : null}

        <Group title="Help and privacy">
          {policy ? <GroupRow icon="gavel" title="Cancellation policy" body={policy} /> : null}
          <GroupRow
            icon="download"
            title="Download your data"
            note="Everything we hold about you, as a file"
            action={{ label: busy === 'json' ? 'Preparing…' : 'Download', onPress: () => void download('json'), disabled: !!busy, accessibilityLabel: 'Download my data' }}
          />
          <GroupRow
            icon="description"
            title="Download a summary"
            note="The same, as a printable PDF"
            action={{ label: busy === 'pdf' ? 'Preparing…' : 'PDF', onPress: () => void download('pdf'), disabled: !!busy, accessibilityLabel: 'Download a summary (PDF)' }}
          />
          <GroupRow icon="link" title="Privacy policy" onPress={() => void openLink(PRIVACY_URL)} />
          <GroupRow icon="link" title="Terms of service" onPress={() => void openLink(TERMS_URL)} />
          {viewing ? null : <GroupRow icon="delete" tone="bad" title="Delete your account" onPress={() => router.push('/account-delete')} />}
        </Group>

        {source.kind === 'demo' && source.resetDemo && !viewing ? (
          <Group title="Demo">
            <GroupRow
              icon="refresh"
              title="Reset demo data"
              note="Restores the original sample lessons, notes and invoices"
              action={{
                label: 'Reset',
                accessibilityLabel: 'Reset demo data',
                disabled: busy === 'demo',
                onPress: () =>
                  confirm('Reset demo data?', 'This restores the original sample lessons, notes and invoices.', async () => {
                    setBusy('demo');
                    await source.resetDemo!();
                    await queryClient.invalidateQueries();
                    setBusy(null);
                  }),
              }}
            />
          </Group>
        ) : null}
      </Columns>

      <ErrorNote error={error} />
      {kids.length === 0 && !viewing ? (
        <Notice tone="info" icon="favorite">
          {`Welcome, ${firstName(me.fullName) || 'and thank you for joining'}. Add your child and we will arrange a complimentary consultation.`}
        </Notice>
      ) : null}
      <Actions>
        {viewing ? (
          <Button
            title="Exit view"
            variant="secondary"
            icon="visibility"
            onPress={async () => {
              await exitViewAs();
              router.replace('/admin');
            }}
          />
        ) : (
          <Button title="Sign out" variant="secondary" icon="logout" onPress={() => signOut()} />
        )}
      </Actions>
    </Screen>
  );
}
