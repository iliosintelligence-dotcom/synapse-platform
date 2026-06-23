/**
 * DisputeCard — dispute type, current state, days open, parties, quick
 * actions for the relevant actor. SLA-aware (overdue highlighting).
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Tag from './Tag';
import Icon, { type IconName } from './Icon';
import { color, fontFamily, space, type } from './tokens';

export type DisputeCardAction = { icon: IconName; label: string; onPress?: () => void };

export type DisputeCardData = {
  id: string;
  typeLabel: string;
  stateLabel: string;
  daysOpen: number;
  raisedByLabel: string;
  raisedAgainstLabel: string;
  /** terminal states render resolved styling */
  resolved?: boolean;
  /** past SLA (ack > 24h or open > 14d) */
  overdue?: boolean;
};

export type DisputeCardProps = {
  dispute: DisputeCardData;
  actions?: DisputeCardAction[];
  onPress?: () => void;
};

export default function DisputeCard({ dispute, actions = [], onPress }: DisputeCardProps) {
  return (
    <Pressable onPress={onPress}>
      <GlassCard depthLayer={2} padding={space.md}>
        <View style={styles.head}>
          <View style={[styles.icon, dispute.resolved && styles.iconResolved]}>
            <Icon
              name={dispute.resolved ? 'check.circle' : 'shield'}
              size="sm"
              color={dispute.resolved ? color.success : color.warning}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { fontSize: 14 }]}>{dispute.typeLabel}</Text>
            <Text style={type.caption}>
              {dispute.raisedByLabel} → {dispute.raisedAgainstLabel}
            </Text>
          </View>
          <Tag label={dispute.stateLabel} variant={dispute.resolved ? 'verified' : 'pending'} />
        </View>

        <View style={styles.meta}>
          <Text style={[type.caption, dispute.overdue && { color: color.warning }]}>
            {dispute.overdue ? '⚠ Overdue · ' : ''}
            {dispute.daysOpen}d open
          </Text>
        </View>

        {actions.length > 0 && (
          <View style={styles.actions}>
            {actions.map((a) => (
              <Pressable key={a.label} style={styles.action} onPress={a.onPress}>
                <Icon name={a.icon} size="xs" color={color.ink} />
                <Text style={styles.actionText}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: 'rgba(179,84,30,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconResolved: { backgroundColor: color.successSoft },
  meta: { marginTop: space.sm },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: 100, backgroundColor: 'rgba(22,24,28,0.05)',
  },
  actionText: { fontFamily: fontFamily.semibold, fontSize: 12, color: color.ink },
});
