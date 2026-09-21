import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ForgeStackParamList } from './types';
import { ForgeScreen } from '../screens/forge/ForgeScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';

const Stack = createNativeStackNavigator<ForgeStackParamList>();

export function ForgeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Forge" component={ForgeScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}
