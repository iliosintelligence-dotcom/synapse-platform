/**
 * TrustScoreRing — circular trust score with tier badge below and a trend
 * arrow. Used on agency and agent profiles. Score number in Display type.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Icon from './Icon';
import VerificationTierBadge, { type TierKind } from './VerificationTierBadge';
import { color, fontFamily, space } from './tokens';

export type TrustScoreRingProps = {
  score: number; // 0–100
  tier?: TierKind;
  /** % change vs previous period; null hides the trend */
  trendPct?: number | null;
  size?: number;
};

export default function TrustScoreRing({ score, tier, trendPct = null, size = 132 }: TrustScoreRingProps) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = circ * (Math.max(0, Math.min(100, score)) / 100);
  const ringColor = score >= 85 ? color.gold : score >= 65 ? color.success : color.accent;
  const up = trendPct !== null && trendPct >= 0;

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={color.inkFaint} strokeWidth={stroke} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={ringColor}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${filled} ${circ - filled}`}
            strokeDashoffset={circ / 4}
            strokeLinecap="round"
          />
        </Svg>
        <Text style={[styles.score, { fontSize: size * 0.3 }]}>{Math.round(score)}</Text>
        <Text style={styles.scoreLabel}>Trust score</Text>
        {trendPct !== null && (
          <View style={styles.trend}>
            <View style={!up ? styles.flip : undefined}>
              <Icon name="arrow.up" size="xs" color={up ? color.success : color.warning} />
            </View>
            <Text style={[styles.trendText, { color: up ? color.success : color.warning }]}>
              {Math.abs(trendPct).toFixed(1)}%
            </Text>
          </View>
        )}
      </View>
      {tier && <VerificationTierBadge tier={tier} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.md },
  score: { fontFamily: fontFamily.display, color: color.ink, letterSpacing: 0.5 },
  scoreLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: color.inkDim,
    marginTop: -4,
  },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
  trendText: { fontFamily: fontFamily.semibold, fontSize: 11 },
  flip: { transform: [{ scaleY: -1 }] },
});
