import { useInfiniteQuery, useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type { AuditCursor, AuditFilter, AuditPage } from '@/domain/audit';
import { assembleHandoverPack, type HandoverPack } from '@/domain/handover';
import { buildTopicLookup, type TopicLookup } from '@/domain/topics';
import type { Family, FamilyContact, Service, Student, Tutor } from '@/domain/types';

import { SYLLABUSES } from './curriculum';

import { source } from './index';
import { queryClient } from './query';
import { useSession } from './session';

/** Refetch everything after a write — the data set is small and this keeps every screen consistent. */
const invalidateAll = () => queryClient.invalidateQueries();

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => source.getSettings() });
export const useTutors = () => useQuery({ queryKey: ['tutors'], queryFn: () => source.listTutors() });
export const useFamilies = () => useQuery({ queryKey: ['families'], queryFn: () => source.listFamilies() });
export const useFamilyContacts = (familyId?: string) =>
  useQuery({ queryKey: ['familyContacts', familyId], queryFn: () => source.listFamilyContacts(familyId!), enabled: !!familyId });

const NO_CONTACTS: FamilyContact[] = [];
// Module-level, so TanStack keeps the combined list until a family's contacts actually change.
const combineContacts = (results: { data?: FamilyContact[] }[]) => {
  const all = results.flatMap((r) => r.data ?? []);
  return all.length ? all : NO_CONTACTS;
};

/** Every listed family's contacts (the same cache as useFamilyContacts), for search. Admins only. */
export function useContactsForFamilies(familyIds: readonly string[], enabled = true): FamilyContact[] {
  const admin = useSession((s) => s.profile?.role) === 'admin';
  return useQueries({
    queries: familyIds.map((id) => ({ queryKey: ['familyContacts', id], queryFn: () => source.listFamilyContacts(id), enabled: enabled && admin })),
    combine: combineContacts,
  });
}
export const useStudents = () => useQuery({ queryKey: ['students'], queryFn: () => source.listStudents() });
export const useServices = () => useQuery({ queryKey: ['services'], queryFn: () => source.listServices() });

export const useLessons = (from: Date, to: Date) =>
  useQuery({
    queryKey: ['lessons', from.toISOString(), to.toISOString()],
    queryFn: () => source.listLessons({ from: from.toISOString(), to: to.toISOString() }),
  });

export const useLesson = (id: string | undefined) =>
  useQuery({ queryKey: ['lesson', id], queryFn: () => source.getLesson(id!), enabled: !!id });

/** Admin: people the app can be viewed as. Off while already viewing. */
export function useViewTargets() {
  const enabled = useSession((s) => s.profile?.role === 'admin' && !s.viewing);
  return useQuery({ queryKey: ['view-targets'], queryFn: async () => (await source.listViewTargets?.()) ?? [], enabled });
}

export const useLoginEmails = () =>
  useQuery({ queryKey: ['login-emails'], queryFn: () => source.loginEmails?.() ?? Promise.resolve([] as string[]) });

export const useNotes = (filter: { studentId?: string; lessonId?: string } = {}) =>
  useQuery({ queryKey: ['notes', filter], queryFn: () => source.listNotes(filter) });

export const useHomework = (studentId?: string) =>
  useQuery({ queryKey: ['homework', studentId], queryFn: () => source.listHomework({ studentId }) });

export const useHomeworkItem = (id: string | undefined) =>
  useQuery({ queryKey: ['homework-item', id], queryFn: () => source.getHomework(id!), enabled: !!id });

export const useSubmissions = (filter: { homeworkId?: string; studentId?: string } = {}) =>
  useQuery({ queryKey: ['submissions', filter], queryFn: () => source.listSubmissions(filter) });

export const useResources = (filter: { studentId?: string } = {}) =>
  useQuery({ queryKey: ['resources', filter], queryFn: () => source.listResources(filter) });

export const useRatings = (studentId?: string) =>
  useQuery({ queryKey: ['ratings', studentId], queryFn: () => source.listRatings({ studentId }) });

