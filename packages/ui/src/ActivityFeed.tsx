/**
 * ActivityFeed — scrollable list of TimelineCards grouped by date. The screen
 * supplies items (and wires the Realtime subscription); this stays pure.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import TimelineCard, { type TimelineCardData } from './TimelineCard';
import { color, fontFamily, space } from './tokens';

export type ActivityGroup = {
  dateLabel: string; // "Today", "Yesterday", "12 Jun"
  items: TimelineCardData[];
};

export type ActivityFeedProps = {
  groups: ActivityGroup[];
  scroll?: boolean;
};

export default function ActivityFeed({ groups, scroll = true }: ActivityFeedProps) {
  const body = (
    <View style={styles.container}>
      {groups.map((group) => (
        <View key={group.dateLabel} style={styles.group}>
          <Text style={styles.dateLabel}>{group.dateLabel}</Text>
          {group.items.map((item, i) => (
            <TimelineCard key={item.id} item={item} isLast={i === group.items.length - 1} />
          ))}
        </View>
      ))}
      {groups.length === 0 && <Text style={styles.empty}>No activity yet</Text>}
    </View>
  );

  if (!scroll) return body;
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xl },
  container: { gap: space.lg },
  group: { gap: 0 },
  dateLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: color.inkDim,
    marginBottom: space.md,
  },
  empty: { fontFamily: fontFamily.light, fontSize: 13, color: color.inkDim, textAlign: 'center', paddingVertical: space.xl },
});
