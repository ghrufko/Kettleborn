import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MainTabsParamList } from './types';
import { HuntStack } from './HuntStack';
import { TimerStack } from './TimerStack';
import { ChronicleStack } from './ChronicleStack';
import { HunterStack } from './HunterStack';
import { ForgeStack } from './ForgeStack';
import { BottomNavigation } from '../components/navigation/BottomNavigation';

const Tab = createBottomTabNavigator<MainTabsParamList>();

export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <BottomNavigation {...props} />}
    >
      <Tab.Screen name="HuntTab" component={HuntStack} />
      <Tab.Screen name="TimerTab" component={TimerStack} />
      <Tab.Screen name="ChronicleTab" component={ChronicleStack} />
      <Tab.Screen name="HunterTab" component={HunterStack} />
      <Tab.Screen name="ForgeTab" component={ForgeStack} />
    </Tab.Navigator>
  );
}
