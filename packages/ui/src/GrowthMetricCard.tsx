/**
 * GrowthMetricCard — metric name, current value, % change vs previous period,
 * and a sparkline. Platform admin growth dashboard.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, space, type } from './tokens';

export type GrowthMetricCardData = {
  name: string;
  value: string;
  deltaPct: number | null;
  /** recent values for the sparkline */
  series: number[];
};

export type GrowthMetricCardProps = {
  metric: GrowthMetricCardData;
};

function Sparkline({ series, up }: { series: number[]; up: boolean }) {
  const w = 96;
  const h = 30;
  if (series.length < 2) return <View style={{ width: w, height: h }} />;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const pts = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <Svg width={w} height={h}>
      <Polyline points={pts} fill="none" stroke={up ? color.success : color.warning} strokeWidth={1.6} />
    </Svg>
  );
}

export default function GrowthMetricCard({ metric }: GrowthMetricCardProps) {
  const up = metric.deltaPct === null ? true : metric.deltaPct >= 0;
  return (
    <GlassCard depthLayer={1} padding={space.lg}>
      <Text style={styles.name}>{metric.name}</Text>
      <View style={styles.row}>
        <Text style={styles.value}>{metric.value}</Text>
        <Sparkline series={metric.series} up={up} />
      </View>
      {metric.deltaPct !== null && (
        <View style={styles.trend}>
          <View style={!up ? styles.flip : undefined}>
            <Icon name="arrow.up" size="xs" color={up ? color.success : color.warning} />
          </View>
          <Text style={[styles.delta, { color: up ? color.success : color.warning }]}>
            {Math.abs(metric.deltaPct).toFixed(1)}%
          </Text>
          <Text style={type.caption}>vs last period</Text>
        </View>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  name: {
    fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 0.6,
    textTransform: 'uppercase', color: color.inkMuted,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: space.xs },
  value: { fontFamily: fontFamily.display, fontSize: 32, color: color.ink, letterSpacing: 0.5 },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.sm },
  flip: { transform: [{ scaleY: -1 }] },
  delta: { fontFamily: fontFamily.semibold, fontSize: 12 },
});
