import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { colors } from '../../theme';

const TRACK_WIDTH = 46;
const TRACK_HEIGHT = 26;
const THUMB_SIZE = 20;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - 6;

/**
 * Kettleborn's on/off switch. Replaces the platform Switch, whose web
 * build drew its "on" thumb in Material teal regardless of thumbColor —
 * the only teal in the app. Same look on iOS, Android and the web: a
 * dark well with a bronze ring, the thumb sliding to a bronze-filled
 * track when on.
 */
export function Toggle({
  value,
  onValueChange,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  accessibilityLabel: string;
}) {
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(position, { toValue: value ? 1 : 0, duration: 140, useNativeDriver: false }).start();
  }, [value, position]);

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value }}
    >
      <Animated.View
        style={[
          styles.track,
          {
            backgroundColor: position.interpolate({
              inputRange: [0, 1],
              outputRange: [colors.void.surface, colors.bronze.base],
            }),
            borderColor: position.interpolate({
              inputRange: [0, 1],
              outputRange: [colors.border.hairlineStrong, colors.bronze.active],
            }),
          },
        ]}
      >
        <Animated.View
          style={[
            styles.thumb,
            {
              backgroundColor: position.interpolate({
                inputRange: [0, 1],
                outputRange: [colors.text.muted, colors.text.primary],
              }),
              transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, THUMB_TRAVEL] }) }],
            },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1,
    padding: 2,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
  },
});
