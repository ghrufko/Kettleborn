import React from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFamily, fontSize, letterSpacing, spacing } from '../../theme';
import { fitHeaderTitleSize, HEADER_SIDE_WIDTH } from '../../utils/headerTitleSize';

interface HeaderProps {
  title: string;
  onBack?: () => void;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightPress?: () => void;
  /** Screen-reader label for the right icon button. Falls back to the icon name only if omitted. */
  rightAccessibilityLabel?: string;
}

export function Header({ title, onBack, rightIcon, onRightPress, rightAccessibilityLabel }: HeaderProps) {
  const { width } = useWindowDimensions();
  const titleSize = fitHeaderTitleSize(title, width);
  const titleStyle =
    titleSize < fontSize.lg ? { fontSize: titleSize, letterSpacing: letterSpacing.normal * 4 } : null;
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.row}>
        <View style={styles.side}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={24} color={colors.bronze.base} />
            </Pressable>
          ) : null}
        </View>

        <Text style={[styles.title, titleStyle]} numberOfLines={1}>
          {title}
        </Text>

        <View style={[styles.side, styles.sideRight]}>
          {rightIcon ? (
            <Pressable
              onPress={onRightPress}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={rightAccessibilityLabel ?? rightIcon}
            >
              <Ionicons name={rightIcon} size={22} color={colors.bronze.base} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  safeArea: {},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  side: {
    width: HEADER_SIDE_WIDTH,
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    letterSpacing: letterSpacing.wide,
    color: colors.text.primary,
    textTransform: 'uppercase',
  },
});
