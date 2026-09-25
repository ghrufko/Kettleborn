import { ImageSourcePropType } from 'react-native';

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
  breaking: require('../../assets/images/monsters/breaking.jpg'),
  descent: require('../../assets/images/monsters/descent.jpg'),
  ravager: require('../../assets/images/monsters/ravager.jpg'),
};

export function getMonsterPortrait(portraitAsset?: string): ImageSourcePropType | undefined {
  if (!portraitAsset) {
    return undefined;
  }
  return MONSTER_PORTRAITS[portraitAsset];
}
