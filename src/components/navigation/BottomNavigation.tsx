import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type IoniconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, IoniconName> = {
  HuntTab: 'flame',
  TimerTab: 'timer',
  ChronicleTab: 'stats-chart',
  HunterTab: 'person',
  ForgeTab: 'hammer',
};

const TAB_LABELS: Record<string, string> = {
  HuntTab: 'Hunt',
  TimerTab: 'Timer',
  ChronicleTab: 'Chronicle',
  HunterTab: 'Hunter',
  ForgeTab: 'Forge',
};

export function BottomNavigation({ state, descriptors, navigation }: BottomTabBarProps) {
  // Root cause of "tab bar still visible during Active Hunt": this is a
  // *custom* tabBar render prop (passed via MainTabs.tsx's `tabBar={...}`),
  // and React Navigation's bottom-tabs only auto-hides the bar for
  // `tabBarStyle: { display: 'none' }` when using its own default tab bar
  // renderer. A custom tabBar must check the focused route's options
  // itself. ActiveHuntScreen already calls
  // `navigation.getParent()?.setOptions({ tabBarStyle: { display: 'none' } })`
  // on focus (and clears it on blur) — that half of the wiring was already
  // correct, this component just never read it. StyleSheet.flatten handles
  // both object and array style values safely.
  const focusedOptions = descriptors[state.routes[state.index].key].options;
  // tabBarStyle's declared type includes Animated-interpolated variants
  // that don't apply here in practice (this app only ever sets a plain
  // { display: 'none' } object, in ActiveHuntScreen) — cast is just to
  // satisfy that broader type, not a behavior change.
  const flatTabBarStyle = StyleSheet.flatten(focusedOptions.tabBarStyle as ViewStyle | undefined);
  if (flatTabBarStyle?.display === 'none') {
    return null;
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const isActive = state.index === index;
          const iconName = TAB_ICONS[route.name] ?? 'ellipse';
          const label = TAB_LABELS[route.name] ?? route.name;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isActive && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={label}
              style={styles.tab}
            >
              <Ionicons
                name={iconName}
                size={22}
                color={isActive ? colors.ember.base : colors.steel}
              />
              <Text style={[styles.label, isActive && styles.labelActive]}>{label}</Text>
              {isActive ? <View style={styles.activeIndicator} /> : null}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.void.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  row: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    gap: 4,
  },
  label: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    color: colors.steel,
    textTransform: 'uppercase',
  },
  labelActive: {
    color: colors.text.primary,
  },
  activeIndicator: {
    position: 'absolute',
    top: -1,
    width: 24,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.ember.base,
  },
});
