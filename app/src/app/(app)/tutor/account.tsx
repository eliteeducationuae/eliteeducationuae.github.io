import { router } from 'expo-router';

import { AccountScreen } from '@/components/account';
import { Icon } from '@/components/icon';
import { ListItem, Section } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

export default function TutorAccount() {
  const theme = useTheme();
  const links = [
    { title: 'Opportunities', subtitle: 'New students you can put yourself forward for', icon: 'school', href: '/opportunities' },
    { title: 'My invoices', subtitle: 'Submit your monthly invoice and track payment', icon: 'doc', href: '/tutor-invoices' },
    { title: 'Payment details', subtitle: 'Where we pay you (private)', icon: 'card', href: '/payment-details' },
    { title: 'My pay', subtitle: 'Hours taught and earnings by month', icon: 'money', href: '/pay' },
    { title: 'Availability & time off', subtitle: 'When families can book you, and days you’re away', icon: 'clock', href: '/availability' },
    { title: 'Announcements', subtitle: 'News from Elite Education', icon: 'megaphone', href: '/announcements' },
  ] as const;
  return (
    <AccountScreen>
      <Section title="My work">
        {links.map((l) => (
          <ListItem key={l.href} title={l.title} subtitle={l.subtitle} left={<Icon name={l.icon} size={22} color={theme.accent} />} onPress={() => router.push(l.href)} />
        ))}
      </Section>
    </AccountScreen>
  );
}
