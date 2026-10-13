/**
 * The admin concierge: "What would you like to do?" A command list with live counts, merged with the record search
 * (students, families and their contacts, tutors, invoices, enquiries, roles, applications) and the "View as" rows.
 * It only navigates (or opens a form ready to fill in); it never changes anything itself.
 * Opened from the gold "+" on phones (a bottom sheet) and Ctrl/Cmd-K or the top bar on desktop (a right drawer).
 */
import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font } from '@/constants/theme';
import { useCharges, useEnquiries, useFamilies, useRequests, useStudents, useTutorInvoices, useUnreadCount } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { withoutClosed } from '@/domain/closed-accounts';
import { withoutSpam } from '@/domain/spam';
import { tutorInvoiceTotal } from '@/domain/tutor-pay';
import { useTheme } from '@/hooks/use-theme';
import { plural } from '@/lib/id';

import { Icon, type IconName } from '../icon';
import { ErrorNote, useWide } from '../ui';
import { takeConciergeOpener, useConcierge } from './concierge-store';
import { RuledHeading, RuledRow } from './kit';
import { PEOPLE_GROUPS, useRecordSearch, type HitGroup } from './record-search';

const web = Platform.OS === 'web';
const webStyle = (s: Record<string, unknown>): ViewStyle => (web ? (s as ViewStyle) : {});
/** The field's own border shows focus (2px gold), so the browser outline is not doubled up. */
export const noOutline = (web ? { outlineWidth: 0 } : {}) as TextStyle;

interface Command {
  icon: IconName;
  label: string;
  note: string;
  href: Href;
  /** Extra words people might type for it. */
  keywords?: string;
}

/** The prototype's command list, with counts from the existing hooks. Every command opens a page; none writes. */
function useCommands(): Command[] {
  const charges = useCharges();
  const enquiries = useEnquiries();
  const tutorInvoices = useTutorInvoices();
  const unread = useUnreadCount();
  const families = useFamilies();
  const students = useStudents();
  const requests = useRequests();
  const unbilled = (charges.data ?? []).filter((c) => c.status === 'unbilled');
  const unbilledTotal = unbilled.reduce((s, c) => s + c.amount, 0);
  const newEnquiries = withoutSpam(enquiries.data ?? []).filter((e) => e.status === 'new').length;
  const submitted = (tutorInvoices.data ?? []).filter((i) => i.status === 'submitted');
  const submittedTotal = submitted.reduce((s, i) => s + tutorInvoiceTotal(i.items), 0);
  const pending = (requests.data ?? []).filter((r) => r.status === 'pending').length;
  const familyCount = withoutClosed(families.data ?? []).length;
  const studentCount = withoutClosed(students.data ?? []).length;
  return [
    { icon: 'calendar_month', label: 'Schedule lessons', note: 'One-off or weekly, with clash checks', href: '/lesson/new', keywords: 'book lesson diary' },
    { icon: 'account_balance', label: 'Money', note: 'Profit, pay run and exports', href: '/manage/money', keywords: 'profit expenses export' },
    { icon: 'inbox', label: 'Enquiries', note: newEnquiries ? `${newEnquiries} new` : 'New leads through to enrolment', href: '/manage/enquiries', keywords: 'leads' },
    {
      icon: 'receipt_long',
      label: 'Issue invoices',
      note: unbilledTotal ? `${formatAED(unbilledTotal)} is ready to invoice` : 'Nothing is waiting to be invoiced',
      href: '/admin/billing',
      keywords: 'invoice billing ledger',
    },
    { icon: 'payments', label: 'Record a payment', note: 'Open the invoice, then enter the amount and method', href: { pathname: '/admin/billing', params: { filter: 'open' } }, keywords: 'paid bank transfer card cash' },
    { icon: 'person_add', label: 'Add a student', note: 'Family, subjects and goals', href: '/students/edit', keywords: 'new student child' },
    { icon: 'sell', label: 'Sell a package', note: 'Prepaid lessons at a set rate', href: '/manage/package-new', keywords: 'top-up credit' },
    {
      icon: 'description',
      label: 'Approve tutor invoices',
      note: submitted.length ? `${submitted.length} waiting · ${formatAED(submittedTotal)}` : 'None waiting',
      href: '/manage/tutor-invoices',
      keywords: 'tutor pay',
    },
    { icon: 'event_repeat', label: 'Lesson requests', note: pending ? `${pending} waiting for a decision` : 'Extra lessons and changes from families', href: '/manage/requests', keywords: 'move reschedule' },
    { icon: 'group_add', label: 'Add a family', note: 'Main contact and billing', href: '/manage/family-edit', keywords: 'new family parent' },
    { icon: 'forum', label: 'Message a family', note: unread ? `${plural(unread, 'unread conversation')}` : 'Conversations with families', href: '/messages', keywords: 'chat whatsapp' },
    { icon: 'campaign', label: 'Send an announcement', note: 'To families, tutors or both', href: '/announcements', keywords: 'news' },
    { icon: 'inbox', label: 'Log an enquiry', note: 'Call, WhatsApp or walk-in', href: '/enquire', keywords: 'new lead' },
    { icon: 'receipt', label: 'Add an expense', note: 'Receipt and reclaimable VAT', href: '/manage/expense-edit', keywords: 'cost receipt' },
    { icon: 'travel_explore', label: 'Open an admissions case', note: 'Schools or universities', href: '/admissions/edit', keywords: 'admissions school university' },
    { icon: 'group', label: 'Find a family', note: families.data ? `Search ${plural(familyCount, 'family', 'families')}` : 'Parents, contacts and children', href: '/manage/families', keywords: 'parent' },
    { icon: 'school', label: 'Find a student', note: students.data ? `Search ${plural(studentCount, 'student')}` : 'Profiles, subjects and progress', href: '/admin/students', keywords: 'pupil' },
  ];
}

