/**
 * FraudFlagCard — admin-only. Flag type, severity, entity reference, status,
 * and admin action buttons. Rendered exclusively in the platform admin
 * dashboard (its data is service-role gated).
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type FraudSeverityKind = 'low' | 'medium' | 'high' | 'critical';

export type FraudFlagCardData = {
  id: string;
  flagTypeLabel: string;
  severity: FraudSeverityKind;
  entityLabel: string;
  statusLabel: string;
  detectionMethod: string | null;
};

export type FraudFlagCardProps = {
  flag: FraudFlagCardData;
  onReview?: () => void;
  onResolve?: () => void;
  onDismiss?: () => void;
};

const SEVERITY: Record<FraudSeverityKind, { label: string; color: string; soft: string }> = {
  low: { label: 'Low', color: color.inkMuted, soft: 'rgba(22,24,28,0.06)' },
  medium: { label: 'Medium', color: color.pending, soft: color.pendingSoft },
  high: { label: 'High', color: color.warning, soft: 'rgba(179,84,30,0.10)' },
  critical: { label: 'Critical', color: '#B0202A', soft: 'rgba(176,32,42,0.10)' },
};

export default function FraudFlagCard({ flag, onReview, onResolve, onDismiss }: FraudFlagCardProps) {
  const sev = SEVERITY[flag.severity];
  return (
    <GlassCard depthLayer={2} padding={space.md}>
      <View style={styles.head}>
        <View style={[styles.sevDot, { backgroundColor: sev.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { fontSize: 14 }]}>{flag.flagTypeLabel}</Text>
          <Text style={type.caption}>{flag.entityLabel}</Text>
        </View>
        <View style={[styles.sevPill, { backgroundColor: sev.soft }]}>
          <Text style={[styles.sevText, { color: sev.color }]}>{sev.label}</Text>
        </View>
      </View>

      {flag.detectionMethod && (
        <View style={styles.method}>
          <Icon name="radar" size="xs" color={color.inkDim} />
          <Text style={type.caption}>{flag.detectionMethod}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable style={[styles.action, styles.actionPrimary]} onPress={onReview}>
          <Text style={[styles.actionText, { color: color.onAccent }]}>Review</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={onResolve}>
          <Text style={styles.actionText}>Resolve</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={onDismiss}>
          <Text style={styles.actionText}>Dismiss</Text>
        </Pressable>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sevDot: { width: 10, height: 10, borderRadius: 5 },
  sevPill: { paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill },
  sevText: { fontFamily: fontFamily.semibold, fontSize: 11 },
  method: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: space.sm },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  action: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: space.sm, borderRadius: 100, backgroundColor: 'rgba(22,24,28,0.05)',
  },
  actionPrimary: { backgroundColor: color.accent },
  actionText: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: color.ink },
});
