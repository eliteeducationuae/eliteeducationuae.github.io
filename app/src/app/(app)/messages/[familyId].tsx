import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NoHeader } from '@/components/admin-people/kit';
import { Conversation } from '@/components/messages';
import { PageHeader, TextLink, useWide } from '@/components/ui';
import { Layout } from '@/constants/theme';
import { useLookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import { useTheme } from '@/hooks/use-theme';

/** One family conversation (office and tutors): a compact page header above the thread and its composer. */
export default function ConversationScreen() {
  const { familyId } = useLocalSearchParams<{ familyId: string }>();
  const me = useMe();
  const theme = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const lookup = useLookup();
  const family = lookup.family(familyId);
  const title = family ? `${family.name} family` : 'Messages';
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <NoHeader title={title} />
      <View
        style={{
          paddingHorizontal: wide ? Layout.desktopPadX : Layout.phonePadX,
          paddingTop: (wide ? Layout.desktopPadTop : Layout.phonePadTop) + insets.top,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: theme.hairline,
          maxWidth: Layout.maxWidth,
          width: '100%',
        }}>
        <PageHeader
          back={{ fallback: '/messages' }}
          kicker="Messages"
          title={title}
          sub={family ? `${family.parentName} and the family’s other contacts` : undefined}
          right={me.role === 'admin' && family ? <TextLink label="Open the family" onPress={() => router.push({ pathname: '/manage/family/[id]', params: { id: family.id } })} /> : undefined}
        />
      </View>
      <Conversation familyId={familyId} />
    </View>
  );
}
