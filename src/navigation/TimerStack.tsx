import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TimerStackParamList } from './types';
import { TimerHomeScreen } from '../screens/timer/TimerHomeScreen';
import { TimerBuilderScreen } from '../screens/timer/TimerBuilderScreen';
import { TimerRunScreen } from '../screens/timer/TimerRunScreen';
import { CustomWorkoutBuilderScreen } from '../screens/timer/CustomWorkoutBuilderScreen';
import { CustomWorkoutSessionScreen } from '../screens/timer/CustomWorkoutSessionScreen';
import { StopwatchScreen } from '../screens/timer/StopwatchScreen';

const Stack = createNativeStackNavigator<TimerStackParamList>();

export function TimerStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="TimerHome" component={TimerHomeScreen} />
      <Stack.Screen name="TimerBuilder" component={TimerBuilderScreen} />
      <Stack.Screen
        name="TimerRun"
        component={TimerRunScreen}
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen name="CustomWorkoutBuilder" component={CustomWorkoutBuilderScreen} />
      <Stack.Screen
        name="CustomWorkoutSession"
        component={CustomWorkoutSessionScreen}
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen name="Stopwatch" component={StopwatchScreen} options={{ gestureEnabled: false }} />
    </Stack.Navigator>
  );
}
