import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { EmptyState, Field, ListItem, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApplications, useEnquiries, useFamilies, useInvoices, useOpportunities, useStudents, useTutors } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED, invoiceTotals } from '@/domain/billing';
import { useTheme } from '@/hooks/use-theme';

interface Hit {
  key: string;
  title: string;
  subtitle?: string;
  href: Href;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const matches = (q: string, ...fields: (string | undefined)[]) => fields.some((f) => f && norm(f).includes(q));

/** Find anyone or anything: students, families, tutors, invoices, enquiries, roles and applications. */
export default function Search() {
  const theme = useTheme();
  const me = useMe();
  const admin = me.role === 'admin';
  const [query, setQuery] = useState('');
  const students = useStudents();
  const families = useFamilies();
  const tutors = useTutors();
  const invoices = useInvoices();
  const enquiries = useEnquiries();
  const opportunities = useOpportunities();
  const applications = useApplications();

  const groups = useMemo(() => {
    const q = norm(query.trim());
    if (q.length < 2) return [];
    const familyName = (id: string) => families.data?.find((f) => f.id === id)?.name ?? '';
    const out: { title: string; icon: IconName; hits: Hit[] }[] = [
      {
        title: 'Students',
        icon: 'people',
        hits: (students.data ?? [])
          .filter((s) => matches(q, s.fullName, s.school, s.curriculum, s.yearGroup))
          .map((s) => ({ key: s.id, title: s.fullName, subtitle: [s.curriculum, s.yearGroup, s.school].filter(Boolean).join(' · '), href: { pathname: '/students/[id]', params: { id: s.id } } })),
      },
    ];
    if (admin) {
      out.push(
        {
          title: 'Families',
          icon: 'person',
          hits: (families.data ?? [])
            .filter((f) => matches(q, f.name, f.parentName, f.email, f.phone))
            .map((f) => ({ key: f.id, title: `${f.name} family`, subtitle: `${f.parentName} · ${f.email}`, href: { pathname: '/manage/family-edit', params: { id: f.id } } })),
        },
        {
          title: 'Tutors',
          icon: 'school',
          hits: (tutors.data ?? [])
            .filter((t) => matches(q, t.fullName, t.email, ...t.subjects))
            .map((t) => ({ key: t.id, title: t.fullName, subtitle: t.subjects.join(', '), href: { pathname: '/manage/tutor-edit', params: { id: t.id } } })),
        },
        {
          title: 'Invoices',
          icon: 'card',
          hits: (invoices.data ?? [])
            .filter((i) => matches(q, i.number, familyName(i.familyId)))
            .map((i) => ({ key: i.id, title: `${i.number} — ${familyName(i.familyId)}`, subtitle: `${formatAED(invoiceTotals(i).total)} · ${i.status}`, href: { pathname: '/invoice/[id]', params: { id: i.id } } })),
        },
        {
          title: 'Enquiries',
          icon: 'inbox',
          hits: (enquiries.data ?? [])
            .filter((e) => matches(q, e.parentName, e.studentName, e.email, e.phone, e.curriculum))
            .map((e) => ({ key: e.id, title: e.parentName, subtitle: [e.studentName, e.curriculum, e.status].filter(Boolean).join(' · '), href: { pathname: '/manage/enquiry/[id]', params: { id: e.id } } })),
        },
        {
          title: 'Roles',
          icon: 'school',
          hits: (opportunities.data ?? [])
            .filter((o) => matches(q, o.title, o.description, o.curriculum))
            .map((o) => ({ key: o.id, title: o.title, subtitle: o.status, href: { pathname: '/manage/opportunity/[id]', params: { id: o.id } } })),
        },
        {
          title: 'Tutor applications',
          icon: 'person',
          hits: (applications.data ?? [])
            .filter((a) => matches(q, a.fullName, a.email))
            .map((a) => ({ key: a.id, title: a.fullName, subtitle: `${a.email} · ${a.status}`, href: { pathname: '/manage/application/[id]', params: { id: a.id } } })),
        },
      );
    }
    return out.filter((g) => g.hits.length).map((g) => ({ ...g, hits: g.hits.slice(0, 8) }));
  }, [query, admin, students.data, families.data, tutors.data, invoices.data, enquiries.data, opportunities.data, applications.data]);

  return (
    <Screen>
      <Field
        label="Search"
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={admin ? 'Name, school, invoice number, email…' : 'Student name or school'}
        returnKeyType="search"
        onSubmitEditing={() => {
          const first = groups[0]?.hits[0];
          if (first) router.replace(first.href);
        }}
      />
      {query.trim().length < 2 ? (
        <Txt variant="muted">Type at least two letters.</Txt>
      ) : groups.length === 0 ? (
        <EmptyState icon="search" title="No matches" message={`Nothing found for “${query.trim()}”.`} />
      ) : (
        groups.map((g) => (
          <Section key={g.title} title={g.title}>
            <View style={{ gap: Spacing.two }}>
              {g.hits.map((h) => (
                <ListItem key={h.key} title={h.title} subtitle={h.subtitle} left={<Icon name={g.icon} size={20} color={theme.accent} />} onPress={() => router.replace(h.href)} />
              ))}
            </View>
          </Section>
        ))
      )}
    </Screen>
  );
}
