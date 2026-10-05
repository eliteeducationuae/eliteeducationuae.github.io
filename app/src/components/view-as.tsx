/**
 * Admin "View as": the slim banner shown while an admin sees the app as someone else (read-only), and the
 * controls that start a view from a family, tutor or student page.
 */
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand, font, Spacing } from '@/constants/theme';
import { useViewTargets } from '@/data/hooks';
import { useSession, useViewing } from '@/data/session';
import { minutesLeft, useViewNotice, VIEW_ONLY_MESSAGE, viewTargetsFor, type ViewTarget } from '@/data/view-as';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';
import { Button, ErrorNote, Section, Txt } from './ui';

/** Which family, student or tutor to offer "View as" for. */
export type ViewAsRef = { familyId?: string; studentId?: string; tutorId?: string };

/** How long the calm "view only" note stays under the banner. */
export const VIEW_ONLY_NOTE_MS = 4000;
/** How long the "back in your own account" note stays after a view ends. */
export const VIEW_RETURNED_NOTE_MS = 6000;
/** Shown once the admin is back in their own account after a view ended. */
export const VIEW_RETURNED_MESSAGE = 'Your view has ended. You are back in your own account.';
/** How often the remaining-time hint refreshes. */
const TICK_MS = 30_000;

const ROLE_LABEL: Record<ViewTarget['role'], string> = { parent: 'Parent', student: 'Student', tutor: 'Tutor' };

/** "Parent", "Student" or "Tutor". */
export const viewRoleLabel = (role: ViewTarget['role']) => ROLE_LABEL[role];

/** Where each role lands when a view starts. */
export const viewHomeHref = (role: ViewTarget['role']): Href => `/${role}` as Href;

/** The logins an admin can view as for this family, student or tutor (empty for anyone else). */
export function useViewTargetsFor(ref: ViewAsRef) {
  const targets = useViewTargets();
  return { ...targets, list: targets.data ? viewTargetsFor(targets.data, ref) : [] };
}

/** One row of the "View as" group in search: a login to view as, or a hit nobody can sign in to yet. */
export type ViewAsRow = { key: string; title: string; subtitle: string; target?: ViewTarget };

type HitRef = { id: string; title: string };

/**
 * The "View as" rows for search hits: one per login linked to each family, tutor or student found, and a
 * "No login yet" row for a family or tutor without one. Students without a login are left out, since most
 * children never sign in and their family's row already covers them. Each login appears once.
 */
export function viewAsRows(targets: ViewTarget[], hits: { families?: HitRef[]; tutors?: HitRef[]; students?: HitRef[] }): ViewAsRow[] {
  const rows: ViewAsRow[] = [];
  const seen = new Set<string>();
  const add = (kind: 'family' | 'tutor' | 'student', hit: HitRef, found: ViewTarget[]) => {
    if (!found.length) {
      if (kind === 'student') return;
      rows.push({ key: `none-${kind}-${hit.id}`, title: hit.title, subtitle: 'No login yet' });
      return;
    }
    for (const t of found) {
      if (seen.has(t.profileId)) continue;
      seen.add(t.profileId);
      rows.push({ key: t.profileId, title: `View as ${t.fullName}`, subtitle: `${viewRoleLabel(t.role)} · ${t.email}`, target: t });
    }
  };
  for (const h of hits.families ?? []) add('family', h, viewTargetsFor(targets, { familyId: h.id }));
  for (const h of hits.tutors ?? []) add('tutor', h, viewTargetsFor(targets, { tutorId: h.id }));
  for (const h of hits.students ?? []) add('student', h, viewTargetsFor(targets, { studentId: h.id }));
  return rows;
}

/** True for an admin on their own account (not already viewing as someone). */
export function useCanViewAs() {
  const role = useSession((s) => s.profile?.role);
  const viewing = useViewing();
  return role === 'admin' && !viewing;
}

/** Start a view and open that person's home, with a busy marker and any error. */
export function useStartViewAs() {
  const startViewAs = useSession((s) => s.startViewAs);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const start = useCallback(
    async (target: ViewTarget) => {
      setBusyId(target.profileId);
      setError(null);
      try {
        await startViewAs(target.profileId);
        router.replace(viewHomeHref(target.role));
      } catch (err) {
        setError(err);
      } finally {
        setBusyId(null);
      }
    },
    [startViewAs],
  );
  return { start, busyId, error };
}

