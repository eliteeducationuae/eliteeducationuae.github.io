import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountScreen } from '@/components/account';
import { noOutline } from '@/components/admin/concierge';
import { useConcierge } from '@/components/admin/concierge-store';
import { filterDirectory, useDirectory } from '@/components/admin/directory';
import { AdminPage, PageTitle, RuledHeading, RuledRow, SectionHead } from '@/components/admin/kit';
import { Icon } from '@/components/icon';
import { useWide } from '@/components/ui';
import { font } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';


/**
 * Directory: everything else, in four groups (People, Growth, Team, Business) with live counts and a filter, then
 * the admin's own account (calendar sync, WhatsApp, data and privacy, sign out).
 */
export default function AdminDirectory() {
  const theme = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const showConcierge = useConcierge((s) => s.show);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const groups = filterDirectory(useDirectory(), query);
  const q = query.trim();

  return (
    <AdminPage bare>
      <AccountScreen>
        {/* The native header is hidden: leave room for the status bar on phones. */}
        {insets.top && !wide ? <View style={{ height: insets.top }} /> : null}
        <PageTitle kicker="Everything else" title="Directory" />
        <View style={[styles.search, { borderColor: focused ? theme.gold : theme.border, borderWidth: focused ? 2 : 1, paddingHorizontal: focused ? 15 : 16, backgroundColor: theme.surface }]}>
          <Icon name="search" size={20} color={theme.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find a family, tutor or setting"
            placeholderTextColor={theme.textMuted}
            accessibilityLabel="Find a family, tutor or setting"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => {
              const first = groups[0]?.items[0];
              if (first) router.push(first.href);
              else if (q.length >= 2) showConcierge(q);
            }}
            style={[font('sans'), styles.input, { color: theme.text }, noOutline]}
          />
        </View>
        <View style={[styles.grid, { gap: wide ? 36 : 28 }]}>
          {groups.map((g) => (
            <View key={g.title} style={[{ minWidth: 0 }, wide ? { flexGrow: 1, flexShrink: 1, flexBasis: 300, marginRight: 12 } : { width: '100%' }]}>
              <RuledHeading title={g.title} />
              {g.items.map((it) => (
                <RuledRow
                  key={it.title}
                  icon={it.icon}
                  title={it.title}
                  note={it.note}
                  count={it.count || undefined}
                  onPress={() => router.push(it.href)}
                  accessibilityLabel={`${it.title}, ${it.note}${it.count ? `, ${it.count} waiting` : ''}`}
                />
              ))}
            </View>
          ))}
        </View>
        {q.length >= 2 ? (
          <View>
            <RuledHeading title="Records" />
            <RuledRow icon="search" title={`Search families, students and invoices for “${q}”`} onPress={() => showConcierge(q)} trail="arrow" />
          </View>
        ) : null}
        <View style={{ marginTop: 12 }}>
          <SectionHead title="Your account" size={22} />
        </View>
      </AccountScreen>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  search: { height: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderWidth: 1, borderRadius: 12 },
  input: { flex: 1, fontSize: 16, height: 44 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
