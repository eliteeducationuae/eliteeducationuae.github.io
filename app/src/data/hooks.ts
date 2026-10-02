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

export const useNotes = (filter: { studentId?: string; lessonId?: string } = {}) =>
  useQuery({ queryKey: ['notes', filter], queryFn: () => source.listNotes(filter) });

export const useHomework = (studentId?: string) =>
  useQuery({ queryKey: ['homework', studentId], queryFn: () => source.listHomework({ studentId }) });

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
