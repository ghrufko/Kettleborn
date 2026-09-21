import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HuntStackParamList } from './types';
import { HomeScreen } from '../screens/hunt/HomeScreen';
import { HuntScreen } from '../screens/hunt/HuntScreen';
import { WorldMapScreen } from '../screens/hunt/WorldMapScreen';
import { MonsterDetailScreen } from '../screens/hunt/MonsterDetailScreen';
import { HuntOverviewScreen } from '../screens/hunt/HuntOverviewScreen';
import { ActiveHuntScreen } from '../screens/hunt/ActiveHuntScreen';
import { HuntCompleteScreen } from '../screens/hunt/HuntCompleteScreen';
import { HuntFailedScreen } from '../screens/hunt/HuntFailedScreen';
import { ExerciseLibraryScreen } from '../screens/hunt/ExerciseLibraryScreen';
import { ExerciseDetailScreen } from '../screens/hunt/ExerciseDetailScreen';
import { screenOptions } from './screenOptions';

const Stack = createNativeStackNavigator<HuntStackParamList>();

export function HuntStack() {
  return (
    <Stack.Navigator screenOptions={{ ...screenOptions, headerShown: false }}>
      <Stack.Screen name="Hunt" component={HuntScreen} />
      <Stack.Screen name="WorldMap" component={WorldMapScreen} />
      <Stack.Screen name="MonsterDetail" component={MonsterDetailScreen} />
      <Stack.Screen name="HuntOverview" component={HuntOverviewScreen} />
      <Stack.Screen
        name="ActiveHunt"
        component={ActiveHuntScreen}
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen
        name="HuntComplete"
        component={HuntCompleteScreen}
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen
        name="HuntFailed"
        component={HuntFailedScreen}
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen name="ExerciseLibrary" component={ExerciseLibraryScreen} />
      <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} />
      {/*
        Home is kept registered (Sprint 21: removed from the main Hunt flow,
        not deleted — campaigns are the product, not a stats dashboard) so
        it stays reachable if a future sprint wants to reuse it elsewhere.
        Nothing currently navigates here.
      */}
      <Stack.Screen name="Home" component={HomeScreen} />
    </Stack.Navigator>
  );
}
