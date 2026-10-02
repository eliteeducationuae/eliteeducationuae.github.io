import { router } from 'expo-router';

import { AccountScreen } from '@/components/account';
import { Icon } from '@/components/icon';
import { ListItem, Section } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

export default function AdminMore() {
  const theme = useTheme();
  const links = [
    { title: 'Tutors', subtitle: 'Profiles, pay rates and calendar colours', icon: 'school', href: '/manage/tutors' },
    { title: 'Families', subtitle: 'Parents, contact details and children', icon: 'people', href: '/manage/families' },
    { title: 'Services & rates', subtitle: 'Lesson types, durations and prices', icon: 'tag', href: '/manage/services' },
    { title: 'Tutor pay', subtitle: 'Hours taught and pay owed by month', icon: 'money', href: '/manage/payroll' },
    { title: 'Business settings', subtitle: 'Cancellation policy, VAT, invoicing', icon: 'settings', href: '/manage/settings' },
  ] as const;
  return (
    <AccountScreen>
      <Section title="Manage">
        {links.map((l) => (
          <ListItem
            key={l.href}
            title={l.title}
            subtitle={l.subtitle}
            left={<Icon name={l.icon} size={22} color={theme.accent} />}
            onPress={() => router.push(l.href)}
          />
        ))}
      </Section>
    </AccountScreen>
  );
}
