import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChronicleStackParamList } from './types';
import { ChronicleScreen } from '../screens/chronicle/ChronicleScreen';

const Stack = createNativeStackNavigator<ChronicleStackParamList>();

export function ChronicleStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Chronicle" component={ChronicleScreen} />
    </Stack.Navigator>
  );
}
