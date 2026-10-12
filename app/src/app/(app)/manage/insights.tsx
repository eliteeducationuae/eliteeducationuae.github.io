import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAtRisk } from '@/components/insights';
import { useFinanceData } from '@/components/money';
import { BarList, NoirPanel, useStackBack } from '@/components/money/blocks';
import { monthName } from '@/components/money/format';
import { HeaderActions } from '@/components/role-tabs';
import { Button, Columns, Figure, Figures, Group, GroupRow, Loading, Notice, PageHeader, Screen, Txt, useWide } from '@/components/ui';
import { font } from '@/constants/theme';
import { source } from '@/data';
import { useAvailability, useEnquiries, useStudents } from '@/data/hooks';
import { formatAED, formatPercent } from '@/domain/billing';
import { addDays, startOfDay } from '@/domain/dates';
import { monthSeries, receivables, revenueBySubject } from '@/domain/finance';
import { enquiryConversion, familyActivity, tutorUtilisation, type StudentRisk } from '@/domain/insights';
import type { Student } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { plural } from '@/lib/id';

/** Nearly fully booked: drawn in gold, and not suggested for new students. */
const NEARLY_FULL = 0.85;

/** Admin: how the business is doing in a few plain figures and bars, plus the students worth checking on. */
export default function Insights() {
  const theme = useTheme();
  const wide = useWide();
  const stack = useStackBack();
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
      .filter((u) => u.availableHours > 0 || u.taughtHours > 0)
      .sort((a, b) => b.rate - a.rate);
    return {
      series,
      // d.lessons spans the last 13 months, so it covers every charge from the last 90 days.
      bySubject: revenueBySubject(recentCharges, d.lessons, d.packages),
      utilisation,
      families: familyActivity(students.data, d.lessons, now),
      conversion: enquiryConversion(enquiries.data, addDays(now, -90).toISOString()),
      owed: receivables(d.invoices),
    };
  }, [finance.data, students.data, enquiries.data, availability.data, now]);

  const header = (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader back={stack} kicker="Business" title="Insights" right={stack ? undefined : <HeaderActions search inbox />} />
    </>
  );
  if (!computed) {
    return (
      <Screen topInset>
        {header}
        <Loading />
      </Screen>
    );
  }
  const { series, bySubject, utilisation, families, conversion } = computed;
  const thisMonth = series[series.length - 1];
  const lastMonth = series[series.length - 2];
  const change = lastMonth.revenue ? (thisMonth.revenue - lastMonth.revenue) / lastMonth.revenue : 0;
  const subjectTotal = bySubject.reduce((s, c) => s + c.revenue, 0);
  const subjectMax = Math.max(1, ...bySubject.map((c) => c.revenue));
  // Tutors with room for more: under 60% booked, with availability set.
  const spare = utilisation.filter((u) => u.availableHours > 0 && u.rate < 0.6).map((u) => u.tutor.fullName.split(' ')[0]);

  async function summarise() {
    setSummarising(true);
    setSummaryFailed(false);
    const figures = {
      today: now.toISOString().slice(0, 10),
      months: series
        .slice(-6)
        .map((m) => ({ month: m.month, revenue: m.revenue, tutorCosts: m.tutorCosts, expenses: m.expenses, profit: m.profit, cashIn: m.cashIn })),
      owedByFamilies: computed!.owed,
      revenueBySubjectLast90Days: bySubject,
      tutorUtilisationLast4Weeks: utilisation.map((u) => ({
        tutor: u.tutor.fullName.split(' ')[0],
        taughtHours: u.taughtHours,
        availableHours: u.availableHours,
      })),
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
    <Screen topInset onRefresh={finance.refetch} refreshing={finance.refreshing}>
      {header}
      {source.aiAssist ? (
        <NoirPanel kicker="In plain English" icon="auto_awesome">
          {summary ? (
            <Text style={[font('serif'), { fontSize: wide ? 21 : 18, lineHeight: wide ? 30 : 26, color: theme.onHero }]} accessibilityLiveRegion="polite">
              {summary}
            </Text>
          ) : (
            <Text style={[font('sans'), { fontSize: 16, lineHeight: 23, color: theme.onHeroMuted }]}>A short written summary of the figures below.</Text>
          )}
          {summaryFailed ? <Txt variant="small">Summaries are not available at the moment. Please try again later.</Txt> : null}
          <View style={{ alignSelf: 'flex-start', marginTop: 4 }}>
            <Button title={summary ? 'Refresh summary' : 'Summarise the figures'} size="sm" loading={summarising} onPress={summarise} />
          </View>
        </NoirPanel>
      ) : null}

      <Figures>
        <Figure
          label={`Revenue ${monthName(thisMonth.month)}`}
          value={formatAED(thisMonth.revenue)}
          hint={lastMonth.revenue ? `${change >= 0 ? '+' : ''}${formatPercent(change)} on ${monthName(lastMonth.month)} (month to date)` : undefined}
        />
        <Figure label="Active families" value={String(families.active)} hint={`${families.new} new in the last 60 days`} tone="good" />
        <Figure label="Lapsed families" value={String(families.lapsed)} hint="no lessons in 30 days, none booked" tone={families.lapsed ? 'warn' : undefined} />
        <Figure
          label="Enquiry conversion"
          value={conversion.enrolled + conversion.lost ? `${Math.round(conversion.rate * 100)}%` : '–'}
          hint={`${conversion.total} enquiries in 90 days · ${conversion.open} open`}
        />
      </Figures>

      <Columns>
        <View style={{ gap: 12 }}>
          <Txt variant="groupTitle" accessibilityRole="header">
            Revenue by subject · 90 days
          </Txt>
          {bySubject.length ? (
            <BarList
              items={bySubject.map((c) => ({
                label: c.subject,
                value: `${formatAED(c.revenue)} · ${subjectTotal ? Math.round((c.revenue / subjectTotal) * 100) : 0}%`,
                share: c.revenue / subjectMax,
              }))}
            />
          ) : (
            <Group note="Revenue will appear here once lessons have been taught." />
          )}
        </View>
        <View style={{ gap: 12 }}>
          <Txt variant="groupTitle" accessibilityRole="header">
            Tutor capacity · 4 weeks
          </Txt>
          {utilisation.length ? (
            <BarList
              items={utilisation.map((u) => ({
                label: u.tutor.fullName,
                value: `${u.taughtHours}h of ${u.availableHours}h${u.availableHours ? ` · ${Math.round(u.rate * 100)}%` : ''}`,
                share: u.rate,
                gold: u.rate > NEARLY_FULL,
              }))}
              footnote={
                [
                  utilisation.some((u) => u.rate > NEARLY_FULL) ? 'Gold marks tutors who are nearly fully booked.' : '',
                  spare.length && utilisation.some((u) => u.rate > NEARLY_FULL)
                    ? `New students are better offered to ${spare.length === 1 ? spare[0] : `${spare.slice(0, -1).join(', ')} or ${spare[spare.length - 1]}`}.`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            />
          ) : (
            <Group note="Capacity will appear here once tutors have set their availability." />
          )}
        </View>
      </Columns>

      <Group title="Students to check on" meta={atRisk.ready && atRisk.list.length ? plural(atRisk.list.length, 'student') : undefined}>
        {!atRisk.ready ? <Loading /> : null}
        {atRisk.list.map((r) => (
          <RiskRow key={r.studentId} risk={r} />
        ))}
      </Group>
      {atRisk.ready && atRisk.list.length === 0 ? (
        <Notice tone="good">No students are flagged. Every student is attending, completing homework and booked in.</Notice>
      ) : null}
    </Screen>
  );
}

/** One student to check on: why, and the action that helps most (book lessons, or message the family). */
function RiskRow({ risk }: { risk: StudentRisk & { student: Student } }) {
  const s = risk.student;
  const top = [...risk.signals].sort((a, b) => b.weight - a.weight)[0];
  const familyId = s.familyId;
  const action =
    top?.key === 'no-lessons'
      ? { label: 'Book lessons', onPress: () => router.push({ pathname: '/lesson/new', params: { studentId: s.id } }) }
      : familyId
        ? { label: 'Message family', onPress: () => router.push({ pathname: '/messages/[familyId]', params: { familyId } }) }
        : undefined;
  return (
    <GroupRow
      icon={risk.score >= 60 ? 'report' : 'flag'}
      tone={risk.score >= 60 ? 'bad' : 'warn'}
      title={s.fullName}
      note={risk.signals.map((x) => x.label).join(' · ')}
      onPress={() => router.push({ pathname: '/students/[id]', params: { id: s.id } })}
      accessibilityHint="Opens the student"
      action={action ? { ...action, accessibilityLabel: `${action.label}: ${s.fullName}` } : undefined}
    />
  );
}
