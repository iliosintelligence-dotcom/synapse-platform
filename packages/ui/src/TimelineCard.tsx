/**
 * TimelineCard — one activity row: icon, description, actor, timestamp.
 * Used inside Deal Rooms and Lead detail. Composed by ActivityFeed.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon, { type IconName } from './Icon';
import { color, fontFamily, space, type } from './tokens';

export type TimelineCardData = {
  id: string;
  icon: IconName;
  description: string;
  actor: string | null;
  timeLabel: string;
  /** Accent the node for milestone activities (deal closed, offer made) */
  highlight?: boolean;
};

export type TimelineCardProps = {
  item: TimelineCardData;
  /** Hide the connecting line below the last item */
  isLast?: boolean;
};

export default function TimelineCard({ item, isLast = false }: TimelineCardProps) {
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={[styles.node, item.highlight && styles.nodeHighlight]}>
          <Icon name={item.icon} size="xs" color={item.highlight ? color.surface : color.accent} />
        </View>
        {!isLast && <View style={styles.line} />}
      </View>

      <View style={styles.content}>
        <Text style={[type.body, { fontSize: 13.5, lineHeight: 19 }]}>{item.description}</Text>
        <View style={styles.meta}>
          {item.actor && <Text style={styles.actor}>{item.actor}</Text>}
          <Text style={type.caption}>{item.timeLabel}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md },
  rail: { alignItems: 'center', width: 32 },
  node: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.accentSoft,
    borderWidth: 1,
    borderColor: color.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeHighlight: { backgroundColor: color.accent, borderColor: color.accent },
  line: { flex: 1, width: 1, backgroundColor: color.glassBorder, marginVertical: 4, minHeight: 12 },
  content: { flex: 1, paddingBottom: space.lg },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 3 },
  actor: { fontFamily: fontFamily.medium, fontSize: 11.5, color: color.inkMuted },
});
