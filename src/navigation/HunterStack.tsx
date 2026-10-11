import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HunterStackParamList } from './types';
import { HunterScreen } from '../screens/hunter/HunterScreen';
import { AchievementsScreen } from '../screens/hunter/AchievementsScreen';

const Stack = createNativeStackNavigator<HunterStackParamList>();

export function HunterStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Hunter" component={HunterScreen} />
      <Stack.Screen name="Achievements" component={AchievementsScreen} />
    </Stack.Navigator>
  );
}
