import { useMemo } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import {
  useCharges,
  useCreditNotes,
  useEnrolments,
  useExpenses,
  useInvoices,
  useLessons,
  usePackages,
  useRefunds,
  useSettings,
  useTutorCostEstimates,
  useTutorInvoices,
  useTutors,
} from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { addDays, startOfMonth, toDateKey } from '@/domain/dates';
import type { FinanceData } from '@/domain/finance';
import { useTheme } from '@/hooks/use-theme';

import { Row, Txt } from './ui';

const FROM = new Date(startOfMonth(new Date()).getFullYear(), startOfMonth(new Date()).getMonth() - 12, 1);
const TO = addDays(new Date(), 1);

/** Everything the money and insights screens need, for the last 13 months. */
export function useFinanceData(): { data: FinanceData | null; refetch: () => void; refreshing: boolean } {
  const charges = useCharges();
  const packages = usePackages();
  const invoices = useInvoices();
  const lessons = useLessons(FROM, TO);
  const tutors = useTutors();
  const tutorInvoices = useTutorInvoices();
  const expenses = useExpenses();
  const settings = useSettings();
  // Custom tutor pay per student, so the tutor-cost estimates match payroll.
  const enrolments = useEnrolments();
  const creditNotes = useCreditNotes();
  const refunds = useRefunds();
  // The accountant cannot read lessons, so their tutor-cost estimates come from the server as monthly totals.
  const fromLessons = useMe().role !== 'accountant';
  const estimates = useTutorCostEstimates(toDateKey(FROM), toDateKey(TO), !fromLessons);
  const data = useMemo(() => {
    if (!charges.data || !packages.data || !invoices.data || !lessons.data || !tutors.data || !tutorInvoices.data || !expenses.data || !settings.data || !enrolments.data) return null;
    if (!creditNotes.data || !refunds.data) return null;
    // Should the estimates fail to load, the screen shows tutor invoices only and says so (never a silent 0).
    if (!fromLessons && !estimates.data && !estimates.isError) return null;
    return {
      charges: charges.data,
      packages: packages.data,
      invoices: invoices.data,
      lessons: lessons.data,
      tutors: tutors.data,
      tutorInvoices: tutorInvoices.data,
      expenses: expenses.data,
      settings: settings.data,
      enrolments: enrolments.data,
      creditNotes: creditNotes.data,
      refunds: refunds.data,
      tutorCostEstimates: fromLessons ? undefined : estimates.data,
    };
  }, [
    charges.data,
    packages.data,
    invoices.data,
    lessons.data,
    tutors.data,
    tutorInvoices.data,
    expenses.data,
    settings.data,
    enrolments.data,
    creditNotes.data,
    refunds.data,
    fromLessons,
    estimates.data,
    estimates.isError,
  ]);
  return {
    data,
    refetch: () => {
      charges.refetch();
      invoices.refetch();
      expenses.refetch();
      tutorInvoices.refetch();
      creditNotes.refetch();
      refunds.refetch();
      if (!fromLessons) estimates.refetch();
    },
    refreshing: charges.isRefetching || expenses.isRefetching,
  };
}

/** A simple vertical bar chart built from Views. Negative values draw downwards in red. */
export function Bars({ items, height = 120 }: { items: { label: string; value: number; secondary?: number }[]; height?: number }) {
  const theme = useTheme();
  const max = Math.max(1, ...items.map((i) => Math.max(Math.abs(i.value), Math.abs(i.secondary ?? 0))));
  return (
    <View accessibilityRole="image" accessibilityLabel={items.map((i) => `${i.label} ${formatAED(i.value)}`).join(', ')}>
      <Row style={{ alignItems: 'flex-end', height, gap: 4 }}>
        {items.map((i) => (
          <View key={i.label} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', flexDirection: 'row', alignItems: 'flex-end', gap: 1 }}>
            <View style={{ flex: 1, height: `${(Math.abs(i.value) / max) * 100}%`, minHeight: i.value ? 2 : 0, backgroundColor: i.value < 0 ? theme.danger : theme.primary, borderRadius: 3 }} />
            {i.secondary !== undefined ? (
              <View style={{ flex: 1, height: `${(Math.abs(i.secondary) / max) * 100}%`, minHeight: i.secondary ? 2 : 0, backgroundColor: i.secondary < 0 ? theme.danger : theme.gold, borderRadius: 3 }} />
            ) : null}
          </View>
        ))}
      </Row>
      <Row style={{ gap: 4, marginTop: Spacing.one }}>
        {items.map((i) => (
          <Txt key={i.label} variant="small" style={{ flex: 1, textAlign: 'center', fontSize: 10 }} numberOfLines={1}>
            {i.label}
          </Txt>
        ))}
      </Row>
    </View>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <Row style={{ gap: Spacing.three }}>
      {items.map((i) => (
        <Row key={i.label} style={{ gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: i.color }} />
          <Txt variant="small">{i.label}</Txt>
        </Row>
      ))}
    </Row>
  );
}

/** Horizontal bars for a share-of-total breakdown. */
export function ShareBars({ items, format = formatAED }: { items: { label: string; value: number }[]; format?: (n: number) => string }) {
  const theme = useTheme();
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <View style={{ gap: Spacing.two }}>
      {items.map((i) => (
        <View key={i.label} style={{ gap: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt>{i.label}</Txt>
            <Txt variant="muted">{format(i.value)}</Txt>
          </Row>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.surfaceAlt }}>
            <View style={{ width: `${(i.value / max) * 100}%`, height: '100%', borderRadius: 4, backgroundColor: theme.accent }} />
          </View>
        </View>
      ))}
    </View>
  );
}
