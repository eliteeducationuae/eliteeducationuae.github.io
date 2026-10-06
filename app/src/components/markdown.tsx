import { useMemo } from 'react';
import { View } from 'react-native';

import { font, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { parseMarkdown, type Segment } from '@/lib/markdown';

import { Txt } from './ui';

function Inline({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.bold ? (
          <Txt key={i} style={font('sans', 'bold')}>
            {s.text}
          </Txt>
        ) : (
          s.text
        ),
      )}
    </>
  );
}

const HEADING_VARIANT = { 1: 'title', 2: 'h2', 3: 'h3' } as const;

/** Renders the handbook's small Markdown subset with the brand type scale. */
export function Markdown({ text }: { text: string }) {
  const theme = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={{ gap: Spacing.three }}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return (
              <View key={i} style={{ gap: 6, marginTop: i === 0 ? 0 : Spacing.two }}>
                <Txt variant={HEADING_VARIANT[b.level]} accessibilityRole="header">
                  <Inline segments={b.segments} />
                </Txt>
                {b.level < 3 ? <View style={{ width: 28, height: 2, backgroundColor: theme.gold }} /> : null}
              </View>
            );
          case 'paragraph':
            return (
              <Txt key={i}>
                <Inline segments={b.segments} />
              </Txt>
            );
          case 'bullets':
          case 'numbered':
            return (
              <View key={i} style={{ gap: Spacing.two }}>
                {b.items.map((item, j) => (
                  <View key={j} style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' }}>
                    {b.kind === 'bullets' ? (
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.gold, marginTop: 9, marginLeft: 2 }} />
                    ) : (
                      <Txt style={[font('sans', 'bold'), { minWidth: 20, color: theme.accent }]}>{`${b.start + j}.`}</Txt>
                    )}
                    <Txt style={{ flex: 1 }}>
                      <Inline segments={item} />
                    </Txt>
                  </View>
                ))}
              </View>
            );
        }
        return null;
      })}
    </View>
  );
}
