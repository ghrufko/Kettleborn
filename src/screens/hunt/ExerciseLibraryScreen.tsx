import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { HuntStackParamList } from '../../navigation/types';
import { Header, AppBackground } from '../../components/core';
import { contentEngine } from '../../../engines/content';
import { MovementCategory } from '../../models';
import { colors, fontFamily, fontSize, radii, spacing } from '../../theme';

type Props = NativeStackScreenProps<HuntStackParamList, 'ExerciseLibrary'>;

const CATEGORY_FILTERS: ('All' | MovementCategory)[] = ['All', 'Ballistic', 'Grind', 'Carry', 'Combo'];

export function ExerciseLibraryScreen({ navigation }: Props) {
  const allEntries = contentEngine.getExerciseLibrary();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'All' | MovementCategory>('All');

  const entries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return allEntries
      .filter((entry) => category === 'All' || entry.category === category)
      .filter((entry) => !normalizedQuery || entry.name.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allEntries, query, category]);

  return (
    <AppBackground style={styles.container}>
      <Header title="Exercise Library" onBack={() => navigation.goBack()} />

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.text.muted} style={styles.searchIcon} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search exercises"
          placeholderTextColor={colors.text.muted}
          style={styles.searchInput}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {CATEGORY_FILTERS.map((filter) => {
          const active = filter === category;
          return (
            <Pressable
              key={filter}
              onPress={() => setCategory(filter)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {filter}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {entries.length === 0 ? (
          <Text style={styles.emptyText}>No exercises match your search.</Text>
        ) : (
          entries.map((entry) => (
            <Pressable
              key={entry.id}
              onPress={() => navigation.navigate('ExerciseDetail', { exerciseId: entry.id })}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.rowInfo}>
                <Text style={styles.rowName}>{entry.name}</Text>
                <Text style={styles.rowMuscles}>
                  {entry.category} · {entry.musclesTrained.join(' · ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.steel} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.void.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    paddingHorizontal: spacing.sm,
  },
  searchIcon: {
    marginRight: spacing.xxs,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.primary,
    paddingVertical: spacing.sm,
  },
  // flexGrow/flexShrink: 0 pins this row to its own content height — without
  // it, this ScrollView (a flex sibling of the results list below) could be
  // handed leftover vertical space whenever the filtered list is short (e.g.
  // the Carry category, with only 2 entries), stretching it far past a
  // normal chip row.
  filterScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  filterRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    // A horizontal ScrollView's default cross-axis behavior is
    // align-items: stretch, which — combined with the row above — was
    // letting each chip stretch to fill that leftover height instead of
    // sizing to its own text/padding. Centering keeps every chip a small,
    // consistent pill regardless of how tall the row is handed.
    alignItems: 'center',
    gap: spacing.xs,
  },
  filterChip: {
    backgroundColor: colors.void.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  filterChipActive: {
    backgroundColor: colors.bronze.base,
    borderColor: colors.bronze.base,
  },
  filterChipText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    textTransform: 'uppercase',
  },
  filterChipTextActive: {
    color: colors.void.base,
    fontFamily: fontFamily.monoBold,
  },
  content: {
    padding: spacing.md,
    paddingTop: 0,
  },
  emptyText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.charcoal.base,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.charcoal.raised,
  },
  rowInfo: {
    flex: 1,
  },
  rowName: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    textTransform: 'uppercase',
  },
  rowMuscles: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: 2,
  },
});
