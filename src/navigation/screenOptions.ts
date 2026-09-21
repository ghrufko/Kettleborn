import { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { colors, fontFamily, fontSize } from '../theme';

export const screenOptions: NativeStackNavigationOptions = {
  headerStyle: { backgroundColor: colors.void.base },
  headerShadowVisible: false,
  headerTintColor: colors.bronze.base,
  headerTitleStyle: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  headerBackButtonDisplayMode: 'minimal',
  contentStyle: { backgroundColor: colors.void.base },
};

export function headerOnlyOptions(title: string): NativeStackNavigationOptions {
  return { title };
}