export const usePackages = (familyId?: string) =>
  useQuery({ queryKey: ['packages', familyId], queryFn: () => source.listPackages({ familyId }) });

export const useCharges = (familyId?: string) =>
  useQuery({ queryKey: ['charges', familyId], queryFn: () => source.listCharges({ familyId }) });

export const useInvoices = (familyId?: string) =>
  useQuery({ queryKey: ['invoices', familyId], queryFn: () => source.listInvoices({ familyId }) });

export const useInvoice = (id: string | undefined) =>
  useQuery({ queryKey: ['invoice', id], queryFn: () => source.getInvoice(id!), enabled: !!id });

/** Wrap a data-source call as a mutation that refreshes all queries on success. */
export function useAction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => Promise<TResult>) {
  return useMutation({
    mutationFn: (args: TArgs) => fn(...args),
    onSuccess: invalidateAll,
  });
}

export interface Lookup {
  tutor(id: string): Tutor | undefined;
  student(id: string): Student | undefined;
  family(id: string): Family | undefined;
  service(id: string): Service | undefined;
  studentNames(ids: string[]): string;
  ready: boolean;
}

/** Id → record lookups for rendering lessons, invoices etc. */
export function useLookup(): Lookup {
  const tutors = useTutors();
  const students = useStudents();
  const families = useFamilies();
  const services = useServices();
  return useMemo(() => {
    const t = new Map((tutors.data ?? []).map((x) => [x.id, x]));
    const s = new Map((students.data ?? []).map((x) => [x.id, x]));
    const f = new Map((families.data ?? []).map((x) => [x.id, x]));
    const v = new Map((services.data ?? []).map((x) => [x.id, x]));
    return {
      tutor: (id) => t.get(id),
      student: (id) => s.get(id),
      family: (id) => f.get(id),
      service: (id) => v.get(id),
      studentNames: (ids) => ids.map((id) => s.get(id)?.fullName.split(' ')[0] ?? 'Student').join(' & '),
      ready: !!(tutors.data && students.data && families.data && services.data),
    };
  }, [tutors.data, students.data, families.data, services.data]);
}

// Engagement: enquiries, booking, calendar tools, messaging

export const useEnquiries = () => useQuery({ queryKey: ['enquiries'], queryFn: () => source.listEnquiries() });
export const useAvailability = () => useQuery({ queryKey: ['availability'], queryFn: () => source.listAvailability() });
export const useClosures = () => useQuery({ queryKey: ['closures'], queryFn: () => source.listClosures() });
export const useAbsences = () => useQuery({ queryKey: ['absences'], queryFn: () => source.listAbsences() });
export const useRequests = () => useQuery({ queryKey: ['requests'], queryFn: () => source.listRequests() });
export const useAnnouncements = () => useQuery({ queryKey: ['announcements'], queryFn: () => source.listAnnouncements() });

/** Conversations refresh every 15 seconds while on screen. */
export const useThreads = () =>
  useQuery({ queryKey: ['threads'], queryFn: () => source.listThreads(), refetchInterval: 15_000 });

export const useMessages = (familyId: string | undefined) =>
  useQuery({
    queryKey: ['messages', familyId],
    queryFn: () => source.listMessages(familyId!),
    enabled: !!familyId,
    refetchInterval: 10_000,
  });

export const useOpenSlots = (input: { tutorId?: string; from: string; days: number; durationMin?: number; ignoreLessonId?: string }) =>
  useQuery({
    queryKey: ['open-slots', input],
    queryFn: () => source.openSlots({ ...input, tutorId: input.tutorId!, durationMin: input.durationMin! }),
    enabled: !!input.tutorId && !!input.durationMin,
  });

/** Total unread messages, for tab and header badges. */
export function useUnreadCount(): number {
  const threads = useThreads();
  return (threads.data ?? []).reduce((n, t) => n + t.unread, 0);
}

// Running the business: roles, hiring, tutor pay, reports, money

