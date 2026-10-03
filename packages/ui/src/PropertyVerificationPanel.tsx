/**
 * PropertyVerificationPanel — the 7-node check display. Each node: type label,
 * status chip (passed green / pending muted), evidence indicator. Failed
 * checks are never passed in (filtered server-side). Expands on tap.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { ScoreRing } from './TrustScoreBadge';
import { color, fontFamily, motion, radius, space, type } from './tokens';

export type VerificationNodeView = {
  key: string;
  label: string;
  status: 'passed' | 'pending';
  hasEvidence?: boolean;
  detail?: string;
};

export type PropertyVerificationPanelProps = {
  nodeScore: number | null;
  nodes: VerificationNodeView[];
};

export default function PropertyVerificationPanel({ nodeScore, nodes }: PropertyVerificationPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const passed = nodes.filter((n) => n.status === 'passed').length;

  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        <ScoreRing score={nodeScore ?? 0} size={54} />
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { fontSize: 15 }]}>Verification</Text>
          <Text style={type.caption}>
            {passed} of {nodes.length} checks passed · independently verified
          </Text>
        </View>
      </View>

      <View style={styles.nodes}>
        {nodes.map((n) => {
          const open = expanded === n.key;
          const isPass = n.status === 'passed';
          return (
            <Pressable
              key={n.key}
              style={styles.node}
              onPress={() => setExpanded(open ? null : n.key)}
            >
              <View style={styles.nodeRow}>
                <View style={[styles.chip, isPass ? styles.chipPass : styles.chipPending]}>
                  <Icon name={isPass ? 'check' : 'clock'} size="xs" color={isPass ? color.success : color.pending} />
                </View>
                <Text style={[type.body, { flex: 1, fontSize: 13.5 }]}>{n.label}</Text>
                {n.hasEvidence && <Icon name="shield" size="xs" color={color.inkDim} />}
                {n.detail && (
                  <Icon name={open ? 'chevron.down' : 'chevron.right'} size="xs" color={color.inkDim} />
                )}
              </View>
              {open && n.detail && (
                <Animated.Text entering={FadeIn.duration(motion.standard)} style={styles.detail}>
                  {n.detail}
                </Animated.Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  nodes: { gap: 2 },
  node: { paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: color.glassBorder },
  nodeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  chipPass: { backgroundColor: color.successSoft, borderColor: color.successBorder },
  chipPending: { backgroundColor: color.pendingSoft, borderColor: color.pendingBorder },
  detail: { fontFamily: fontFamily.light, fontSize: 12.5, color: color.inkMuted, lineHeight: 18, paddingLeft: 32, paddingTop: 6 },
});
