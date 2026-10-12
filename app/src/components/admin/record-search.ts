import type { Href } from 'expo-router';
import { useMemo } from 'react';

import type { IconName } from '@/components/icon';
import { useCanViewAs, useStartViewAs, viewAsRows } from '@/components/view-as';
import {
  useApplications,
  useContactsForFamilies,
  useEnquiries,
  useEnrolments,
  useFamilies,
  useInvoices,
  useOpportunities,
  useStudents,
  useTutors,
  useViewTargets,
} from '@/data/hooks';
import { formatAED, invoiceTotals } from '@/domain/billing';
import { CLOSED_LABEL, closedLast, isClosed } from '@/domain/closed-accounts';
import { studentSubjects } from '@/domain/enrolments';
import { buildContactIndex, familiesByContact, matchesSearch as matches, normSearch as norm, viaContact } from '@/domain/search';
import { spamLabel } from '@/domain/spam';
import type { FamilyContact } from '@/domain/types';

export interface Hit {
  key: string;
  title: string;
  subtitle?: string;
  href: Href;
}

export interface HitGroup {
  title: string;
  icon: IconName;
  hits: Hit[];
}

export const PEOPLE_GROUPS = ['Students', 'Families', 'Tutors'];

/**
 * Find anyone or anything: students (everyone), and for admins families (also by their other contacts), tutors,
 * invoices, enquiries, roles and applications. Plus the "View as" rows for the people found. Read only.
 */
export function useRecordSearch(query: string, admin: boolean) {
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
  // Families can also be found by their other contacts (a PA, the family office, a driver). Closed families are
  // matched by name only, so their contacts are never fetched. Loaded once someone starts typing.
  const openFamilyIds = useMemo(() => (families.data ?? []).filter((f) => !isClosed(f)).map((f) => f.id), [families.data]);
  const contacts = useContactsForFamilies(openFamilyIds, admin && query.trim().length >= 2);
  const contactIndex = useMemo(() => buildContactIndex(contacts), [contacts]);

  const groups = useMemo(() => {
    const q = norm(query.trim());
    if (q.length < 2) return [];
    const familyName = (id: string) => families.data?.find((f) => f.id === id)?.name ?? '';
    const viaContacts = admin ? familiesByContact(contactIndex, q) : new Map<string, FamilyContact>();
    const out: HitGroup[] = [
      {
        title: 'Students',
        icon: 'school',
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
          icon: 'group',
          // Closed accounts are matched by name only (never by their placeholder email) and say so.
          hits: closedLast(families.data, true)
            .map((f) => ({ f, direct: isClosed(f) ? matches(q, f.name) : matches(q, f.name, f.parentName, f.email, f.phone) }))
            .filter(({ f, direct }) => direct || (!isClosed(f) && viaContacts.has(f.id)))
            .map(({ f, direct }) => ({
              key: f.id,
              title: `${f.name} family`,
              subtitle: isClosed(f) ? CLOSED_LABEL : direct ? `${f.parentName} · ${f.email}` : `${f.parentName} · ${viaContact(viaContacts.get(f.id)!)}`,
              href: { pathname: '/manage/family-edit', params: { id: f.id } },
            })),
        },
        {
          title: 'Tutors',
          icon: 'person',
          hits: closedLast(tutors.data, true)
            .filter((t) => (isClosed(t) ? matches(q, t.fullName) : matches(q, t.fullName, t.email, ...t.subjects, ...(t.curricula ?? []), ...(t.phases ?? []))))
            .map((t) => ({ key: t.id, title: t.fullName, subtitle: isClosed(t) ? CLOSED_LABEL : t.subjects.join(', '), href: { pathname: '/manage/tutor-edit', params: { id: t.id } } })),
        },
        {
          title: 'Invoices',
          icon: 'receipt_long',
          hits: (invoices.data ?? [])
            .filter((i) => matches(q, i.number, familyName(i.familyId)))
            .map((i) => ({ key: i.id, title: `${i.number} — ${familyName(i.familyId)}`, subtitle: `${formatAED(invoiceTotals(i).total)} · ${i.status}`, href: { pathname: '/invoice/[id]', params: { id: i.id } } })),
        },
        {
          title: 'Enquiries',
          icon: 'inbox',
          hits: (enquiries.data ?? [])
            .filter((e) => matches(q, e.parentName, e.studentName, e.email, e.phone, e.subject, e.phase, e.curriculum))
            .map((e) => ({ key: e.id, title: e.parentName, subtitle: [e.studentName, e.subject, e.curriculum, e.status, spamLabel(e)].filter(Boolean).join(' · '), href: { pathname: '/manage/enquiry/[id]', params: { id: e.id } } })),
        },
        {
          title: 'Roles',
          icon: 'sell',
          hits: (opportunities.data ?? [])
            .filter((o) => matches(q, o.title, o.description, o.subject, o.phase, o.curriculum))
            .map((o) => ({ key: o.id, title: o.title, subtitle: [o.subject, o.phase, o.status].filter(Boolean).join(' · '), href: { pathname: '/manage/opportunity/[id]', params: { id: o.id } } })),
        },
        {
          title: 'Tutor applications',
          icon: 'person_add',
          hits: (applications.data ?? [])
            .filter((a) => matches(q, a.fullName, a.email))
            .map((a) => ({ key: a.id, title: a.fullName, subtitle: [a.email, a.status, spamLabel(a)].filter(Boolean).join(' · '), href: { pathname: '/manage/application/[id]', params: { id: a.id } } })),
        },
      );
    }
    return out.filter((g) => g.hits.length).map((g) => ({ ...g, hits: g.hits.slice(0, 8) }));
  }, [query, admin, students.data, families.data, contactIndex, tutors.data, invoices.data, enquiries.data, opportunities.data, applications.data, enrolments.data]);

  // Admins on their own account can open the app as any family, tutor or student found above.
  const viewRows = useMemo(() => {
    if (!canViewAs || !viewTargets.data) return [];
    const ids = (title: string) => groups.find((g) => g.title === title)?.hits.map((h) => ({ id: h.key, title: h.title })) ?? [];
    return viewAsRows(viewTargets.data, { families: ids('Families'), tutors: ids('Tutors'), students: ids('Students') });
  }, [canViewAs, viewTargets.data, groups]);

  return { groups, viewRows, viewAs };
}
