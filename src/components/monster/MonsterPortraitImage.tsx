import React from 'react';
import { Image, ImageSourcePropType, ImageStyle, StyleProp, StyleSheet } from 'react-native';
import { getPortraitFraming } from '../../constants/monsterPortraits';
import { getPortraitFramingLayout } from '../../constants/portraitFraming';

interface MonsterPortraitImageProps {
  source: ImageSourcePropType;
  style?: StyleProp<ImageStyle>;
  /**
   * Centre the artwork's painted frame in a circular portrait (default).
   * false for a full-page/non-circular use (World Map hero page), where
   * the artwork is shown as authored.
   */
  fitCircularFrame?: boolean;
}

/**
 * Shared centered, aspect-preserving artwork fit for every monster
 * portrait frame. Artwork whose painted circular frame is off-centre or
 * inset in its file (Mammoth, Basilisk — see PORTRAIT_FRAMING) is scaled
 * and shifted so its frame sits centred in the circle like every other
 * monster's; the parent frame's overflow: 'hidden' clips the margin.
 */
export function MonsterPortraitImage({ source, style, fitCircularFrame = true }: MonsterPortraitImageProps) {
  const framing = fitCircularFrame ? getPortraitFraming(source) : undefined;
  if (!framing) {
    return <Image source={source} style={[styles.image, style]} resizeMode="cover" />;
  }
  const layout = getPortraitFramingLayout(framing);
  return (
    <Image
      source={source}
      resizeMode="cover"
      style={[
        styles.image,
        style,
        {
          position: 'absolute',
          width: `${layout.size}%`,
          height: `${layout.size}%`,
          left: `${layout.left}%`,
          top: `${layout.top}%`,
          alignSelf: undefined,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    height: '100%',
    alignSelf: 'center',
  },
});
