import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { font, Radius, Spacing } from '@/constants/theme';
import { OTHER } from '@/domain/catalogue';
import { useTheme } from '@/hooks/use-theme';

import { addOther, choiceState, freeTextValues, hasMore, includesChoice, toggleMulti, visibleOptions } from './catalogue-choice';
import { Button, Field, Row, Txt } from './ui';

const OTHER_LABEL = 'Other…';
const MORE_LABEL = 'More…';

/** A chip like ui.tsx's Chip, with an explicit accessible name (e.g. 'Remove Chemistry'). */
function PickerChip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  quiet,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  /** A dashed, muted chip for 'More…'. */
  quiet?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? theme.gold : theme.border, backgroundColor: selected ? theme.primary : theme.surface },
        quiet && { borderStyle: 'dashed', backgroundColor: 'transparent' },
        pressed && { borderColor: theme.gold },
      ]}>
      <Text style={[font('sans', 'bold'), styles.chipText, { color: selected ? theme.onPrimary : quiet ? theme.textMuted : theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One choice from a catalogue (subjects, phases, curricula…), or free text through 'Other…'.
 * `collapsed` = N shows the first N options and a 'More…' chip; the current value is always shown.
 */
export function CataloguePicker({
  label,
  options,
  value,
  onChange,
  otherPlaceholder,
  optional,
  collapsed,
}: {
  label: string;
  options: readonly string[];
  value?: string;
  onChange: (value: string | undefined) => void;
  otherPlaceholder?: string;
  optional?: boolean;
  collapsed?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  // 'Other…' is shown as chosen while its field is still empty, before any text is typed.
  const [otherOpen, setOtherOpen] = useState(false);
  const state = choiceState(options, value);
  const otherChosen = state.selected === OTHER || (otherOpen && !state.selected);
  const shown = visibleOptions(options, state.selected === OTHER ? undefined : state.selected, collapsed, expanded);

  function pick(option: string) {
    setOtherOpen(false);
    if (state.selected === option) {
      if (optional) onChange(undefined);
      return;
    }
    onChange(option);
  }

  function pickOther() {
    if (otherChosen) {
      setOtherOpen(false);
      if (optional || !state.otherText.trim()) onChange(undefined);
      return;
    }
    setOtherOpen(true);
    onChange(undefined);
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <Txt variant="label">
        {label}
        {optional ? ' (optional)' : ''}
      </Txt>
      <Row gap={Spacing.one} wrap>
        {shown.map((o) => (
          <PickerChip key={o} label={o} selected={state.selected === o} onPress={() => pick(o)} accessibilityLabel={`${label}: ${o}`} />
        ))}
        {hasMore(options, collapsed, expanded) ? (
          <PickerChip label={MORE_LABEL} quiet onPress={() => setExpanded(true)} accessibilityLabel={`Show more ${label.toLowerCase()} options`} />
        ) : null}
        <PickerChip label={OTHER_LABEL} selected={otherChosen} onPress={pickOther} accessibilityLabel={`${label}: other`} />
      </Row>
      {otherChosen ? (
        <Field
          label={`${label}, please specify`}
          value={state.otherText}
          onChangeText={(t) => {
            setOtherOpen(true);
            onChange(t.length ? t : undefined);
          }}
          placeholder={otherPlaceholder ?? 'Please specify'}
          autoCapitalize="sentences"
        />
      ) : null}
    </View>
  );
}

/** Several choices from a catalogue, with free-text additions through 'Other…'. */
export function CatalogueMultiPicker({
  label,
  options,
  values,
  onChange,
  otherPlaceholder,
  collapsed,
}: {
  label: string;
  options: readonly string[];
  values: string[];
  onChange: (values: string[]) => void;
  otherPlaceholder?: string;
  collapsed?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const shown = visibleOptions(options, values, collapsed, expanded);
  const extras = freeTextValues(options, values);

  function add() {
    const next = addOther(values, draft, options);
    onChange(next);
    setDraft('');
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <Txt variant="label">{label}</Txt>
      <Row gap={Spacing.one} wrap>
        {shown.map((o) => {
          const on = includesChoice(values, o);
          return (
            <PickerChip
              key={o}
              label={o}
              selected={on}
              onPress={() => onChange(toggleMulti(values, o))}
              accessibilityLabel={`${label}: ${o}`}
            />
          );
        })}
        {extras.map((v) => (
          <PickerChip key={`free-${v}`} label={`${v}  ✕`} selected onPress={() => onChange(toggleMulti(values, v))} accessibilityLabel={`Remove ${v}`} />
        ))}
        {hasMore(options, collapsed, expanded) ? (
          <PickerChip label={MORE_LABEL} quiet onPress={() => setExpanded(true)} accessibilityLabel={`Show more ${label.toLowerCase()} options`} />
        ) : null}
        <PickerChip label={OTHER_LABEL} selected={otherOpen} onPress={() => setOtherOpen((o) => !o)} accessibilityLabel={`${label}: add another`} />
      </Row>
      {otherOpen ? (
        <Row gap={Spacing.two} style={{ alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field
              label={`Add to ${label.toLowerCase()}`}
              value={draft}
              onChangeText={setDraft}
              placeholder={otherPlaceholder ?? 'Please specify'}
              onSubmitEditing={add}
              returnKeyType="done"
            />
          </View>
          <Button title="Add" size="sm" variant="secondary" onPress={add} disabled={!draft.trim()} />
        </Row>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1, minHeight: 36, justifyContent: 'center' },
  chipText: { fontSize: 14 },
});
