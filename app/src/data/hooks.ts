import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { Family, Service, Student, Tutor } from '@/domain/types';

import { source } from './index';
import { queryClient } from './query';

/** Refetch everything after a write — the data set is small and this keeps every screen consistent. */
const invalidateAll = () => queryClient.invalidateQueries();

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => source.getSettings() });
export const useTutors = () => useQuery({ queryKey: ['tutors'], queryFn: () => source.listTutors() });
export const useFamilies = () => useQuery({ queryKey: ['families'], queryFn: () => source.listFamilies() });
export const useStudents = () => useQuery({ queryKey: ['students'], queryFn: () => source.listStudents() });
export const useServices = () => useQuery({ queryKey: ['services'], queryFn: () => source.listServices() });

export const useLessons = (from: Date, to: Date) =>
  useQuery({
    queryKey: ['lessons', from.toISOString(), to.toISOString()],
    queryFn: () => source.listLessons({ from: from.toISOString(), to: to.toISOString() }),
  });

export const useLesson = (id: string | undefined) =>
  useQuery({ queryKey: ['lesson', id], queryFn: () => source.getLesson(id!), enabled: !!id });

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