/** Leave the view and return to the admin's home, closing any open modal first. */
async function leaveView(reason?: 'ended') {
  await useSession.getState().exitViewAs();
  if (router.canDismiss()) router.dismissAll();
  router.replace('/admin');
  // A calm in-app note rather than a blocking alert.
  if (reason === 'ended') useViewNotice.getState().flag('returned');
}

/**
 * Wraps the signed-in stack: the "View as" banner above every screen (it takes the top inset while viewing) and
 * the calm notice below it. The tree keeps the same shape either way, so the Stack never remounts.
 */
export function ViewAsFrame({ children }: { children: ReactNode }) {
  const palette = useTheme();
  const viewing = useViewing();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ViewAsBanner />
      <View style={{ flex: 1 }}>
        <SafeAreaInsetsContext.Provider value={viewing ? { ...insets, top: 0 } : insets}>{children}</SafeAreaInsetsContext.Provider>
        <ViewAsToast top={viewing ? Spacing.two : insets.top + Spacing.two} />
      </View>
    </View>
  );
}

const isModal = (presentation: unknown) => typeof presentation === 'string' && presentation !== 'card';

/**
 * The Stack's `screenLayout`. On iOS a modal screen is a native sheet over the whole app, hiding the banner, so
 * while viewing each modal carries a compact copy of the banner and the calm notice. Elsewhere modals sit under the
 * banner already, and every other screen is left exactly as it is.
 */
export function viewAsScreenLayout({ options, children }: { options: { presentation?: unknown }; children: ReactElement }): ReactElement {
  if (Platform.OS !== 'ios' || !isModal(options.presentation)) return children;
  return <ViewAsModalFrame>{children}</ViewAsModalFrame>;
}

function ViewAsModalFrame({ children }: { children: ReactElement }) {
  const viewing = useViewing();
  return (
    <View style={{ flex: 1 }}>
      {viewing ? <ViewAsModalStrip name={viewing.profile.fullName} /> : null}
      <View style={{ flex: 1 }}>
        {children}
        {viewing ? <ViewAsToast top={Spacing.two} /> : null}
      </View>
    </View>
  );
}

/** The compact banner inside a modal: who is being viewed and an Exit button. */
function ViewAsModalStrip({ name }: { name: string }) {
  const [exiting, setExiting] = useState(false);
  const exit = async () => {
    setExiting(true);
    try {
      await leaveView();
    } finally {
      setExiting(false);
    }
  };
  return (
    <View accessibilityRole="summary" style={[styles.strip, { paddingTop: Spacing.two }]}>
      <View style={styles.row}>
        <Icon name="eye" size={16} color={Brand.noir} />
        <Text style={[styles.label, { flex: 1 }]} numberOfLines={1}>
          Viewing as {name} · read only
        </Text>
        <ExitButton exiting={exiting} onPress={() => void exit()} />
      </View>
    </View>
  );
}

function ExitButton({ exiting, onPress }: { exiting: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={exiting}
      accessibilityRole="button"
      accessibilityLabel="Exit view"
      accessibilityState={{ disabled: exiting, busy: exiting }}
      hitSlop={8}
      style={({ pressed }) => [styles.exit, (pressed || exiting) && { opacity: 0.7 }]}>
      <Text style={styles.exitText}>Exit</Text>
    </Pressable>
  );
}

/**
 * The calm notice: a small Noir (or ivory, in dark mode) note that floats just below the banner for a few
 * seconds, so the gold strip itself never grows. It never blocks a tap.
 */
function ViewAsToast({ top }: { top: number }) {
  const palette = useTheme();
  const notice = useViewNotice((s) => s.notice);
  const message = notice === 'view-only' ? VIEW_ONLY_MESSAGE : notice === 'returned' ? VIEW_RETURNED_MESSAGE : null;
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.toast, { top, backgroundColor: palette.text, pointerEvents: 'none' }]}>
      <Icon name="info" size={16} color={palette.background} />
      <Text style={[styles.toastText, { color: palette.background }]}>{message}</Text>
    </View>
  );
}

/**
 * A slim champagne-gold strip, shown only while an admin is viewing as someone else: who is being viewed,
 * how long is left and an Exit button. A refused change shows a calm note under it for a few seconds.
 */
