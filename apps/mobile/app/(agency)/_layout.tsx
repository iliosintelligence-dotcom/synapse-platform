/** Agency tab group — VisionDock in agency mode. */
import React from 'react';
import { Tabs } from 'expo-router';
import { VisionDock } from '@synapse/ui';

const TAB_FOR_ROUTE: Record<string, string> = {
  dashboard: 'Dashboard',
  pipeline: 'Pipeline',
  listings: 'Listings',
  analytics: 'Analytics',
  profile: 'Profile',
};
const ROUTE_FOR_TAB: Record<string, string> = Object.fromEntries(
  Object.entries(TAB_FOR_ROUTE).map(([route, tab]) => [tab, route]),
);

export default function AgencyLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => {
        const routeName = state.routes[state.index]?.name ?? 'dashboard';
        return (
          <VisionDock
            mode="agency"
            activeTab={TAB_FOR_ROUTE[routeName] ?? 'Dashboard'}
            onSelect={(tab) => {
              const target = ROUTE_FOR_TAB[tab];
              if (target) navigation.navigate(target);
            }}
          />
        );
      }}
    >
      <Tabs.Screen name="dashboard" />
      <Tabs.Screen name="pipeline" />
      <Tabs.Screen name="listings" />
      <Tabs.Screen name="analytics" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
