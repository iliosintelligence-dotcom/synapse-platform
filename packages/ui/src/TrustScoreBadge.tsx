/**
 * TrustScoreBadge — circular score ring (SVG arc fill reflects score/100)
 * with verification node chips below. Pass = green pill + check.
 * Pending = muted pill + clock. No failed states on consumer surfaces.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Icon from './Icon';
import { color, fontFamily, space, radius } from './tokens';

export type VerificationNode = { name: string; status: 'pass' | 'pending' };

type Props = {
  score: number; // 0–100
  size?: number;
  nodes?: VerificationNode[];
};

export function ScoreRing({ score, size = 60 }: { score: number; size?: number }) {
  const strokeW = 3.5;
  const r = (size - strokeW) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = circumference * (score / 100);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color.inkFaint} strokeWidth={strokeW} fill="none"
        />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color.accent} strokeWidth={strokeW} fill="none"
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeDashoffset={circumference / 4}
          strokeLinecap="round"
        />
      </Svg>
      <Text style={[styles.score, { fontSize: size * 0.34 }]}>{score}</Text>
    </View>
  );
}

export default function TrustScoreBadge({ score, size = 60, nodes }: Props) {
  return (
    <View style={styles.wrap}>
      <ScoreRing score={score} size={size} />
      {nodes && nodes.length > 0 && (
        <View style={styles.chips}>
          {nodes.map((n) => (
            <View key={n.name} style={[styles.chip, n.status === 'pass' ? styles.pass : styles.pending]}>
              {n.status === 'pass' ? (
                <Icon name="check" size="xs" color={color.success} />
              ) : (
                <Icon name="clock" size="xs" color={color.pending} />
              )}
              <Text style={[styles.chipText, { color: n.status === 'pass' ? color.success : color.pending }]}>
                {n.name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, alignItems: 'flex-start' },
  score: { fontFamily: fontFamily.display, color: color.accent, letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pass: { backgroundColor: color.successSoft, borderColor: color.successBorder },
  pending: { backgroundColor: color.pendingSoft, borderColor: color.pendingBorder },
  chipText: { fontFamily: fontFamily.medium, fontSize: 11 },
});