export const useOpportunities = () => useQuery({ queryKey: ['opportunities'], queryFn: () => source.listOpportunities() });
export const useBids = () => useQuery({ queryKey: ['bids'], queryFn: () => source.listBids() });
export const useApplications = () => useQuery({ queryKey: ['applications'], queryFn: () => source.listApplications() });
export const usePaymentDetails = (tutorId: string | undefined) =>
  useQuery({ queryKey: ['payment-details', tutorId], queryFn: () => source.getPaymentDetails(tutorId!), enabled: !!tutorId });
export const useTutorInvoices = () => useQuery({ queryKey: ['tutor-invoices'], queryFn: () => source.listTutorInvoices() });
export const useReportCycles = () => useQuery({ queryKey: ['report-cycles'], queryFn: () => source.listReportCycles() });
export const useStudentReports = () => useQuery({ queryKey: ['student-reports'], queryFn: () => source.listStudentReports() });
export const useExpenses = () => useQuery({ queryKey: ['expenses'], queryFn: () => source.listExpenses() });
/** Monthly estimated tutor cost totals (admins and the accountant), from `from`'s month to `to`'s. */
export const useTutorCostEstimates = (from: string, to: string, enabled = true) =>
  useQuery({ queryKey: ['tutor-cost-estimates', from, to], queryFn: () => source.tutorCostEstimates(from, to), enabled });

// Subjects: enrolments and shared topic lists

export const useEnrolments = (studentId?: string) =>
  useQuery({ queryKey: ['enrolments', studentId], queryFn: () => source.listEnrolments(studentId ? { studentId } : undefined) });
export const useTopicLists = () => useQuery({ queryKey: ['topic-lists'], queryFn: () => source.listTopicLists() });
export const useTopics = () => useQuery({ queryKey: ['topics'], queryFn: () => source.listTopics() });

/** Topic names, units and trees from the built-in syllabuses plus the shared lists stored on the server. */
export function useTopicLookup(): TopicLookup & { ready: boolean } {
  const lists = useTopicLists();
  const topics = useTopics();
  return useMemo(() => {
    const lookup = buildTopicLookup(SYLLABUSES, lists.data ?? [], topics.data ?? []);
    return {
      name: lookup.name,
      unit: lookup.unit,
      subjectOf: lookup.subjectOf,
      treeFor: lookup.treeFor,
      builtIn: lookup.builtIn,
      ready: !!(lists.data && topics.data),
    };
  }, [lists.data, topics.data]);
}

// Google Calendar (tutors and admin only; families never see busy times)

function useCanUseCalendar(): boolean {
  const role = useSession((s) => s.profile?.role);
  return role === 'admin' || role === 'tutor';
}

/** Google busy times overlapping the range, optionally for one tutor. Empty for parents and students. */
export function useBusyBlocks(from: Date, to: Date, tutorId?: string) {
  const enabled = useCanUseCalendar();
  return useQuery({
    queryKey: ['busy-blocks', from.toISOString(), to.toISOString(), tutorId ?? null],
    queryFn: () => source.listBusyBlocks?.({ tutorId, from: from.toISOString(), to: to.toISOString() }) ?? Promise.resolve([]),
    enabled,
  });
}

/** The signed-in tutor's or admin's Google Calendar link, or null. */
export function useCalendarConnection() {
  const enabled = useCanUseCalendar();
  return useQuery({
    queryKey: ['calendar-connection'],
    queryFn: () => source.getCalendarConnection?.() ?? Promise.resolve(null),
    enabled,
  });
}

// Card payments: saved cards, autopay and top-ups

export const usePackageOffers = () => useQuery({ queryKey: ['package-offers'], queryFn: () => source.listPackageOffers() });

// Audit trail (admins only)

