import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ConciergePanel, goFromConcierge } from '@/components/admin/concierge';
import { PEOPLE_GROUPS, useRecordSearch, type HitGroup } from '@/components/admin/record-search';
import { Icon } from '@/components/icon';
import { EmptyState, ErrorNote, Field, ListItem, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useMe } from '@/data/session';
import { useTheme } from '@/hooks/use-theme';

/**
 * Find anyone or anything. Admins get the concierge here too (commands, records and View as); the concierge
 * normally opens as a sheet over the current tab, and this page is its full-screen form (for links to /search).
 */
export default function Search() {
  const me = useMe();
  const { q } = useLocalSearchParams<{ q?: string }>();
  if (me.role === 'admin') {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Elite concierge' }} />
        <ConciergePanel
          initialQuery={typeof q === 'string' ? q : ''}
          onGo={(href) => {
            // Leave this page first, so Back from the destination returns to where the admin was.
            if (router.canGoBack()) router.back();
            goFromConcierge(href);
          }}
        />
      </Screen>
    );
  }
  return <RecordSearch />;
}

/** Tutors and families find students (the data source already limits what they may see). */
function RecordSearch() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const { groups, viewRows, viewAs } = useRecordSearch(query, false);

  const renderGroup = (g: HitGroup) => (
    <Section key={g.title} title={g.title}>
      <View style={{ gap: Spacing.two }}>
        {g.hits.map((h) => (
          <ListItem key={h.key} title={h.title} subtitle={h.subtitle} left={<Icon name={g.icon} size={20} color={theme.accent} />} onPress={() => router.replace(h.href)} />
        ))}
      </View>
    </Section>
  );

  return (
    <Screen>
      <Field
        label="Search"
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Student name, subject or school"
        returnKeyType="search"
        onSubmitEditing={() => {
          const first = groups[0]?.hits[0];
          if (first) router.replace(first.href);
        }}
      />
      {query.trim().length < 2 ? (
        <Txt variant="muted">Type at least two letters.</Txt>
      ) : groups.length === 0 ? (
        <EmptyState icon="search" title="No matches" message={`We could not find anything for “${query.trim()}”.`} />
      ) : (
        <>
          {groups.filter((g) => PEOPLE_GROUPS.includes(g.title)).map(renderGroup)}
          {viewRows.length ? (
            <Section title="View as">
              <View style={{ gap: Spacing.two }}>
                {viewRows.map(({ key, title, subtitle, target }) => (
                  <ListItem
                    key={key}
                    title={title}
                    subtitle={subtitle}
                    left={<Icon name="eye" size={20} color={target ? theme.accent : theme.textMuted} />}
                    onPress={target && !viewAs.busyId ? () => void viewAs.start(target) : undefined}
                  />
                ))}
                <ErrorNote error={viewAs.error} />
              </View>
            </Section>
          ) : null}
          {groups.filter((g) => !PEOPLE_GROUPS.includes(g.title)).map(renderGroup)}
        </>
      )}
    </Screen>
  );
}
