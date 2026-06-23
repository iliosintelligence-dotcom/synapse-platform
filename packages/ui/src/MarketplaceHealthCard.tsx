/**
 * MarketplaceHealthCard — area name, health-status badge, supply-demand
 * ratio, days on market, demand-score trend. Used in the platform admin
 * dashboard and the agency demand prompt.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type HealthStatusKind = 'healthy' | 'oversupplied' | 'undersupplied' | 'illiquid';

export type MarketplaceHealthCardData = {
  area: string;
  status: HealthStatusKind;
  supplyDemandRatio: number;
  daysOnMarket: number;
  demandScore: number;
  demandTrendUp?: boolean;
  /** optional agency-facing prompt */
  prompt?: string;
};

export type MarketplaceHealthCardProps = {
  data: MarketplaceHealthCardData;
};

const STATUS: Record<HealthStatusKind, { label: string; color: string; soft: string }> = {
  healthy: { label: 'Healthy', color: color.success, soft: color.successSoft },
  oversupplied: { label: 'Oversupplied', color: color.pending, soft: color.pendingSoft },
  undersupplied: { label: 'Undersupplied', color: color.accent, soft: color.accentSoft },
  illiquid: { label: 'Illiquid', color: color.warning, soft: 'rgba(179,84,30,0.10)' },
};

export default function MarketplaceHealthCard({ data }: MarketplaceHealthCardProps) {
  const s = STATUS[data.status];
  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { fontSize: 15 }]}>{data.area}</Text>
          <Text style={type.caption}>Supply / demand · {data.supplyDemandRatio.toFixed(2)}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: s.soft }]}>
          <Text style={[styles.statusText, { color: s.color }]}>{s.label}</Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <Metric value={`${Math.round(data.daysOnMarket)}d`} label="avg on market" />
        <View style={styles.divider} />
        <View style={styles.metric}>
          <View style={styles.demandRow}>
            <Text style={styles.metricVal}>{data.demandScore.toFixed(0)}</Text>
            {data.demandTrendUp !== undefined && (
              <View style={!data.demandTrendUp ? styles.flip : undefined}>
                <Icon name="arrow.up" size="xs" color={data.demandTrendUp ? color.success : color.warning} />
              </View>
            )}
          </View>
          <Text style={type.caption}>demand score</Text>
        </View>
      </View>

      {data.prompt && (
        <View style={styles.prompt}>
          <Icon name="sparkles" size="xs" color={color.accent} />
          <Text style={[type.body, { flex: 1, fontSize: 13, lineHeight: 19 }]}>{data.prompt}</Text>
        </View>
      )}
    </GlassCard>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricVal}>{value}</Text>
      <Text style={type.caption}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  statusPill: { paddingHorizontal: space.sm + 2, paddingVertical: 5, borderRadius: radius.pill },
  statusText: { fontFamily: fontFamily.semibold, fontSize: 11.5 },
  metrics: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg },
  metric: { flex: 1, alignItems: 'center' },
  metricVal: { fontFamily: fontFamily.display, fontSize: 22, color: color.ink, letterSpacing: 0.4 },
  demandRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flip: { transform: [{ scaleY: -1 }] },
  divider: { width: 1, height: 30, backgroundColor: color.glassBorder },
  prompt: {
    flexDirection: 'row', gap: space.sm, alignItems: 'flex-start',
    backgroundColor: color.accentSoft, borderRadius: radius.sm, padding: space.md, marginTop: space.md,
  },
});
