import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { DayRibbon, LessonRow } from '@/components/admin/day';
import { DecisionList, useDecisions } from '@/components/admin/decisions';
import { AdminPage, longDate, monthName, NoirHero, RuledFigures, SectionHead, shortAED, Split, SplitCol } from '@/components/admin/kit';
import { Icon } from '@/components/icon';
import { SpamReviewLine } from '@/components/spam';
import { Loading, useWide } from '@/components/ui';
import { Brand, font } from '@/constants/theme';
import { useApplications, useCharges, useEnquiries, useEnrolments, useInvoices, useLessons, useLookup, usePackages, useUnreadCount } from '@/data/hooks';
import { useMe } from '@/data/session';
import { chargeRevenue, invoiceTotals } from '@/domain/billing';
import { addDays, isSameDay, startOfDay, startOfMonth } from '@/domain/dates';
import { countWords, greetingLine } from '@/domain/greeting';
import { byStart } from '@/domain/scheduling';
import { suspectedCount } from '@/domain/spam';
import { useTheme } from '@/hooks/use-theme';
import { plural } from '@/lib/id';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Six lessons today, one in progress now. Two decisions await you; the rest is in hand." */
function summaryLine(lessons: number, inProgress: number, decisions: number): string {
  const running = inProgress ? `, ${countWords(inProgress, 'x').split(' ')[0]} in progress now` : '';
  const day = `${cap(countWords(lessons, 'lesson'))} today${running}.`;
  const rest = decisions ? `${cap(countWords(decisions, 'decision'))} ${decisions === 1 ? 'awaits' : 'await'} you; the rest is in hand.` : 'Nothing awaits your decision.';
  return `${day} ${rest}`;
}

export default function AdminToday() {
  const me = useMe();
  const theme = useTheme();
  const wide = useWide();
  const lookup = useLookup();
  const [now] = useState(() => new Date());
  const today = startOfDay(now);
  const monthStart = startOfMonth(now);
  const lastMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);
  const lessons = useLessons(today, addDays(today, 1));
  const enrolments = useEnrolments();
  const charges = useCharges();
  const invoices = useInvoices();
  const packages = usePackages();
  const enquiries = useEnquiries();
  const applications = useApplications();
  const unread = useUnreadCount();
  const decisions = useDecisions();

  const todays = (lessons.data ?? []).filter((l) => isSameDay(new Date(l.start), now)).sort(byStart);
  const active = todays.filter((l) => l.status !== 'cancelled' && l.status !== 'late-cancel');
  const inProgress = active.filter((l) => l.status === 'scheduled' && new Date(l.start) <= now && new Date(l.end) > now).length;
  const inRange = (from: Date, to: Date) => (charges.data ?? []).filter((c) => new Date(c.date) >= from && new Date(c.date) < to);
  const earned = chargeRevenue(inRange(monthStart, addDays(now, 1)), packages.data ?? []);
  const lastEarned = chargeRevenue(inRange(lastMonthStart, monthStart), packages.data ?? []);
  const open = (invoices.data ?? []).filter((i) => i.status === 'sent');
  const owed = open.reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const unbilled = (charges.data ?? []).filter((c) => c.status === 'unbilled');
  const toInvoice = unbilled.reduce((s, c) => s + c.amount, 0);
  const unbilledFamilies = new Set(unbilled.map((c) => c.familyId)).size;
  const lastMonthName = monthName(lastMonthStart);
  const loading = lessons.isLoading || !lookup.ready;
  const waiting = decisions.items.length;
  // Three figures share a phone's width, so amounts from AED 1,000 read as AED 4.6k there.
  const compact = wide ? 10_000 : 1000;

  return (
    <AdminPage onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <NoirHero
        kicker={longDate(now)}
        title={`${greetingLine(now, me.fullName.split(' ')[0])}.`}
        line={loading || !decisions.ready ? undefined : summaryLine(active.length, inProgress, waiting)}
        right={
          wide ? undefined : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Pressable
                onPress={() => router.push('/messages')}
                accessibilityRole="button"
                accessibilityLabel={unread ? `Messages, ${unread} unread` : 'Messages'}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="forum" size={22} color={theme.onHero} />
                {unread ? <View style={{ position: 'absolute', top: 10, right: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: Brand.gold }} /> : null}
              </Pressable>
              <View style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: Brand.gold, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[font('serif'), { fontSize: 12.5, color: theme.onHero }]}>{initials(me.fullName)}</Text>
              </View>
            </View>
          )
        }
      />

      <View style={{ marginTop: wide ? 10 : 16 }}>
        <Split>
          <SplitCol basis={420}>
            <SectionHead
              title="For your decision"
              meta={waiting ? 'Act here where you can, or open the item.' : 'All clear for now.'}
              right={waiting ? <Text style={[font('serif'), { fontSize: 15, color: theme.accent }]}>{waiting} waiting</Text> : undefined}
            />
            <View style={{ height: 2, backgroundColor: theme.border }} />
            {decisions.ready ? <DecisionList decisions={decisions.items} error={decisions.error} /> : <Loading />}
            {/* Held as possible spam: a quiet pointer, deliberately outside the decisions and their count. */}
            <SpamReviewLine enquiries={suspectedCount(enquiries.data)} applications={suspectedCount(applications.data)} />
          </SplitCol>

          <SplitCol basis={360} gap={36}>
            <View style={{ gap: 16 }}>
              <SectionHead title="The day" link={{ label: 'Open diary', onPress: () => router.navigate('/admin/calendar') }} />
              {loading ? (
                <Loading />
              ) : todays.length ? (
                <>
                  <DayRibbon lessons={todays} lookup={lookup} now={now} />
                  <View>
                    {todays.map((l) => (
                      <LessonRow key={l.id} lesson={l} lookup={lookup} enrolments={enrolments.data ?? []} now={now} />
                    ))}
                  </View>
                </>
              ) : (
                <View style={{ paddingVertical: 28, alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: theme.border }}>
                  <Text style={[font('serif'), { fontSize: 20, color: theme.text }]}>A quiet day.</Text>
                  <Text style={[font('sans'), { fontSize: 14.5, color: theme.textMuted, textAlign: 'center' }]}>No lessons are booked for today.</Text>
                </View>
              )}
            </View>

            <View style={{ gap: 14 }}>
              <SectionHead title="The month" />
              <RuledFigures
                items={[
                  { label: 'Earned', value: shortAED(earned, compact), hint: `${shortAED(lastEarned, compact)} in ${lastMonthName}`, onPress: () => router.push('/manage/money') },
                  { label: 'Owed', value: shortAED(owed, compact), hint: plural(open.length, 'invoice'), onPress: () => router.navigate('/admin/billing') },
                  { label: 'To invoice', value: shortAED(toInvoice, compact), hint: plural(unbilledFamilies, 'family', 'families'), onPress: () => router.navigate('/admin/billing') },
                ]}
              />
            </View>
          </SplitCol>
        </Split>
      </View>
    </AdminPage>
  );
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}
