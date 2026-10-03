/**
 * NavigationRail — bottom dock. White, thin top border. Five tabs per mode.
 * Active: filled-feel icon + accent dot below. Inactive: outline, muted.
 * FloatingSearch + FloatingAIOrb persist above this at all times.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon, { IconName } from './Icon';
import { color, fontFamily, space } from './tokens';

export type RailMode = 'consumer' | 'agency';

type TabDef = { key: string; icon: IconName };

const CONSUMER_TABS: TabDef[] = [
  { key: 'Home', icon: 'house' },
  { key: 'Search', icon: 'search' },
  { key: 'Saved', icon: 'heart' },
  { key: 'Alerts', icon: 'bell' },
  { key: 'Profile', icon: 'person' },
];

const AGENCY_TABS: TabDef[] = [
  { key: 'Dashboard', icon: 'chart' },
  { key: 'Pipeline', icon: 'people' },
  { key: 'Listings', icon: 'building' },
  { key: 'Analytics', icon: 'sliders' },
  { key: 'Profile', icon: 'person' },
];

export type NavigationRailProps = {
  mode: RailMode;
  activeTab: string;
  onSelect: (tab: string) => void;
};

export default function NavigationRail({ mode, activeTab, onSelect }: NavigationRailProps) {
  const tabs = mode === 'consumer' ? CONSUMER_TABS : AGENCY_TABS;

  return (
    <View style={styles.rail}>
      {tabs.map((t) => {
        const active = activeTab === t.key;
        return (
          <Pressable key={t.key} style={styles.tab} onPress={() => onSelect(t.key)}>
            <Icon
              name={t.icon}
              size="md"
              color={active ? color.accent : color.inkDim}
              weight={active ? 2.1 : 1.6}
            />
            <Text style={[styles.label, active && styles.labelActive]}>{t.key}</Text>
            <View style={[styles.dot, { opacity: active ? 1 : 0 }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    flexDirection: 'row',
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.glassBorder,
    paddingTop: space.sm,
    paddingBottom: space.xl,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  label: { fontFamily: fontFamily.medium, fontSize: 10, color: color.inkDim },
  labelActive: { color: color.accent },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: color.accent, marginTop: 1 },
});
