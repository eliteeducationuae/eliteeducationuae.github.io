import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Conversation } from '@/components/messages';
import { firstName } from '@/components/parent/format';
import { Avatar, EmptyState, PageHeader, Screen, Txt, useWide } from '@/components/ui';
import { avatarColor, font } from '@/constants/theme';
import { useEnrolments, useLookup, useStudents } from '@/data/hooks';
import { useMe } from '@/data/session';
import { withoutClosed } from '@/domain/closed-accounts';
import { joinNames } from '@/domain/greeting';
import { useTheme } from '@/hooks/use-theme';

/** Parents have a single conversation with Elite Education and their children's tutors. */
export default function ParentMessages() {
  const me = useMe();
  // "Ask about this invoice" and similar buttons leave a one-shot draft for the composer (lib/pending-draft), never in the URL.
  if (!me.familyId) {
    return (
      <Screen topInset>
        <PageHeader kicker="Messages" title="Elite Education" />
        <EmptyState title="Messages are not yet available for this account" message="Please contact Elite Education and we will set this up for you." />
      </Screen>
    );
  }
  return <Conversation familyId={me.familyId} header={<MessagesHeader />} />;
}

/** "Messages · Elite Education", with who is in the conversation: the office and the children's tutors. */
function MessagesHeader() {
  const theme = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const lookup = useLookup();
  const students = useStudents();
  const enrolments = useEnrolments();
  const kids = withoutClosed(students.data);
  const tutors = new Map<string, string[]>();
  for (const e of enrolments.data ?? []) {
    if (!e.active || !e.tutorId || !kids.some((k) => k.id === e.studentId)) continue;
    const child = firstName(kids.find((k) => k.id === e.studentId)?.fullName);
    tutors.set(e.tutorId, [...new Set([...(tutors.get(e.tutorId) ?? []), child])]);
  }
  const people = [...tutors.entries()].map(([id, children]) => ({ name: lookup.tutor(id)?.fullName ?? 'Tutor', children }));
  const line = people.length
    ? `The Elite Education office and ${joinNames(people.map((p) => `${firstName(p.name)}, ${joinNames(p.children)}’s tutor`))}.`
    : 'The Elite Education office. Everyone in this conversation is notified when you write.';
  return (
    <View style={{ paddingTop: wide ? 22 : insets.top + 8, paddingBottom: 6, gap: 6 }}>
      <Txt variant="kicker">Messages</Txt>
      <Txt variant="title" accessibilityRole="header">
        Elite Education
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <View style={{ flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.primary, borderWidth: 2, borderColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[font('sans', 'bold'), { fontSize: 11, color: theme.onPrimary }]}>EE</Text>
          </View>
          {people.slice(0, 3).map((p) => (
            <View key={p.name} style={{ marginLeft: -8, borderWidth: 2, borderColor: theme.background, borderRadius: 17 }}>
              <Avatar name={p.name} color={avatarColor(p.name)} size={30} />
            </View>
          ))}
        </View>
        <Txt variant="note" style={{ flex: 1, fontSize: 14 }}>
          {line}
        </Txt>
      </View>
    </View>
  );
}
