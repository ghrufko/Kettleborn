import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const KEEP_AWAKE_TAG = 'kettleborn-session';

export function useConditionalKeepAwake(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [enabled]);
}
