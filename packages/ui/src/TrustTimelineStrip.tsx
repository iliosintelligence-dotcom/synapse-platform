/**
 * TrustTimelineStrip — horizontal scrollable timeline of reputation
 * milestones. Milestone dots with labels. Used on agency/agent profiles.
 * Transparency creates confidence.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Icon, { type IconName } from './Icon';
import { color, fontFamily, space } from './tokens';

export type TimelineMilestone = {
  id: string;
  label: string;
  dateLabel: string;
  icon?: IconName;
  highlight?: boolean;
};

export type TrustTimelineStripProps = {
  milestones: TimelineMilestone[];
};

export default function TrustTimelineStrip({ milestones }: TrustTimelineStripProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {milestones.map((m, i) => (
        <View key={m.id} style={styles.item}>
          <View style={styles.railRow}>
            {i > 0 && <View style={styles.lineLeft} />}
            <View style={[styles.dot, m.highlight && styles.dotHighlight]}>
              <Icon name={m.icon ?? 'check'} size="xs" color={m.highlight ? color.surface : color.accent} />
            </View>
            {i < milestones.length - 1 && <View style={styles.lineRight} />}
          </View>
          <Text style={styles.label} numberOfLines={2}>{m.label}</Text>
          <Text style={styles.date}>{m.dateLabel}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: space.sm, paddingHorizontal: space.xs },
  item: { width: 116, alignItems: 'center' },
  railRow: { flexDirection: 'row', alignItems: 'center', height: 32, alignSelf: 'stretch', justifyContent: 'center' },
  lineLeft: { position: 'absolute', left: 0, right: '50%', height: 1, backgroundColor: color.glassBorder },
  lineRight: { position: 'absolute', left: '50%', right: 0, height: 1, backgroundColor: color.glassBorder },
  dot: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: color.accentSoft, borderWidth: 1, borderColor: color.accentBorder,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  dotHighlight: { backgroundColor: color.accent, borderColor: color.accent },
  label: { fontFamily: fontFamily.medium, fontSize: 11.5, color: color.ink, textAlign: 'center', marginTop: 6, lineHeight: 15 },
  date: { fontFamily: fontFamily.light, fontSize: 10.5, color: color.inkDim, marginTop: 2 },
});
