/**
 * PerformanceCard — metric name, current value, trend indicator, comparison
 * to the previous period. Reads from pre-aggregated snapshots upstream.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, space, type } from './tokens';

export type PerformanceCardData = {
  label: string;
  /** Pre-formatted, e.g. "₦420M", "32", "4.2h" */
  value: string;
  /** Percentage change vs previous period; null hides the trend */
  deltaPct: number | null;
  /** For metrics where down is good (e.g. response time), invert colours */
  lowerIsBetter?: boolean;
};

export type PerformanceCardProps = {
  metric: PerformanceCardData;
};

export default function PerformanceCard({ metric }: PerformanceCardProps) {
  const { deltaPct, lowerIsBetter } = metric;
  const up = deltaPct !== null && deltaPct > 0;
  const flat = deltaPct === null || deltaPct === 0;
  const good = deltaPct === null ? true : lowerIsBetter ? deltaPct < 0 : deltaPct > 0;
  const trendColor = flat ? color.inkDim : good ? color.success : color.warning;

  return (
    <GlassCard depthLayer={1} padding={space.lg}>
      <Text style={styles.label}>{metric.label}</Text>
      <Text style={styles.value}>{metric.value}</Text>
      {deltaPct !== null && (
        <View style={styles.trend}>
          <View style={!up && !flat ? styles.flip : undefined}>
            <Icon name="arrow.up" size="xs" color={trendColor} />
          </View>
          <Text style={[styles.delta, { color: trendColor }]}>
            {Math.abs(deltaPct).toFixed(1)}%
          </Text>
          <Text style={type.caption}>vs last period</Text>
        </View>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: color.inkMuted,
  },
  value: {
    fontFamily: fontFamily.display,
    fontSize: 34,
    letterSpacing: 0.5,
    color: color.ink,
    marginTop: space.xs,
  },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.sm },
  delta: { fontFamily: fontFamily.semibold, fontSize: 12 },
  flip: { transform: [{ scaleY: -1 }] },
});
