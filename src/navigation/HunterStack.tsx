import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HunterStackParamList } from './types';
import { HunterScreen } from '../screens/hunter/HunterScreen';

const Stack = createNativeStackNavigator<HunterStackParamList>();

export function HunterStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Hunter" component={HunterScreen} />
    </Stack.Navigator>
  );
}
