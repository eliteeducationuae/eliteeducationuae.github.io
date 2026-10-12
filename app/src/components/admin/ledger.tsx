/**
 * The admin Ledger: what is owed (with an ageing bar), collected and earned this month, links to Money, VAT returns
 * and Insights, "Ready to invoice" with checkboxes (issuing is the existing per-family invoiceUnbilled, run for each
 * family ticked), the invoices with Open / Overdue / Paid / All, and recent credit notes.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { font, tabular } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useCharges, useCreditNotes, useInvoices, useLookup, usePackages } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { chargeRevenue, displayStatus, formatAED, invoiceTotals, type DisplayInvoiceStatus } from '@/domain/billing';
import { addDays, formatDate, startOfMonth } from '@/domain/dates';
import { joinNames } from '@/domain/greeting';
import type { Invoice } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import type { Palette } from '@/constants/theme';
import { confirm } from '@/lib/confirm';
import { plural } from '@/lib/id';

import { ErrorNote, Loading, useToast, useWide } from '../ui';
import { AdminPage, CheckSquare, InlineLink, LinkPill, monthName, PageTitle, PillButton, RuledFigures, RuledList, SectionHead, StatusText, TextFilters } from './kit';

const web = Platform.OS === 'web';
const webStyle = (s: Record<string, unknown>): ViewStyle => (web ? (s as ViewStyle) : {});

type Filter = 'open' | 'overdue' | 'paid' | 'all';
const FILTERS: Filter[] = ['open', 'overdue', 'paid', 'all'];

const STATUS: Record<DisplayInvoiceStatus, { label: string; color: keyof Palette }> = {
  draft: { label: 'Draft', color: 'textMuted' },
  sent: { label: 'Due', color: 'text' },
  'part-paid': { label: 'Part paid', color: 'warning' },
  overdue: { label: 'Overdue', color: 'danger' },
  paid: { label: 'Paid', color: 'success' },
  void: { label: 'Void', color: 'textMuted' },
  credited: { label: 'Credited', color: 'textMuted' },
};

const short = (d: string) => formatDate(d).replace(/ \d{4}$/, '');

export function Ledger() {
  const theme = useTheme();
  const wide = useWide();
  const viewing = useViewing();
  const toast = useToast();
  const params = useLocalSearchParams<{ filter?: string }>();
  const lookup = useLookup();
  const charges = useCharges();
  const invoices = useInvoices();
  const packages = usePackages();
  const creditNotes = useCreditNotes();
  const invoice = useAction(source.invoiceUnbilled);
  const [filter, setFilter] = useState<Filter>(() => (FILTERS.includes(params.filter as Filter) ? (params.filter as Filter) : 'open'));
  // A new ?filter= (from Today or the concierge) picks that filter.
  const [seenParam, setSeenParam] = useState(params.filter);
  if (params.filter !== seenParam) {
    setSeenParam(params.filter);
    if (FILTERS.includes(params.filter as Filter)) setFilter(params.filter as Filter);
  }
  const [now] = useState(() => new Date());
  const monthStart = startOfMonth(now);
  const lastMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);

  // Ready to invoice, by family.
  const ready = useMemo(() => {
    const m = new Map<string, { total: number; count: number; students: Set<string> }>();
    for (const c of charges.data ?? []) {
      if (c.status !== 'unbilled') continue;
      const e = m.get(c.familyId) ?? { total: 0, count: 0, students: new Set<string>() };
      e.total += c.amount;
      e.count += 1;
      e.students.add(c.studentId);
      m.set(c.familyId, e);
    }
    return [...m.entries()].map(([familyId, e]) => ({ familyId, ...e })).sort((a, b) => b.total - a.total);
  }, [charges.data]);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [issuing, setIssuing] = useState(false);
  const picked = ready.filter((r) => !unticked.has(r.familyId));
  const pickedTotal = picked.reduce((s, r) => s + r.total, 0);
  const toggle = (id: string) =>
    setUnticked((u) => {
      const n = new Set(u);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function issue() {
    const ids = picked.map((r) => r.familyId);
    setIssuing(true);
    let done = 0;
    let last: Invoice | null = null;
    try {
      for (const id of ids) {
        last = await invoice.mutateAsync([id]);
        done += 1;
      }
    } finally {
      setIssuing(false);
      setUnticked(new Set());
    }
    if (done === 1 && last) {
      toast(`${last.number} issued to the ${lookup.family(last.familyId)?.name ?? ''} family.`);
      router.push({ pathname: '/invoice/[id]', params: { id: last.id } });
    } else if (done) toast(`${done} invoices issued and sent to families.`);
  }

  const all = invoices.data ?? [];
  const open = all.filter((i) => i.status === 'sent');
  const late = open.filter((i) => displayStatus(i, now) === 'overdue').reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const owed = open.reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const current = Math.max(0, owed - late);
  const collected = all.flatMap((i) => i.payments).filter((p) => new Date(p.paidAt) >= monthStart).reduce((s, p) => s + p.amount, 0);
  const inRange = (from: Date, to: Date) => (charges.data ?? []).filter((c) => new Date(c.date) >= from && new Date(c.date) < to);
  const earned = chargeRevenue(inRange(monthStart, addDays(now, 1)), packages.data ?? []);
  const lastEarned = chargeRevenue(inRange(lastMonthStart, monthStart), packages.data ?? []);
  const month = monthName(now);
  const shown = all
    .filter((i) => {
      const st = displayStatus(i, now);
      if (filter === 'open') return i.status === 'sent' || i.status === 'draft';
      if (filter === 'overdue') return st === 'overdue';
      if (filter === 'paid') return i.status === 'paid';
      return true;
    })
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));

  return (
    <AdminPage onRefresh={() => invoices.refetch()} refreshing={invoices.isRefetching}>
      <PageTitle kicker={`Billing · ${month}`} title="Ledger" />

      <View style={{ flexDirection: wide ? 'row' : 'column', flexWrap: 'wrap', gap: wide ? 40 : 28 }}>
        <View style={[{ gap: 16, minWidth: 0 }, wide && { flexGrow: 1, flexShrink: 1, flexBasis: 380 }]}>
          <Text style={[font('sans', 'bold'), l.label, { color: theme.textMuted }]}>Owed to Elite Education</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }} accessibilityLabel={`Owed: ${formatAED(owed)}`}>
            <Text style={[font('serif'), { fontSize: 20, color: theme.textMuted }]}>AED</Text>
            <Text style={[font('serif'), tabular, { fontSize: wide ? 64 : 52, lineHeight: wide ? 68 : 56, letterSpacing: -1, color: theme.text }]} adjustsFontSizeToFit numberOfLines={1}>
              {Math.round(owed).toLocaleString('en-US')}
            </Text>
          </View>
          <View style={l.bar} role="img" accessibilityLabel={`${formatAED(current)} not yet due, ${formatAED(late)} overdue`}>
            {owed > 0 ? (
              <>
                {current > 0 ? <View style={{ flexGrow: current, backgroundColor: theme.text }} /> : null}
                {late > 0 ? <View style={{ flexGrow: late, backgroundColor: theme.danger }} /> : null}
              </>
            ) : (
              <View style={{ flexGrow: 1, backgroundColor: theme.border }} />
            )}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>
            <Legend color={theme.text} label={`Not yet due · ${formatAED(current)}`} />
            <Legend color={theme.danger} label={`Overdue · ${formatAED(late)}`} />
          </View>
        </View>
        <View style={[{ minWidth: 0 }, wide && { flexGrow: 1, flexShrink: 1, flexBasis: 300, alignSelf: 'flex-start' }]}>
          <RuledFigures
            items={[
              { label: 'Collected', value: formatAED(Math.round(collected)), hint: 'this month' },
              { label: 'Earned', value: formatAED(Math.round(earned)), hint: `${formatAED(Math.round(lastEarned))} in ${monthName(lastMonthStart)}`, onPress: () => router.push('/manage/money') },
            ]}
          />
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -8 }}>
        <LinkPill icon="account_balance" label="Money" onPress={() => router.push('/manage/money')} />
        <LinkPill icon="receipt_long" label="VAT returns" onPress={() => router.push('/manage/vat')} />
        <LinkPill icon="trending_up" label="Insights" onPress={() => router.push('/manage/insights')} />
        {!viewing ? <LinkPill icon="sell" label="Sell a package" onPress={() => router.push('/manage/package-new')} /> : null}
      </View>

      <View style={[l.readyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={l.readyHead}>
          <View style={{ gap: 4, flexShrink: 1 }}>
            <Text accessibilityRole="header" style={[font('serif'), { fontSize: 22, lineHeight: 28, color: theme.text }]}>
              Ready to invoice
            </Text>
            <Text style={[font('sans'), { fontSize: 14, lineHeight: 20, color: theme.textMuted }]}>
              {ready.length ? 'Completed lessons not yet billed. Review, then issue in one step.' : 'Nothing is waiting. Completed lessons appear here until they are invoiced.'}
            </Text>
          </View>
          {ready.length > 1 && !viewing ? (
            <InlineLink label={picked.length === ready.length ? 'Clear selection' : 'Select all'} onPress={() => setUnticked(picked.length === ready.length ? new Set(ready.map((r) => r.familyId)) : new Set())} />
          ) : null}
        </View>
        {charges.isLoading ? <Loading /> : null}
        {ready.length ? (
          <View style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
            {ready.map((r) => {
              const on = !unticked.has(r.familyId);
              const family = lookup.family(r.familyId)?.name ?? 'Family';
              const names = joinNames([...r.students].map((id) => lookup.student(id)?.fullName.split(' ')[0] ?? '').filter(Boolean));
              const detail = `${plural(r.count, 'item')}${names ? ` for ${names}` : ''}`;
              const body = (
                <>
                  {!viewing ? <CheckSquare on={on} /> : null}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[font('sans', 'bold'), { fontSize: 15.5, color: theme.text }]}>{family} family</Text>
                    <Text style={[font('sans'), { fontSize: 13.5, color: theme.textMuted }]}>{detail}</Text>
                  </View>
                  <Text style={[font('serif'), tabular, { fontSize: 17, color: theme.text }]}>{formatAED(r.total)}</Text>
                </>
              );
              return viewing ? (
                <View key={r.familyId} style={[l.readyRow, { borderBottomColor: theme.rowDivider }]}>
                  {body}
                </View>
              ) : (
                <Pressable
                  key={r.familyId}
                  onPress={() => toggle(r.familyId)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  aria-checked={on}
                  accessibilityLabel={`${family} family, ${detail}, ${formatAED(r.total)}`}
                  style={[l.readyRow, { borderBottomColor: theme.rowDivider }, webStyle({ cursor: 'pointer' })]}>
                  {body}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <ErrorNote error={invoice.error} />
        {ready.length && !viewing ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <PillButton
              label={picked.length ? `Issue ${plural(picked.length, 'invoice')} · ${formatAED(pickedTotal)}` : 'Select families to invoice'}
              disabled={!picked.length}
              busy={issuing}
              onPress={() =>
                confirm(
                  picked.length === 1 ? 'Issue this invoice?' : `Issue ${picked.length} invoices?`,
                  `Each family is sent a numbered tax invoice for its completed lessons.\n\n${picked.map((r) => `${lookup.family(r.familyId)?.name ?? 'Family'} · ${formatAED(r.total)}`).join('\n')}`,
                  () => void issue(),
                  'Issue',
                )
              }
            />
          </View>
        ) : null}
      </View>

      <View style={{ gap: 14 }}>
        <View style={l.invHead}>
          <Text accessibilityRole="header" style={[font('serif'), { fontSize: 22, color: theme.text }]}>
            Invoices
          </Text>
          <TextFilters
            label="Show invoices"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'overdue', label: 'Overdue' },
              { value: 'paid', label: 'Paid' },
              { value: 'all', label: 'All' },
            ]}
          />
        </View>
        {invoices.isLoading ? (
          <Loading />
        ) : (
          <RuledList>
            {shown.map((i) => (
              <InvoiceLine key={i.id} invoice={i} family={lookup.family(i.familyId)?.name ?? 'Family'} now={now} />
            ))}
            {shown.length === 0 ? (
              <Text style={[font('sans'), { fontSize: 14.5, color: theme.textMuted, paddingVertical: 20 }]}>
                {filter === 'overdue' ? 'Nothing is overdue.' : filter === 'paid' ? 'No paid invoices yet.' : 'No invoices here.'}
              </Text>
            ) : null}
          </RuledList>
        )}
      </View>

      {creditNotes.data?.length ? (
        <View style={{ gap: 14 }}>
          <SectionHead title="Recent credit notes" size={22} />
          <RuledList>
            {[...creditNotes.data]
              .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))
              .slice(0, 5)
              .map((n) => (
                <RowLink
                  key={n.id}
                  title={lookup.family(n.familyId)?.name ?? 'Family'}
                  number={n.number}
                  sub={`Issued ${short(n.issueDate)}${n.invoiceNumber ? ` · against ${n.invoiceNumber}` : ''}`}
                  amount={formatAED(n.total)}
                  status="Credit note"
                  statusColor={theme.textMuted}
                  onPress={() => router.push({ pathname: '/credit-note/[id]', params: { id: n.id } })}
                />
              ))}
          </RuledList>
        </View>
      ) : null}
    </AdminPage>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={[font('sans'), { fontSize: 13.5, color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

function InvoiceLine({ invoice, family, now }: { invoice: Invoice; family: string; now: Date }) {
  const theme = useTheme();
  const st = displayStatus(invoice, now);
  const { total, balance } = invoiceTotals(invoice);
  const s = STATUS[st];
  const sub =
    st === 'paid'
      ? `Paid · issued ${short(invoice.issueDate)}`
      : st === 'credited'
        ? `Credited · issued ${short(invoice.issueDate)}`
        : st === 'part-paid'
          ? `${formatAED(balance)} outstanding · due ${short(invoice.dueDate)}`
          : `Issued ${short(invoice.issueDate)} · due ${short(invoice.dueDate)}`;
  return (
    <RowLink
      title={family}
      number={invoice.number}
      sub={sub}
      amount={formatAED(total)}
      status={s.label}
      statusColor={theme[s.color]}
      onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: invoice.id } })}
    />
  );
}

function RowLink({
  title,
  number,
  sub,
  amount,
  status,
  statusColor,
  onPress,
}: {
  title: string;
  number: string;
  sub: string;
  amount: string;
  status: string;
  statusColor: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${number}, ${amount}, ${status}. ${sub}`}
      style={[l.invRow, { borderBottomColor: theme.border }, hover && { backgroundColor: theme.rowHover }, webStyle({ cursor: 'pointer' })]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <Text style={[font('sans', 'bold'), { fontSize: 15.5, color: theme.text }]}>{title}</Text>
          <Text style={[font('sans'), { fontSize: 12.5, letterSpacing: 0.4, color: theme.textMuted }]}>{number}</Text>
        </View>
        <Text style={[font('sans'), { fontSize: 13.5, color: theme.textMuted }]}>{sub}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[font('serif'), tabular, { fontSize: 17, color: theme.text }]}>{amount}</Text>
        <StatusText label={status} color={statusColor} dot style={{ fontSize: 10.5, letterSpacing: 1.3 }} />
      </View>
    </Pressable>
  );
}

const l = StyleSheet.create({
  label: { fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase' },
  bar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2 },
  readyCard: { borderWidth: 1, borderRadius: 20, padding: 24, gap: 16 },
  readyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  readyRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 2, borderBottomWidth: 1, minHeight: 44 },
  invHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  invRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16, paddingHorizontal: 4, borderBottomWidth: 1 },
});
