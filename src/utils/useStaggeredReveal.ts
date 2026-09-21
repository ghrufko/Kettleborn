import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

/**
 * The staged-reveal pattern introduced for the Victory screen in Sprint 17
 * (Rank → XP → Stats → Next Goal) — extracted here so Defeat can use the
 * exact same beat-by-beat entrance instead of duplicating the
 * Animated.stagger + interpolate boilerplate. Returns one style getter per
 * beat; each beat fades in and slides up slightly.
 */
export function useStaggeredReveal(beatCount: number, staggerMs = 180, durationMs = 400) {
  const anims = useRef(Array.from({ length: beatCount }, () => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.stagger(
      staggerMs,
      anims.map((anim) => Animated.timing(anim, { toValue: 1, duration: durationMs, useNativeDriver: true }))
    ).start();
    // Runs once on mount — the animation is an entrance, not something
    // that should re-trigger on prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function revealStyle(beat: number) {
    return {
      opacity: anims[beat],
      transform: [
        {
          translateY: anims[beat].interpolate({
            inputRange: [0, 1],
            outputRange: [16, 0],
          }),
        },
      ],
    };
  }

  return revealStyle;
}
