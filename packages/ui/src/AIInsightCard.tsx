/**
 * AIInsightCard — Layer 2, higher translucency than PropertyCard, subtle
 * edge glow. Toju avatar + match/insight label + reasoning.
 * Never a recommendation without the why.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type AIInsightCardProps = {
  /** e.g. "87% match" or "Investment signal" */
  label: string;
  /** The reasoning — why this insight exists */
  reasoning: string;
  /** Optional 0–100 confidence bar */
  confidence?: number;
};

export function TojuAvatar({ size = 36 }: { size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Icon name="sparkles" size={size * 0.44} color={color.accent} />
    </View>
  );
}

export default function AIInsightCard({ label, reasoning, confidence }: AIInsightCardProps) {
  return (
    <GlassCard depthLayer={2} blur={40} edgeGlow>
      <View style={styles.row}>
        <TojuAvatar />
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{label}</Text>
          <Text style={[type.body, { marginTop: space.xs }]}>{reasoning}</Text>
          {confidence !== undefined && (
            <View style={styles.confidenceWrap}>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, confidence))}%` }]} />
              </View>
              <Text style={type.caption}>{confidence}% confidence</Text>
            </View>
          )}
        </View>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  avatar: {
    backgroundColor: color.accentSoft,
    borderWidth: 1,
    borderColor: color.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fontFamily.semibold,
    fontSize: 13,
    color: color.accent,
    letterSpacing: 0.2,
  },
  confidenceWrap: { marginTop: space.md, gap: space.xs },
  track: {
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: color.inkFaint,
    overflow: 'hidden',
  },
  fill: { height: 3, borderRadius: radius.pill, backgroundColor: color.accent },
});
