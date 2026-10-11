import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ForgeStackParamList } from './types';
import { ForgeScreen } from '../screens/forge/ForgeScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { SignInScreen } from '../screens/account/SignInScreen';
import { CreateAccountScreen } from '../screens/account/CreateAccountScreen';

const Stack = createNativeStackNavigator<ForgeStackParamList>();

export function ForgeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Forge" component={ForgeScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="CreateAccount" component={CreateAccountScreen} />
    </Stack.Navigator>
  );
}