const matchesCommand = (c: Command, q: string) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${c.label} ${c.note} ${c.keywords ?? ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
};

/**
 * The concierge's content: title, search field, commands and records. `onGo` opens a destination (the sheet closes
 * itself first); `inSheet` trims the outer padding the sheet already provides.
 */
export function ConciergePanel({ initialQuery = '', onGo, autoFocus = true }: { initialQuery?: string; onGo: (href: Href) => void; autoFocus?: boolean }) {
  const theme = useTheme();
  const [query, setQuery] = useState(initialQuery);
  const [focused, setFocused] = useState(false);
  const commands = useCommands();
  const { groups, viewRows, viewAs } = useRecordSearch(query, true);
  const q = query.trim();
  const shown = useMemo(() => (q ? commands.filter((c) => matchesCommand(c, q)) : commands), [commands, q]);
  const people = groups.filter((g) => PEOPLE_GROUPS.includes(g.title));
  const others = groups.filter((g) => !PEOPLE_GROUPS.includes(g.title));
  const nothing = q.length >= 2 ? !shown.length && !groups.length : !shown.length;

  const first = (): Href | undefined => groups[0]?.hits[0]?.href ?? shown[0]?.href;
  const renderGroup = (g: HitGroup) => (
    <View key={g.title} style={{ gap: 0 }}>
      <RuledHeading title={g.title} />
      {g.hits.map((h) => (
        <RuledRow key={h.key} icon={g.icon} title={h.title} note={h.subtitle} onPress={() => onGo(h.href)} />
      ))}
    </View>
  );

  return (
    <View style={{ gap: 20 }}>
      <Text accessibilityRole="header" style={[font('serif'), { fontSize: 26, lineHeight: 32, color: theme.text }]}>
        What would you like to do?
      </Text>
      <View style={[cs.search, { borderColor: theme.gold, borderWidth: focused ? 2 : 1, paddingHorizontal: focused ? 15 : 16, backgroundColor: theme.surface }]}>
        <Icon name="search" size={20} color={theme.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search"
          aria-label="Search"
          placeholder="Schedule, invoice, find a family…"
          placeholderTextColor={theme.textMuted}
          returnKeyType="search"
          onSubmitEditing={() => {
            const href = first();
            if (href) onGo(href);
          }}
          style={[font('sans'), cs.input, { color: theme.text }, noOutline]}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear the search" hitSlop={10}>
            <Icon name="close" size={18} color={theme.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {q.length >= 2 ? people.map(renderGroup) : null}
      {q.length >= 2 && viewRows.length ? (
        <View>
          <RuledHeading title="View as" />
          {viewRows.map(({ key, title, subtitle, target }) => (
            <RuledRow
              key={key}
              icon="visibility"
              title={title}
              note={subtitle}
              onPress={target && !viewAs.busyId ? () => void viewAs.start(target) : undefined}
            />
          ))}
          <ErrorNote error={viewAs.error} />
        </View>
      ) : null}

      {shown.length ? (
        <View>
          {q.length >= 2 ? <RuledHeading title="Actions" /> : <View style={{ height: 1, backgroundColor: theme.text }} />}
          {shown.map((c) => (
            <RuledRow key={c.label} icon={c.icon} title={c.label} note={c.note} trail="arrow" padV={14} onPress={() => onGo(c.href)} />
          ))}
        </View>
      ) : null}

      {q.length >= 2 ? others.map(renderGroup) : null}

      {nothing ? (
        <Text style={[font('sans'), { fontSize: 14.5, color: theme.textMuted, paddingVertical: 8 }]}>
          Nothing matches “{q}”. Try “invoice” or a family name.
        </Text>
      ) : q.length === 1 ? (
        <Text style={[font('sans'), { fontSize: 13.5, color: theme.textMuted }]}>Type another letter to search families, students and invoices too.</Text>
      ) : null}
    </View>
  );
}

/** Open a destination from the concierge: tab pages switch tabs; everything else opens on top. */
export function goFromConcierge(href: Href) {
  const path = typeof href === 'string' ? href : href.pathname;
  if (typeof path === 'string' && path.startsWith('/admin')) router.navigate(href);
  else router.push(href);
}

/** The sheet (phone) or right-hand drawer (desktop) holding the concierge. Mounted once in the admin layout. */
export function ConciergeSheet() {
  const theme = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const { open, query, hide } = useConcierge();
  // A fresh panel (and search) each time it opens.
  const [openCount, setOpenCount] = useState(0);
  const wasOpen = useRef(false);
  // On the web, focus goes back to whatever opened the concierge (the "+" or the search button) when it closes.
  useEffect(() => {
    if (open && !wasOpen.current) setOpenCount((n) => n + 1);
    if (!open && wasOpen.current) {
      const el = takeConciergeOpener();
      // Once the closing animation is over and the modal has released its focus trap.
      if (el) setTimeout(() => el.isConnected && el.focus(), 450);
    }
    wasOpen.current = open;
  }, [open]);

  const go = (href: Href) => {
    hide();
    goFromConcierge(href);
  };

  return (
    <Modal visible={open} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={hide} statusBarTranslucent>
      <View style={[StyleSheet.absoluteFill, { flexDirection: wide ? 'row' : 'column', justifyContent: wide ? 'flex-end' : 'flex-end' }]}>
        {/* The scrim closes on tap but is not a second close button for keyboards and screen readers. */}
        <Pressable
          onPress={hide}
          accessible={false}
          importantForAccessibility="no"
          aria-hidden
          tabIndex={-1}
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.42)' }]}
        />
        {/* The Modal is already the dialog on the web; this panel only keeps VoiceOver inside it on iOS. */}
        <View
          accessibilityViewIsModal
          style={[
            { backgroundColor: theme.background, overflow: 'hidden' },
            wide
              ? { width: 440, height: '100%', borderLeftWidth: 1, borderLeftColor: theme.hairline }
              : { width: '100%', maxHeight: '86%', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
            webStyle({ boxShadow: '0 -10px 40px rgba(10,10,10,.2)' }),
          ]}>
          {!wide ? (
            <View style={{ alignItems: 'center', paddingTop: 10 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.sendDisabled }} />
            </View>
          ) : null}
          <View style={[cs.head, { paddingTop: wide ? insets.top + 20 : 16 }]}>
            <Text style={[font('sans', 'bold'), cs.kicker, { color: theme.textMuted }]}>Elite concierge</Text>
            <Pressable onPress={hide} accessibilityRole="button" accessibilityLabel="Close the concierge" hitSlop={5} style={[cs.close, { borderColor: theme.border }, webStyle({ cursor: 'pointer' })]}>
              <Icon name="close" size={18} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 32 + (wide ? 0 : insets.bottom) }}>
            {open ? <ConciergePanel key={openCount} initialQuery={query} onGo={go} /> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const cs = StyleSheet.create({
  search: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderWidth: 1, borderRadius: 12 },
  input: { flex: 1, fontSize: 16, height: 46 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  kicker: { fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase' },
  close: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
