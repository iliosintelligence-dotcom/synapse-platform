/**
 * ReputationSummaryCard — average rating stars, review count, transaction
 * count, trust score snapshot, tier badge. Used in discovery surfaces.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import VerificationTierBadge, { type TierKind } from './VerificationTierBadge';
import { color, fontFamily, space, type } from './tokens';

export type ReputationSummaryCardData = {
  trustScore: number | null;
  tier: TierKind;
  averageRating: number | null;
  reviewCount: number;
  transactionCount: number;
};

export type ReputationSummaryCardProps = {
  summary: ReputationSummaryCardData;
};

export default function ReputationSummaryCard({ summary }: ReputationSummaryCardProps) {
  return (
    <GlassCard depthLayer={2} padding={space.lg}>
      <View style={styles.topRow}>
        <VerificationTierBadge tier={summary.tier} />
        {summary.trustScore !== null && (
          <View style={styles.scorePill}>
            <Text style={styles.scoreVal}>{Math.round(summary.trustScore)}</Text>
            <Text style={styles.scoreLabel}>trust</Text>
          </View>
        )}
      </View>

      <View style={styles.stats}>
        <Stat
          value={summary.averageRating !== null ? summary.averageRating.toFixed(1) : '—'}
          label={`${summary.reviewCount} reviews`}
          star
        />
        <View style={styles.divider} />
        <Stat value={String(summary.transactionCount)} label="transactions" />
      </View>
    </GlassCard>
  );
}

function Stat({ value, label, star }: { value: string; label: string; star?: boolean }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statValRow}>
        {star && <Text style={styles.starGlyph}>★</Text>}
        <Text style={styles.statVal}>{value}</Text>
      </View>
      <Text style={type.caption}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scorePill: { alignItems: 'center' },
  scoreVal: { fontFamily: fontFamily.display, fontSize: 26, color: color.ink, letterSpacing: 0.5, lineHeight: 28 },
  scoreLabel: { fontFamily: fontFamily.medium, fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase', color: color.inkDim },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg },
  stat: { flex: 1 },
  statValRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  starGlyph: { fontSize: 16, color: color.gold },
  statVal: { fontFamily: fontFamily.display, fontSize: 22, color: color.ink, letterSpacing: 0.4 },
  divider: { width: 1, height: 36, backgroundColor: color.glassBorder, marginHorizontal: space.md },
});
