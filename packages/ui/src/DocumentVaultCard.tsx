/**
 * DocumentVaultCard — document categories as sections, a completeness ring,
 * an upload action per category, and a verified indicator per document.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type VaultCategory = {
  key: string;
  label: string;
  filled: boolean;
  verified: boolean;
};

export type DocumentVaultCardProps = {
  categories: VaultCategory[];
  /** 0–100 */
  completeness: number;
  onUpload?: (categoryKey: string) => void;
};

function MiniRing({ pct, size = 56 }: { pct: number; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = circ * (pct / 100);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color.inkFaint} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={pct === 100 ? color.success : color.accent}
          strokeWidth={stroke} fill="none"
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeDashoffset={circ / 4} strokeLinecap="round"
        />
      </Svg>
      <Text style={styles.ringPct}>{pct}%</Text>
    </View>
  );
}

export default function DocumentVaultCard({ categories, completeness, onUpload }: DocumentVaultCardProps) {
  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        <MiniRing pct={completeness} />
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { fontSize: 15 }]}>Document vault</Text>
          <Text style={type.caption}>
            {categories.filter((c) => c.filled).length} of {categories.length} documents · complete vaults raise trust
          </Text>
        </View>
      </View>

      <View style={styles.list}>
        {categories.map((c) => (
          <View key={c.key} style={styles.row}>
            <View
              style={[
                styles.dot,
                c.filled ? (c.verified ? styles.dotVerified : styles.dotFilled) : styles.dotEmpty,
              ]}
            >
              {c.filled && (
                <Icon name={c.verified ? 'check' : 'clock'} size="xs" color={c.verified ? color.success : color.pending} />
              )}
            </View>
            <Text style={[type.body, { flex: 1, fontSize: 13.5 }, !c.filled && { color: color.inkDim }]}>
              {c.label}
            </Text>
            {c.filled ? (
              <Text style={[styles.status, { color: c.verified ? color.success : color.pending }]}>
                {c.verified ? 'Verified' : 'In review'}
              </Text>
            ) : (
              <Pressable style={styles.upload} onPress={() => onUpload?.(c.key)}>
                <Icon name="plus" size="xs" color={color.accent} />
                <Text style={styles.uploadText}>Upload</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  ringPct: { fontFamily: fontFamily.semibold, fontSize: 13, color: color.ink },
  list: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: color.glassBorder,
  },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  dotVerified: { backgroundColor: color.successSoft, borderColor: color.successBorder },
  dotFilled: { backgroundColor: color.pendingSoft, borderColor: color.pendingBorder },
  dotEmpty: { backgroundColor: 'transparent', borderColor: color.inkFaint, borderStyle: 'dashed' },
  status: { fontFamily: fontFamily.medium, fontSize: 11.5 },
  upload: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  uploadText: { fontFamily: fontFamily.semibold, fontSize: 12, color: color.accent },
});
