/**
 * FinancialIdentityCard — the user's own consumer financial trust signal:
 * overall score ring + component bars + the "how to improve" hint. This is
 * the self-view; landlords/lenders only ever see a consented aggregate.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type ScoreComponent = { label: string; value: number };

export type FinancialIdentityCardData = {
  overallScore: number | null;
  components: ScoreComponent[];
  rentalHistoryVerified: boolean;
  improveHint: string | null;
};

export type FinancialIdentityCardProps = {
  identity: FinancialIdentityCardData;
};

function Ring({ score }: { score: number }) {
  const size = 96;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = c * (score / 100);
  const col = score >= 75 ? color.success : score >= 50 ? color.accent : color.warning;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color.inkFaint} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={col} strokeWidth={stroke} fill="none"
          strokeDasharray={`${filled} ${c - filled}`} strokeDashoffset={c / 4} strokeLinecap="round" />
      </Svg>
      <Text style={styles.score}>{Math.round(score)}</Text>
    </View>
  );
}

export default function FinancialIdentityCard({ identity }: FinancialIdentityCardProps) {
  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        {identity.overallScore !== null ? <Ring score={identity.overallScore} /> : (
          <View style={styles.noScore}><Text style={type.caption}>Not yet scored</Text></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { fontSize: 16 }]}>Financial identity</Text>
          <Text style={type.caption}>Your private credit-style signal, built from real Synapse activity.</Text>
          {identity.rentalHistoryVerified && (
            <View style={styles.verified}>
              <Icon name="check.circle" size="xs" color={color.success} />
              <Text style={styles.verifiedText}>Rental history verified</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.components}>
        {identity.components.map((cmp) => (
          <View key={cmp.label} style={styles.cmp}>
            <View style={styles.cmpHead}>
              <Text style={type.caption}>{cmp.label}</Text>
              <Text style={styles.cmpVal}>{Math.round(cmp.value)}</Text>
            </View>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.min(100, cmp.value)}%` }]} />
            </View>
          </View>
        ))}
      </View>

      {identity.improveHint && (
        <View style={styles.hint}>
          <Icon name="sparkles" size="xs" color={color.accent} />
          <Text style={[type.body, { flex: 1, fontSize: 13, lineHeight: 19 }]}>{identity.improveHint}</Text>
        </View>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  noScore: { width: 96, height: 96, borderRadius: 48, borderWidth: 1, borderColor: color.glassBorder, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  score: { fontFamily: fontFamily.display, fontSize: 30, color: color.ink, letterSpacing: 0.5 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  verifiedText: { fontFamily: fontFamily.semibold, fontSize: 11.5, color: color.success },
  components: { marginTop: space.lg, gap: space.md },
  cmp: { gap: 5 },
  cmpHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cmpVal: { fontFamily: fontFamily.semibold, fontSize: 12, color: color.ink },
  bar: { height: 6, borderRadius: 3, backgroundColor: color.inkFaint, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: color.accent },
  hint: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: color.accentSoft, borderRadius: radius.sm, padding: space.md, marginTop: space.md },
});
