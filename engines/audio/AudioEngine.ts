import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { useAppStore } from '../../src/store';

export type SoundId =
  | 'start'
  | 'countdown'
  | 'countdownUrgent'
  | 'finish'
  | 'rest'
  | 'nextRound'
  | 'levelUp';

const SOUND_ASSETS: Record<SoundId, number> = {
  start: require('../../assets/audio/start.wav'),
  countdown: require('../../assets/audio/countdown.wav'),
  countdownUrgent: require('../../assets/audio/countdown_urgent.wav'),
  finish: require('../../assets/audio/finish.wav'),
  rest: require('../../assets/audio/rest.wav'),
  nextRound: require('../../assets/audio/next_round.wav'),
  levelUp: require('../../assets/audio/level_up.wav'),
};

class AudioEngineImpl {
  private players: Partial<Record<SoundId, AudioPlayer>> = {};
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true });
    const entries = Object.entries(SOUND_ASSETS) as [SoundId, number][];
    entries.forEach(([id, asset]) => {
      try {
        this.players[id] = createAudioPlayer(asset);
      } catch (error) {
        // A missing/broken sound asset should never crash the app —
        // playback for that cue is simply skipped.
        console.warn(`AudioEngine: failed to load sound "${id}"`, error);
      }
    });
    this.loaded = true;
  }

  /** Call once at app startup; safe to call more than once. */
  async preload(): Promise<void> {
    if (!this.loadingPromise) {
      this.loadingPromise = this.load();
    }
    return this.loadingPromise;
  }

  async playSound(id: SoundId): Promise<void> {
    const soundEnabled = useAppStore.getState().settings?.soundEnabled ?? true;
    if (!soundEnabled) {
      return;
    }
    try {
      await this.preload();
      const player = this.players[id];
      if (!player) {
        return;
      }
      await player.seekTo(0);
      player.play();
    } catch (error) {
      // Sound is decorative feedback — never let a playback error surface
      // as an app crash or block gameplay.
      console.warn(`AudioEngine: failed to play sound "${id}"`, error);
    }
  }
}

export const audioEngine = new AudioEngineImpl();
