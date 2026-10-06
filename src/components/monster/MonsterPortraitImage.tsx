import React from 'react';
import { Image, ImageSourcePropType, ImageStyle, StyleProp, StyleSheet } from 'react-native';

interface MonsterPortraitImageProps {
  source: ImageSourcePropType;
  style?: StyleProp<ImageStyle>;
}

/** Shared centered, aspect-preserving artwork fit for every monster portrait frame. */
export function MonsterPortraitImage({ source, style }: MonsterPortraitImageProps) {
  return <Image source={source} style={[styles.image, style]} resizeMode="cover" />;
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    height: '100%',
    alignSelf: 'center',
  },
});
