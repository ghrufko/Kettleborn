import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, ViewStyle } from 'react-native';
import { colors, radii } from '../../theme';

interface ProgressBarProps {
  progress: number; // 0 to 1
  fillColor?: string;
  trackColor?: string;
  height?: number;
  style?: ViewStyle;
}

export function ProgressBar({
  progress,
  fillColor = colors.ember.base,
  trackColor = colors.charcoal.raised,
  height = 8,
  style,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  const widthAnim = useRef(new Animated.Value(clamped)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: clamped,
      duration: 450,
      useNativeDriver: false,
    }).start();
  }, [clamped, widthAnim]);

  const widthInterpolated = widthAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View
      style={[
        styles.track,
        { backgroundColor: trackColor, height, borderRadius: height / 2 },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            backgroundColor: fillColor,
            width: widthInterpolated,
            borderRadius: height / 2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
});
