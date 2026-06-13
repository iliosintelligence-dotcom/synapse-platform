/** Consumer tab group — VisionDock drives navigation. */
import React from 'react';
import { Tabs } from 'expo-router';
import { VisionDock } from '@synapse/ui';

const TAB_FOR_ROUTE: Record<string, string> = {
  home: 'Home',
  search: 'Search',
  saved: 'Saved',
  alerts: 'Alerts',
  profile: 'Profile',
};
const ROUTE_FOR_TAB: Record<string, string> = Object.fromEntries(
  Object.entries(TAB_FOR_ROUTE).map(([route, tab]) => [tab, route]),
);

export default function ConsumerLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => {
        const routeName = state.routes[state.index]?.name ?? 'home';
        return (
          <VisionDock
            mode="consumer"
            activeTab={TAB_FOR_ROUTE[routeName] ?? 'Home'}
            onSelect={(tab) => {
              const target = ROUTE_FOR_TAB[tab];
              if (target) navigation.navigate(target);
            }}
          />
        );
      }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="saved" />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