/** Admin audit trail, newest first, a page at a time. */
export const useAuditHistory = (filter: AuditFilter, pageSize = 20, enabled = true) =>
  useInfiniteQuery({
    queryKey: ['audit', filter, pageSize],
    queryFn: ({ pageParam }): Promise<AuditPage> =>
      source.listAuditEvents
        ? source.listAuditEvents(filter, { before: pageParam ?? undefined, limit: pageSize })
        : Promise.resolve({ events: [], next: null }),
    initialPageParam: null as AuditCursor | null,
    getNextPageParam: (last) => last.next,
    enabled,
  });

/** Everyone who appears in the audit trail, for the person filter. */
export const useAuditActors = (enabled = true) =>
  useQuery({ queryKey: ['audit-actors'], queryFn: () => source.listAuditActors?.() ?? Promise.resolve([]), enabled });
// Tax: credit notes, refunds and accountant access

export const useCreditNotes = (filter?: { familyId?: string; invoiceId?: string }) =>
  useQuery({ queryKey: ['credit-notes', filter], queryFn: () => source.listCreditNotes(filter) });

export const useCreditNote = (id: string | undefined) =>
  useQuery({ queryKey: ['credit-note', id], queryFn: () => source.getCreditNote(id!), enabled: !!id });

export const useRefunds = (filter?: { familyId?: string; invoiceId?: string }) =>
  useQuery({ queryKey: ['refunds', filter], queryFn: () => source.listRefunds(filter) });

export const useAccountants = () => useQuery({ queryKey: ['accountants'], queryFn: () => source.listAccountants() });
// Admissions advisory
export const useAdmissionsCases = (studentId?: string) =>
  useQuery({ queryKey: ['admissions-cases', studentId], queryFn: () => source.listAdmissionsCases({ studentId }) });

export const useAdmissionsCase = (id: string | undefined) =>
  useQuery({ queryKey: ['admissions-case', id], queryFn: () => source.getAdmissionsCase(id!), enabled: !!id });

export const useAdmissionsTargets = (caseId?: string) =>
  useQuery({ queryKey: ['admissions-targets', caseId], queryFn: () => source.listAdmissionsTargets({ caseId }) });

export const useAdmissionsKeyDates = (filter: { caseId?: string; from?: string; to?: string } = {}) =>
  useQuery({ queryKey: ['admissions-dates', filter], queryFn: () => source.listAdmissionsKeyDates(filter) });

export const useAdmissionsTasks = (caseId?: string) =>
  useQuery({ queryKey: ['admissions-tasks', caseId], queryFn: () => source.listAdmissionsTasks({ caseId }) });

export const useAdmissionsDocuments = (caseId?: string) =>
  useQuery({ queryKey: ['admissions-documents', caseId], queryFn: () => source.listAdmissionsDocuments({ caseId }) });

export const useAdvisoryUpdates = (caseId?: string) =>
  useQuery({ queryKey: ['admissions-updates', caseId], queryFn: () => source.listAdvisoryUpdates({ caseId }) });

export const useAdmissionsEvents = (caseId?: string) =>
  useQuery({ queryKey: ['admissions-events', caseId], queryFn: () => source.listAdmissionsEvents({ caseId }) });
// Tutor vetting and onboarding

export const useTutorDocuments = (tutorId?: string) =>
  useQuery({ queryKey: ['tutor-documents', tutorId], queryFn: () => source.listTutorDocuments(tutorId ? { tutorId } : undefined) });
export const useTutorCompliance = () => useQuery({ queryKey: ['tutor-compliance'], queryFn: () => source.listTutorCompliance() });
export const useVettingOverrides = (tutorId?: string) =>
  useQuery({ queryKey: ['vetting-overrides', tutorId], queryFn: () => source.listVettingOverrides(tutorId ? { tutorId } : undefined) });
export const useVettingEnforced = () => useQuery({ queryKey: ['vetting-enforced'], queryFn: () => source.getVettingEnforced() });
export const useHandbookVersions = () => useQuery({ queryKey: ['handbook-versions'], queryFn: () => source.listHandbookVersions() });
export const useHandbookAcks = (tutorId?: string) =>
  useQuery({
    queryKey: ['handbook-acks', tutorId],
    queryFn: () => source.listHandbookAcknowledgements(tutorId ? { tutorId } : undefined),
  });

