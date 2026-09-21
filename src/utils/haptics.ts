import * as Haptics from 'expo-haptics';
import { useAppStore } from '../store';

export function triggerHaptic(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  const hapticsEnabled = useAppStore.getState().settings?.hapticsEnabled ?? true;
  if (!hapticsEnabled) {
    return;
  }
  Haptics.impactAsync(style).catch(() => undefined);
}
