/**
 * ViralLoopCard — loop type, conversion rate at each step, and total
 * completions this month. Platform admin growth dashboard.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type LoopStep = { name: string; conversionPct: number };

export type ViralLoopCardData = {
  loopLabel: string;
  steps: LoopStep[];
  completionsThisMonth: number;
};

export type ViralLoopCardProps = {
  loop: ViralLoopCardData;
};

export default function ViralLoopCard({ loop }: ViralLoopCardProps) {
  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        <Icon name="radar" size="sm" color={color.accent} />
        <Text style={[type.title, { fontSize: 14, flex: 1 }]}>{loop.loopLabel}</Text>
        <Text style={styles.completions}>{loop.completionsThisMonth}</Text>
      </View>
      <Text style={[type.caption, { textAlign: 'right', marginTop: -4 }]}>completions this month</Text>

      <View style={styles.steps}>
        {loop.steps.map((s, i) => (
          <View key={s.name} style={styles.step}>
            <View style={styles.stepHead}>
              <Text style={[type.caption, { flex: 1 }]} numberOfLines={1}>{s.name}</Text>
              <Text style={styles.stepPct}>{s.conversionPct.toFixed(0)}%</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, s.conversionPct)}%` }]} />
            </View>
            {i < loop.steps.length - 1 && (
              <View style={styles.connector}>
                <Icon name="chevron.down" size="xs" color={color.inkFaint} />
              </View>
            )}
          </View>
        ))}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  completions: { fontFamily: fontFamily.display, fontSize: 24, color: color.accent, letterSpacing: 0.5 },
  steps: { marginTop: space.md, gap: 2 },
  step: {},
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 4 },
  stepPct: { fontFamily: fontFamily.semibold, fontSize: 12, color: color.ink },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: 'rgba(22,24,28,0.06)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill, backgroundColor: color.accent },
  connector: { alignItems: 'center', paddingVertical: 2 },
});
