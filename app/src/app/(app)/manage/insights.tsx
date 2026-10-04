import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { RiskRow, useAtRisk } from '@/components/insights';
import { Bars, ShareBars, useFinanceData } from '@/components/money';
import { Banner, Button, Card, Loading, ProgressBar, Row, Screen, Section, Stat, StatGrid, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAvailability, useEnquiries, useStudents } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { addDays, startOfDay } from '@/domain/dates';
import { monthSeries, receivables, revenueByCurriculum } from '@/domain/finance';
import { enquiryConversion, familyActivity, tutorUtilisation } from '@/domain/insights';
import { useTheme } from '@/hooks/use-theme';

/** Admin: how the business is doing, in a few simple charts, plus who needs attention. */
export default function Insights() {
  const theme = useTheme();
  const finance = useFinanceData();
  const students = useStudents();
  const enquiries = useEnquiries();
  const availability = useAvailability();
  const atRisk = useAtRisk();
  const [summary, setSummary] = useState<string | null>(null);
  const [summarising, setSummarising] = useState(false);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const now = useMemo(() => new Date(), []);

  const computed = useMemo(() => {
    const d = finance.data;
    if (!d || !students.data || !enquiries.data || !availability.data) return null;
    const series = monthSeries(now, 12, d);
    const from90 = addDays(startOfDay(now), -90);
    const recentCharges = d.charges.filter((c) => new Date(c.date) >= from90);
    const weekFrom = addDays(startOfDay(now), -28);
    const utilisation = d.tutors
      .map((t) => ({ tutor: t, ...tutorUtilisation(t.id, d.lessons, availability.data, weekFrom, startOfDay(now)) }))
      .filter((u) => u.availableHours > 0 || u.taughtHours > 0);
    return {
      series,
      byCurriculum: revenueByCurriculum(recentCharges, students.data, d.packages),
      utilisation,
      families: familyActivity(students.data, d.lessons, now),
      conversion: enquiryConversion(enquiries.data, addDays(now, -90).toISOString()),
      owed: receivables(d.invoices),
    };
  }, [finance.data, students.data, enquiries.data, availability.data, now]);

  if (!computed) return <Loading />;
  const { series, byCurriculum, utilisation, families, conversion } = computed;
  const thisMonth = series[series.length - 1];
  const lastMonth = series[series.length - 2];
  const change = lastMonth.revenue ? (thisMonth.revenue - lastMonth.revenue) / lastMonth.revenue : 0;

  async function summarise() {
    setSummarising(true);
    setSummaryFailed(false);
    const figures = {
      today: now.toISOString().slice(0, 10),
      months: series.slice(-6).map((m) => ({ month: m.month, revenue: m.revenue, tutorCosts: m.tutorCosts, expenses: m.expenses, profit: m.profit, cashIn: m.cashIn })),
      owedByFamilies: computed!.owed,
      revenueByCurriculumLast90Days: byCurriculum,
      tutorUtilisationLast4Weeks: utilisation.map((u) => ({ tutor: u.tutor.fullName.split(' ')[0], taughtHours: u.taughtHours, availableHours: u.availableHours })),
      families,
      enquiriesLast90Days: conversion,
      studentsAtRisk: atRisk.list.length,
    };
    const res = await source.aiAssist?.({ task: 'insights', figures: { ...figures, families: { ...families, lapsedFamilyIds: undefined } } });
    setSummarising(false);
    if (res?.task === 'insights') setSummary(res.summary);
    else setSummaryFailed(true);
  }

  return (
    <Screen onRefresh={finance.refetch} refreshing={finance.refreshing}>
      {source.aiAssist ? (
        <Card style={{ gap: Spacing.two }}>
          {summary ? <Txt>{summary}</Txt> : <Txt variant="muted">Get a plain-English read on the numbers below.</Txt>}
          {summaryFailed ? <Txt variant="small">AI summaries aren’t available right now.</Txt> : null}
          <Button title={summary ? 'Refresh summary' : 'Summarise for me'} icon="sparkle" variant="gold" size="sm" loading={summarising} onPress={summarise} />
        </Card>
      ) : null}

      <StatGrid>
        <Stat label={`Revenue ${thisMonth.label}`} value={formatAED(thisMonth.revenue)} hint={lastMonth.revenue ? `${change >= 0 ? '+' : ''}${Math.round(change * 100)}% vs ${lastMonth.label} (month to date)` : undefined} />
        <Stat label="Active families" value={String(families.active)} hint={`${families.new} new in 60 days`} tone="success" />
        <Stat label="Lapsed families" value={String(families.lapsed)} hint="no lessons in 30 days, none booked" tone={families.lapsed ? 'warning' : undefined} />
        <Stat
          label="Enquiry conversion"
          value={conversion.enrolled + conversion.lost ? `${Math.round(conversion.rate * 100)}%` : '–'}
          hint={`${conversion.total} enquiries in 90 days · ${conversion.open} open`}
        />
      </StatGrid>

      <Section title="Revenue by month">
        <Card>
          <Bars items={series.map((m) => ({ label: m.label.slice(0, 3), value: m.revenue }))} />
        </Card>
      </Section>

      <Section title="Revenue by curriculum (90 days)">
        <Card>{byCurriculum.length ? <ShareBars items={byCurriculum.map((c) => ({ label: c.curriculum, value: c.revenue }))} /> : <Txt variant="muted">No lessons yet.</Txt>}</Card>
      </Section>

      <Section title="Tutor utilisation (4 weeks)">
        <Card style={{ gap: Spacing.three }}>
          {utilisation.length === 0 ? <Txt variant="muted">Tutors haven’t set their availability yet.</Txt> : null}
          {utilisation.map((u) => (
            <View key={u.tutorId} style={{ gap: 4 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt>{u.tutor.fullName}</Txt>
                <Txt variant="muted">
                  {u.taughtHours}h of {u.availableHours}h{u.availableHours ? ` · ${Math.round(u.rate * 100)}%` : ''}
                </Txt>
              </Row>
              <ProgressBar value={u.rate * 100} color={u.rate > 0.85 ? theme.gold : undefined} />
            </View>
          ))}
          {utilisation.some((u) => u.rate > 0.85) ? <Txt variant="small">Gold = nearly full. Consider offering new students to tutors with spare hours.</Txt> : null}
        </Card>
      </Section>

      <Section title={`Students to check on (${atRisk.list.length})`}>
        {!atRisk.ready ? <Loading /> : null}
        {atRisk.ready && atRisk.list.length === 0 ? <Banner tone="success" icon="check">No students flagged. Everyone is attending, doing homework and booked in.</Banner> : null}
        {atRisk.list.map((r) => (
          <RiskRow key={r.studentId} risk={r} />
        ))}
      </Section>
    </Screen>
  );
}
