import { router, type Href } from 'expo-router';
import { useState } from 'react';

import { CalendarSyncCard } from '@/components/calendar-sync';
import { DataPrivacyCard } from '@/components/data-privacy';
import { GoogleCalendarCard } from '@/components/google-calendar';
import type { IconName } from '@/components/icon';
import { HeaderActions } from '@/components/role-tabs';
import { useHandbookDue, useMyTutor, useReportsToWrite } from '@/components/tutor/common';
import { Actions, Button, Columns, Group, GroupRow, PageHeader, Screen } from '@/components/ui';
import { OnboardingCard, useComplianceFor, useToday } from '@/components/vetting';
import { WhatsAppCard } from '@/components/whatsapp-card';
import { source } from '@/data';
import { useAdmissionsCases, useHandovers } from '@/data/hooks';
import { queryClient } from '@/data/query';
import { useMe, useSession } from '@/data/session';
import { vettingSummary } from '@/domain/vetting';
import { confirm } from '@/lib/confirm';

type Item = { title: string; note: string; icon: IconName; href: Href; count?: number };

/** The tutor's Account tab: my work, pay, Elite Education, settings and sign-out. */
export default function TutorAccount() {
  const me = useMe();
  const tutor = useMyTutor();
  const today = useToday();
  const viewing = useSession((s) => !!s.viewing);
  const signOut = useSession((s) => s.signOut);
  const exitViewAs = useSession((s) => s.exitViewAs);
  const { compliance } = useComplianceFor(me.tutorId);
  const handbook = useHandbookDue();
  const toWrite = useReportsToWrite();
  const handovers = useHandovers();
  const cases = useAdmissionsCases();
  const [resetting, setResetting] = useState(false);

  const notesToWrite = (handovers.data ?? []).filter((h) => h.fromTutorId === me.tutorId && !h.note?.trim()).length;
  const advised = new Set((cases.data ?? []).map((c) => c.familyId)).size;
  const subjects = tutor?.subjects.length ? tutor.subjects.join(', ') : undefined;

  const work: Item[] = [
    {
      title: 'Reports to write',
      note: toWrite ? `${toWrite} to write. We prepare a draft for you.` : 'End-of-term reports for your students',
      icon: 'description',
      href: '/reports',
      count: toWrite,
    },
    { title: 'Availability and time off', note: 'When families can book you, and the days you are away', icon: 'schedule', href: '/availability' },
    { title: 'Opportunities', note: 'New students for whom you can put yourself forward', icon: 'school', href: '/opportunities' },
    { title: 'Resource library', note: 'Worksheets, past papers and links to share', icon: 'folder', href: '/resources' },
    {
      title: 'Handover notes',
      note: notesToWrite ? `${notesToWrite} to write for the next tutor` : 'Handover packs and the notes you have written',
      icon: 'swap_horiz',
      href: '/handover',
      count: notesToWrite,
    },
    ...(advised ? [{ title: 'Admissions advisory', note: `${advised === 1 ? '1 family' : `${advised} families`} you advise`, icon: 'school' as IconName, href: '/admissions' as Href }] : []),
  ];
  const pay: Item[] = [
    { title: 'My invoices', note: 'Submit your monthly invoice and follow its payment', icon: 'receipt_long', href: '/tutor-invoices' },
    { title: 'My pay', note: 'Hours taught and earnings by month', icon: 'payments', href: '/pay' },
    { title: 'Payment details', note: 'Where we pay you (kept private)', icon: 'account_balance', href: '/payment-details' },
  ];
  const office: Item[] = [
    { title: 'Announcements', note: 'News from Elite Education', icon: 'campaign', href: '/announcements' },
    {
      title: 'Tutor handbook',
      note: handbook.version ? `Version ${handbook.version} · ${handbook.due ? 'please acknowledge' : 'acknowledged'}` : 'Our standards and policies',
      icon: 'menu_book',
      href: '/handbook',
      count: handbook.due ? 1 : 0,
    },
    {
      title: 'My checks and documents',
      note: compliance ? vettingSummary(compliance, today) : 'Police clearance and onboarding',
      icon: 'verified_user',
      href: '/checks',
      count: compliance && compliance.vettingStatus !== 'cleared' ? 1 : 0,
    },
  ];
  const rows = (items: Item[]) =>
    items.map((i) => (
      <GroupRow
        key={i.title}
        icon={i.icon}
        title={i.title}
        note={i.note}
        value={i.count ? String(i.count) : undefined}
        valueTone="accent"
        onPress={() => router.push(i.href)}
      />
    ));

  return (
    <Screen topInset>
      <PageHeader kicker="Account" title={me.fullName} sub={[me.email, subjects].filter(Boolean).join(' · ')} right={<HeaderActions search />} />
      <OnboardingCard compliance={compliance} />
      <Columns>
        <Group title="My work">{rows(work)}</Group>
        <Group title="Pay">{rows(pay)}</Group>
        <Group title="Elite Education">{rows(office)}</Group>
      </Columns>
      <Group title="Settings" />
      <GoogleCalendarCard />
      <CalendarSyncCard />
      <WhatsAppCard />
      <DataPrivacyCard />
      {source.kind === 'demo' && source.resetDemo && !viewing ? (
        <Actions>
          <Button
            title="Reset demo data"
            variant="secondary"
            icon="repeat"
            loading={resetting}
            onPress={() =>
              confirm('Reset demo data?', 'This restores the original sample lessons, notes and invoices.', async () => {
                setResetting(true);
                await source.resetDemo!();
                await queryClient.invalidateQueries();
                setResetting(false);
              })
            }
          />
        </Actions>
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