// Launch readiness: system health, error logs and deletion requests (admins only)

function useIsAdmin(): boolean {
  return useSession((s) => s.profile?.role) === 'admin';
}

/** The system health report, refreshed every minute while on screen. */
export function useSystemHealth() {
  const enabled = useIsAdmin();
  return useQuery({ queryKey: ['system-health'], queryFn: () => source.getSystemHealth(), enabled, refetchInterval: 60_000 });
}

export function useAppErrors(limit = 50) {
  const enabled = useIsAdmin();
  return useQuery({ queryKey: ['app-errors', limit], queryFn: () => source.listAppErrors(limit), enabled });
}

export function useFunctionErrors(limit = 50) {
  const enabled = useIsAdmin();
  return useQuery({ queryKey: ['function-errors', limit], queryFn: () => source.listFunctionErrors(limit), enabled });
}

export function useDeletionRequests() {
  const enabled = useIsAdmin();
  return useQuery({ queryKey: ['deletion-requests'], queryFn: () => source.listDeletionRequests(), enabled });
}

/** After a deletion request changes, refresh it and every list an anonymised account appears in. */
const DELETION_AFFECTS = [
  'deletion-requests', 'families', 'familyContacts', 'tutors', 'students', 'lessons', 'invoices', 'invoice',
  'credit-notes', 'credit-note', 'enquiries', 'accountants', 'admissions-cases', 'admissions-case',
  'handovers', 'handover-pack', 'tutor-documents', 'tutor-compliance', 'audit', 'audit-actors', 'system-health',
];
const invalidateDeletion = () =>
  Promise.all(DELETION_AFFECTS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

export const useRecordDeletionRequest = () =>
  useMutation({
    mutationKey: ['record-deletion-request'],
    mutationFn: (target: { profileId?: string; familyId?: string; tutorId?: string; reason?: string }) => source.recordDeletionRequest(target),
    onSuccess: invalidateDeletion,
  });

export const useCancelDeletionRequest = () =>
  useMutation({ mutationKey: ['cancel-deletion-request'], mutationFn: (id: string) => source.cancelDeletionRequest(id), onSuccess: invalidateDeletion });

export const useProcessDeletionRequest = () =>
  useMutation({ mutationKey: ['process-deletion-request'], mutationFn: (id: string) => source.processDeletionRequest(id), onSettled: invalidateDeletion });

// Session plans and handover packs

export const useLessonPlan = (lessonId: string | undefined) =>
  useQuery({ queryKey: ['lesson-plan', lessonId], queryFn: () => source.getLessonPlan(lessonId!), enabled: !!lessonId });

export const useLessonPlans = (from: Date, to: Date) =>
  useQuery({
    queryKey: ['lesson-plans', from.toISOString(), to.toISOString()],
    queryFn: () => source.listLessonPlans({ from: from.toISOString(), to: to.toISOString() }),
  });

export const useHandovers = (filter: { studentId?: string; lessonId?: string } = {}) =>
  useQuery({ queryKey: ['handovers', filter], queryFn: () => source.listHandovers(filter) });

/** Fetches the sources and assembles the pack with the topic lookup. */
export function useHandoverPack(id: string | undefined): { pack: HandoverPack | undefined; isLoading: boolean; error: unknown; refetch: () => void } {
  const sources = useQuery({ queryKey: ['handover-pack', id], queryFn: () => source.getHandoverSources(id!), enabled: !!id });
  const topics = useTopicLookup();
  const [now] = useState(() => new Date());
  const pack = useMemo(
    () => (sources.data && topics.ready ? assembleHandoverPack(sources.data, topics, now) : undefined),
    [sources.data, topics, now],
  );
  const { refetch } = sources;
  return {
    pack,
    isLoading: sources.isLoading || (!!sources.data && !topics.ready),
    error: sources.error,
    refetch: () => void refetch(),
  };
}
