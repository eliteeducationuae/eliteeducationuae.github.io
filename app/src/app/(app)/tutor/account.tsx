import { router } from 'expo-router';

import { AccountScreen } from '@/components/account';
import { AdmissionsAccountLink } from '@/components/admissions/entry-links';
import { Icon } from '@/components/icon';
import { Badge, ListItem, Section } from '@/components/ui';
import { OnboardingCard, useComplianceFor } from '@/components/vetting';
import { useReportCycles, useStudentReports } from '@/data/hooks';
import { useMe } from '@/data/session';
import { useTheme } from '@/hooks/use-theme';

export default function TutorAccount() {
  const theme = useTheme();
  const me = useMe();
  const cycles = useReportCycles();
  const reports = useStudentReports();
  const openCycles = new Set((cycles.data ?? []).filter((c) => c.status === 'open').map((c) => c.id));
  const { compliance } = useComplianceFor(me.tutorId);
  const checksBadge = compliance && compliance.vettingStatus !== 'cleared' ? 1 : 0;
  const handbookBadge = compliance?.handbookVersion && (compliance.handbookAcknowledgedVersion ?? 0) < compliance.handbookVersion ? 1 : 0;
  const toWrite = (reports.data ?? []).filter((r) => r.tutorId === me.tutorId && r.status === 'draft' && openCycles.has(r.cycleId)).length;
  const work = [
    { title: 'Reports to write', subtitle: toWrite ? `${toWrite} to write. We prepare a draft for you.` : 'End-of-term reports for your students', icon: 'book', href: '/reports', badge: toWrite },
    { title: 'Availability and time off', subtitle: 'When families can book you, and the days you are away', icon: 'clock', href: '/availability', badge: 0 },
    { title: 'Opportunities', subtitle: 'New students for whom you can put yourself forward', icon: 'school', href: '/opportunities', badge: 0 },
    { title: 'Resource library', subtitle: 'Worksheets, past papers and links to share with students', icon: 'folder', href: '/resources', badge: 0 },
  ] as const;
  const pay = [
    { title: 'My invoices', subtitle: 'Submit your monthly invoice and follow its payment', icon: 'doc', href: '/tutor-invoices', badge: 0 },
    { title: 'My pay', subtitle: 'Hours taught and earnings by month', icon: 'money', href: '/pay', badge: 0 },
    { title: 'Payment details', subtitle: 'Where we pay you (kept private)', icon: 'card', href: '/payment-details', badge: 0 },
  ] as const;
  const office = [
    { title: 'Announcements', subtitle: 'News from Elite Education', icon: 'megaphone', href: '/announcements', badge: 0 },
    { title: 'Tutor handbook', subtitle: 'Our standards and policies', icon: 'book', href: '/handbook', badge: handbookBadge },
    { title: 'My checks and documents', subtitle: 'Police clearance and onboarding', icon: 'check', href: '/checks', badge: checksBadge },
  ] as const;
  const row = (l: (typeof work)[number] | (typeof pay)[number] | (typeof office)[number]) => (
    <ListItem key={l.href} title={l.title} subtitle={l.subtitle} left={<Icon name={l.icon} size={22} color={theme.accent} />} right={l.badge ? <Badge label={String(l.badge)} tone="gold" /> : undefined} onPress={() => router.push(l.href)} />
  );
  return (
    <AccountScreen>
      <OnboardingCard compliance={compliance} />
      <Section title="My work">
        {work.map(row)}
        <AdmissionsAccountLink />
      </Section>
      <Section title="Pay">{pay.map(row)}</Section>
      <Section title="Elite Education">{office.map(row)}</Section>
    </AccountScreen>
  );
}
