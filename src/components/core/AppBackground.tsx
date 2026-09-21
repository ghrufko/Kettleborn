import React, { ReactNode } from 'react';
import { View, Image, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors } from '../../theme';

interface AppBackgroundProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Sprint 2 (Monster Atmospheric Overlay prototype): optional monster-
   * identity tint for Hunt screens, sourced exclusively by the calling
   * screen from `getAtmosphericColor` (bossPersonality.ts) — this
   * component never hardcodes or duplicates a monster color, and has no
   * opinion about which monsters qualify. Omitted (undefined) on every
   * screen outside the Hunt flow, and on any monster not yet in the
   * prototype allowlist, so their background stays byte-identical to
   * Sprint 1.
   */
  atmosphericColor?: string;
}

/**
 * Background Foundation (Sprint 1): the single owner of every screen's base
 * background. Replaces each screen's own `backgroundColor: colors.void.base`
 * (previously duplicated per-screen, and a second time inside `Header`) with
 * one shared void fill plus a very subtle edge-darkening depth layer.
 *
 * The depth layer is four faint, flat, semi-transparent black strips along
 * each edge (RN View primitives only — no gradient library). Corners get
 * two overlapping strips, which is what gives the very center of the screen
 * a touch more "presence" than the perimeter — the effect this component
 * exists to produce, without an actual gradient. Deliberately conservative:
 * ~4-5% opacity per strip, non-animated, no texture, no color tint. Remove
 * the `vignette` layer and the screen should feel very slightly flatter,
 * not obviously different.
 *
 * `{children}` render as normal in-flow content on top — this component
 * changes nothing about layout, only what paints behind it. Reusable
 * integration point for a future Hunt-specific atmosphere (not implemented
 * here): that would be a layer inserted between `vignette` and `children`.
 */
export function AppBackground({ children, style, atmosphericColor }: AppBackgroundProps) {
  return (
    <View style={[styles.root, style]}>
      <View style={styles.base} pointerEvents="none" />
      <View style={styles.vignette} pointerEvents="none">
        <View style={styles.edgeTop} />
        <View style={styles.edgeBottom} />
        <View style={styles.edgeLeft} />
        <View style={styles.edgeRight} />
      </View>
      {/* Task 2 (Background Polish): universal, neutral (never monster-
          tinted) insignia watermark — every screen, not just Hunt flow.
          Reuses the project's own logo asset rather than a new one; RN
          <Image>, no blur/filter, just extreme opacity + size, so it reads
          as something etched into the environment rather than a sticker. */}
      <View style={styles.watermarkLayer} pointerEvents="none">
        <Image
          source={require('../../../assets/images/brand/kettleborn-insignia.png')}
          style={styles.watermark}
          resizeMode="contain"
        />
      </View>
      {atmosphericColor ? (
        <View style={styles.atmosphere} pointerEvents="none">
          <View style={[styles.atmosphereRingOuter, { backgroundColor: atmosphericColor }]} />
          <View style={[styles.atmosphereRingOuterMid, { backgroundColor: atmosphericColor }]} />
          <View style={[styles.atmosphereRingMid, { backgroundColor: atmosphericColor }]} />
          <View style={[styles.atmosphereRingInnerMid, { backgroundColor: atmosphericColor }]} />
          <View style={[styles.atmosphereRingInner, { backgroundColor: atmosphericColor }]} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

const VIGNETTE_COLOR = 'rgba(0, 0, 0, 0.05)';

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  base: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.void.base,
  },
  vignette: {
    ...StyleSheet.absoluteFill,
  },
  edgeTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '14%',
    backgroundColor: VIGNETTE_COLOR,
  },
  edgeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '14%',
    backgroundColor: VIGNETTE_COLOR,
  },
  edgeLeft: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '10%',
    backgroundColor: VIGNETTE_COLOR,
  },
  edgeRight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: '10%',
    backgroundColor: VIGNETTE_COLOR,
  },
  // Task 2 (Background Polish): the app's own insignia, extremely faint,
  // fixed screen-relative center — same "no onLayout" simplicity as the
  // atmosphere rings below. Sized modestly (240px) so it never becomes
  // something a player consciously notices during a workout.
  watermarkLayer: {
    ...StyleSheet.absoluteFill,
  },
  watermark: {
    position: 'absolute',
    top: 10,
    left: '50%',
    marginLeft: -120,
    width: 240,
    height: 240,
    opacity: 0.025,
  },
  // Sprint 2/3, softened in Task 2 (Background Polish): five static,
  // concentric, low-opacity circles instead of three — smaller opacity
  // steps between each ring make the falloff read as soft depth rather
  // than distinct rings, without any gradient library. All five still
  // share one vertical center (each ring's top + half its own height =
  // 200), same technique as before, just finer-grained.
  atmosphere: {
    ...StyleSheet.absoluteFill,
  },
  atmosphereRingOuter: {
    position: 'absolute',
    top: -60,
    left: '50%',
    marginLeft: -260,
    width: 520,
    height: 520,
    borderRadius: 260,
    opacity: 0.02,
  },
  atmosphereRingOuterMid: {
    position: 'absolute',
    top: -10,
    left: '50%',
    marginLeft: -210,
    width: 420,
    height: 420,
    borderRadius: 210,
    opacity: 0.025,
  },
  atmosphereRingMid: {
    position: 'absolute',
    top: 60,
    left: '50%',
    marginLeft: -140,
    width: 280,
    height: 280,
    borderRadius: 140,
    opacity: 0.03,
  },
  atmosphereRingInnerMid: {
    position: 'absolute',
    top: 110,
    left: '50%',
    marginLeft: -90,
    width: 180,
    height: 180,
    borderRadius: 90,
    opacity: 0.04,
  },
  atmosphereRingInner: {
    position: 'absolute',
    top: 145,
    left: '50%',
    marginLeft: -55,
    width: 110,
    height: 110,
    borderRadius: 55,
    opacity: 0.05,
  },
});
