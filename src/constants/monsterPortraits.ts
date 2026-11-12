import { ImageSourcePropType } from 'react-native';
import { PORTRAIT_FRAMING } from './portraitFraming';
import type { PortraitFraming } from './portraitFraming';

export const MONSTER_PORTRAITS: Record<string, ImageSourcePropType> = {
  minotaur: require('../../assets/images/monsters/minotaur.jpg'),
  arachne: require('../../assets/images/monsters/arachne.jpg'),
  hydra: require('../../assets/images/monsters/hydra.jpg'),
  leviathan: require('../../assets/images/monsters/leviathan.jpg'),
  behemoth: require('../../assets/images/monsters/behemoth.jpg'),
  weaver: require('../../assets/images/monsters/weaver.jpg'),
  mammoth: require('../../assets/images/monsters/mammoth.jpg'),
  colossus: require('../../assets/images/monsters/colossus.jpg'),
  dualist: require('../../assets/images/monsters/dualist.jpg'),
  fallen: require('../../assets/images/monsters/fallen.jpg'),
  'two-faced': require('../../assets/images/monsters/two-faced.jpg'),
  unbroken: require('../../assets/images/monsters/unbroken.jpg'),
  judge: require('../../assets/images/monsters/judge.jpg'),
  rite: require('../../assets/images/monsters/rite.jpg'),
  wraith: require('../../assets/images/monsters/wraith.jpg'),
  breaking: require('../../assets/images/monsters/The Breaking.png'),
  descent: require('../../assets/images/monsters/The Descent.png'),
  ravager: require('../../assets/images/monsters/The Ravager.png'),
  sovereign: require('../../assets/images/monsters/SOVEREIGN.png'),
  risen: require('../../assets/images/monsters/RISEN.png'),
  crooked: require('../../assets/images/monsters/CROOKED.png'),
  basilisk: require('../../assets/images/monsters/Basilisk.png'),
};

const FRAMING_BY_SOURCE = new Map<ImageSourcePropType, PortraitFraming>(
  Object.entries(PORTRAIT_FRAMING).map(([key, framing]) => [MONSTER_PORTRAITS[key], framing])
);

/** The frame correction for an artwork whose painted frame is off-centre (see portraitFraming.ts), if any. */
export function getPortraitFraming(source: ImageSourcePropType): PortraitFraming | undefined {
  return FRAMING_BY_SOURCE.get(source);
}

export function getMonsterPortrait(portraitAsset?: string): ImageSourcePropType | undefined {
  if (!portraitAsset) {
    return undefined;
  }
  return MONSTER_PORTRAITS[portraitAsset];
}