export function ViewAsBanner() {
  const viewing = useViewing();
  const insets = useSafeAreaInsets();
  const notice = useViewNotice((s) => s.notice);
  const noticeAt = useViewNotice((s) => s.at);
  const [now, setNow] = useState(() => Date.now());
  const [exiting, setExiting] = useState(false);
  const leaving = useRef(false);
  const expiresAt = viewing?.expiresAt;

  const leave = useCallback(async (reason?: 'ended') => {
    if (leaving.current) return;
    leaving.current = true;
    setExiting(true);
    try {
      await leaveView(reason);
    } finally {
      leaving.current = false;
      setExiting(false);
    }
  }, []);

  // Refresh the clock every 30 seconds, and exactly when the view expires.
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, TICK_MS);
    const untilEnd = Date.parse(expiresAt) - Date.now();
    const atEnd = Number.isFinite(untilEnd) && untilEnd > 0 && untilEnd < 2 ** 31 - 1 ? setTimeout(tick, untilEnd + 50) : undefined;
    return () => {
      clearTimeout(first);
      clearInterval(every);
      if (atEnd) clearTimeout(atEnd);
    };
  }, [expiresAt]);

  const left = expiresAt ? minutesLeft(expiresAt, now) : null;
  const expired = left === 0;

  // The view ran out, or the server says it has ended: return to the admin's own account.
  useEffect(() => {
    if (expiresAt && (expired || notice === 'ended')) void leave('ended');
  }, [expiresAt, expired, notice, leave]);

  // The calm notes fade after a few seconds; a repeat refusal restarts the timer.
  useEffect(() => {
    if (notice !== 'view-only' && notice !== 'returned') return;
    const t = setTimeout(() => useViewNotice.getState().clear(), notice === 'returned' ? VIEW_RETURNED_NOTE_MS : VIEW_ONLY_NOTE_MS);
    return () => clearTimeout(t);
  }, [notice, noticeAt]);

  if (!viewing) return null;

  return (
    <View accessibilityRole="summary" style={[styles.strip, { paddingTop: insets.top + Spacing.two }]}>
      <View style={styles.row}>
        <Icon name="eye" size={18} color={Brand.noir} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.label} numberOfLines={1}>
            Viewing as {viewing.profile.fullName}
          </Text>
          <Text style={styles.hint} numberOfLines={1}>
            {left !== null && left > 0 ? `Read only · ${left} min left` : 'Read only'}
          </Text>
        </View>
        <ExitButton exiting={exiting} onPress={() => void leave()} />
      </View>
    </View>
  );
}

/**
 * "View as" buttons for an admin on a family, student or tutor page: one per linked login, or a disabled
 * button when nobody has signed in yet. Renders nothing for anyone else, or while already viewing.
 */
export function ViewAsActions({ title = 'View the app as', ...ref }: ViewAsRef & { title?: string }) {
  const canView = useCanViewAs();
  const targets = useViewTargetsFor(ref);
  const { start, busyId, error } = useStartViewAs();
  if (!canView) return null;
  return (
    <Section title={title}>
      <View style={{ gap: Spacing.two }}>
        {targets.list.length ? (
          targets.list.map((t) => (
            <Button
              key={t.profileId}
              title={`View as ${t.fullName}`}
              icon="eye"
              variant="secondary"
              loading={busyId === t.profileId}
              disabled={!!busyId && busyId !== t.profileId}
              onPress={() => void start(t)}
            />
          ))
        ) : (
          <>
            <Button title="View as" icon="eye" variant="secondary" disabled loading={targets.isLoading} onPress={() => undefined} />
            {targets.isLoading ? null : <Txt variant="small">No login yet</Txt>}
          </>
        )}
        <Txt variant="small">See the app exactly as they do. Nothing can be changed.</Txt>
        <ErrorNote error={error ?? targets.error} />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  // Gold is only ever a slim strip; text on it is Noir for contrast.
  strip: { backgroundColor: Brand.gold, paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { ...font('sans', 'bold'), color: Brand.noir, fontSize: 12, lineHeight: 16, letterSpacing: 1.2, textTransform: 'uppercase' },
  hint: { ...font('sans'), color: Brand.noir, fontSize: 12.5, lineHeight: 16 },
  exit: {
    borderWidth: 1,
    borderColor: Brand.noir,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    minHeight: 32,
    justifyContent: 'center',
  },
  exitText: { ...font('sans', 'bold'), color: Brand.noir, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  toast: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: Brand.gold,
  },
  toastText: { ...font('sans'), fontSize: 14, lineHeight: 19, flex: 1 },
});
