import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { EmptyState, ErrorNote, Field, ListItem, Screen, Section, Txt } from '@/components/ui';
import { useCanViewAs, useStartViewAs, viewAsRows } from '@/components/view-as';
import { Spacing } from '@/constants/theme';
import { useApplications, useEnquiries, useEnrolments, useFamilies, useInvoices, useOpportunities, useStudents, useTutors, useViewTargets } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED, invoiceTotals } from '@/domain/billing';
import { CLOSED_LABEL, closedLast, isClosed } from '@/domain/closed-accounts';
import { studentSubjects } from '@/domain/enrolments';
import { useTheme } from '@/hooks/use-theme';

interface Hit {
  key: string;
  title: string;
  subtitle?: string;
  href: Href;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const matches = (q: string, ...fields: (string | undefined)[]) => fields.some((f) => f && norm(f).includes(q));
const PEOPLE_GROUPS = ['Students', 'Families', 'Tutors'];

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
  const enrolments = useEnrolments();
  const canViewAs = useCanViewAs();
  const viewTargets = useViewTargets();
  const viewAs = useStartViewAs();

  const groups = useMemo(() => {
    const q = norm(query.trim());
    if (q.length < 2) return [];
    const familyName = (id: string) => families.data?.find((f) => f.id === id)?.name ?? '';
    const out: { title: string; icon: IconName; hits: Hit[] }[] = [
      {
        title: 'Students',
        icon: 'people',
        hits: closedLast(students.data, true)
          .map((s) => ({ s, subjects: studentSubjects(enrolments.data ?? [], s.id) }))
          .filter(({ s, subjects }) => (isClosed(s) ? matches(q, s.fullName) : matches(q, s.fullName, s.school, s.curriculum, s.yearGroup, s.phase, subjects)))
          .map(({ s, subjects }) => ({
            key: s.id,
            title: s.fullName,
            subtitle: isClosed(s) ? CLOSED_LABEL : [subjects, s.yearGroup, s.school].filter(Boolean).join(' · '),
            href: { pathname: '/students/[id]', params: { id: s.id } },
          })),
      },
    ];
    if (admin) {
      out.push(
        {
          title: 'Families',
          icon: 'person',
          // Closed accounts are matched by name only (never by their placeholder email) and say so.
          hits: closedLast(families.data, true)
            .filter((f) => (isClosed(f) ? matches(q, f.name) : matches(q, f.name, f.parentName, f.email, f.phone)))
            .map((f) => ({ key: f.id, title: `${f.name} family`, subtitle: isClosed(f) ? CLOSED_LABEL : `${f.parentName} · ${f.email}`, href: { pathname: '/manage/family-edit', params: { id: f.id } } })),
        },
        {
          title: 'Tutors',
          icon: 'school',
          hits: closedLast(tutors.data, true)
            .filter((t) => (isClosed(t) ? matches(q, t.fullName) : matches(q, t.fullName, t.email, ...t.subjects, ...(t.curricula ?? []), ...(t.phases ?? []))))
            .map((t) => ({ key: t.id, title: t.fullName, subtitle: isClosed(t) ? CLOSED_LABEL : t.subjects.join(', '), href: { pathname: '/manage/tutor-edit', params: { id: t.id } } })),
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
            .filter((e) => matches(q, e.parentName, e.studentName, e.email, e.phone, e.subject, e.phase, e.curriculum))
            .map((e) => ({ key: e.id, title: e.parentName, subtitle: [e.studentName, e.subject, e.curriculum, e.status].filter(Boolean).join(' · '), href: { pathname: '/manage/enquiry/[id]', params: { id: e.id } } })),
        },
        {
          title: 'Roles',
          icon: 'school',
          hits: (opportunities.data ?? [])
            .filter((o) => matches(q, o.title, o.description, o.subject, o.phase, o.curriculum))
            .map((o) => ({ key: o.id, title: o.title, subtitle: [o.subject, o.phase, o.status].filter(Boolean).join(' · '), href: { pathname: '/manage/opportunity/[id]', params: { id: o.id } } })),
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
  }, [query, admin, students.data, families.data, tutors.data, invoices.data, enquiries.data, opportunities.data, applications.data, enrolments.data]);

  // Admins on their own account can open the app as any family, tutor or student found above.
  const viewRows = useMemo(() => {
    if (!canViewAs || !viewTargets.data) return [];
    const ids = (title: string) => groups.find((g) => g.title === title)?.hits.map((h) => ({ id: h.key, title: h.title })) ?? [];
    return viewAsRows(viewTargets.data, { families: ids('Families'), tutors: ids('Tutors'), students: ids('Students') });
  }, [canViewAs, viewTargets.data, groups]);

  const renderGroup = (g: (typeof groups)[number]) => (
    <Section key={g.title} title={g.title}>
      <View style={{ gap: Spacing.two }}>
        {g.hits.map((h) => (
          <ListItem key={h.key} title={h.title} subtitle={h.subtitle} left={<Icon name={g.icon} size={20} color={theme.accent} />} onPress={() => router.replace(h.href)} />
        ))}
      </View>
    </Section>
  );

  return (
    <Screen>
      <Field
        label="Search"
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={admin ? 'Name, subject, school, invoice number, email…' : 'Student name, subject or school'}
        returnKeyType="search"
        onSubmitEditing={() => {
          const first = groups[0]?.hits[0];
          if (first) router.replace(first.href);
        }}
      />
      {query.trim().length < 2 ? (
        <Txt variant="muted">Type at least two letters.</Txt>
      ) : groups.length === 0 ? (
        <EmptyState icon="search" title="No matches" message={`We could not find anything for “${query.trim()}”.`} />
      ) : (
        <>
          {/* People first, then View as for them, so it is not pushed below invoices and enquiries. */}
          {groups.filter((g) => PEOPLE_GROUPS.includes(g.title)).map(renderGroup)}
          {viewRows.length ? (
            <Section title="View as">
              <View style={{ gap: Spacing.two }}>
                {viewRows.map(({ key, title, subtitle, target }) => (
                  <ListItem
                    key={key}
                    title={title}
                    subtitle={subtitle}
                    left={<Icon name="eye" size={20} color={target ? theme.accent : theme.textMuted} />}
                    onPress={target && !viewAs.busyId ? () => void viewAs.start(target) : undefined}
                  />
                ))}
                <ErrorNote error={viewAs.error} />
              </View>
            </Section>
          ) : null}
          {groups.filter((g) => !PEOPLE_GROUPS.includes(g.title)).map(renderGroup)}
        </>
      )}
    </Screen>
  );
}
