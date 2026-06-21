/**
 * DealRoomCard — entry tile for a transaction workspace. Property thumbnail,
 * consumer name, current stage, deal value, days active, quick actions.
 */
import React from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Tag from './Tag';
import Icon, { type IconName } from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type DealRoomQuickAction = { icon: IconName; label: string; onPress?: () => void };

export type DealRoomCardData = {
  id: string;
  propertyTitle: string;
  propertyImage: string | null;
  consumerName: string;
  stageLabel: string;
  dealValueLabel: string | null;
  daysActive: number;
  status: 'active' | 'pending' | 'closed' | 'lost';
};

export type DealRoomCardProps = {
  deal: DealRoomCardData;
  actions?: DealRoomQuickAction[];
  onPress?: () => void;
};

const STATUS_VARIANT = {
  active: 'status',
  pending: 'pending',
  closed: 'verified',
  lost: 'category',
} as const;

export default function DealRoomCard({ deal, actions = [], onPress }: DealRoomCardProps) {
  return (
    <Pressable onPress={onPress}>
      <GlassCard depthLayer={2} padding={0}>
        <View style={styles.body}>
          {deal.propertyImage ? (
            <Image source={{ uri: deal.propertyImage }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Icon name="building" size="md" color={color.inkDim} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { fontSize: 14 }]} numberOfLines={1}>
              {deal.propertyTitle}
            </Text>
            <Text style={type.caption} numberOfLines={1}>
              {deal.consumerName}
            </Text>
            <View style={styles.meta}>
              <Tag label={deal.stageLabel} variant={STATUS_VARIANT[deal.status]} />
              <Text style={[type.caption, { color: color.inkDim }]}>{deal.daysActive}d active</Text>
            </View>
          </View>
          {deal.dealValueLabel && <Text style={styles.value}>{deal.dealValueLabel}</Text>}
        </View>

        {actions.length > 0 && (
          <View style={styles.actions}>
            {actions.map((a) => (
              <Pressable key={a.label} style={styles.action} onPress={a.onPress}>
                <Icon name={a.icon} size="sm" color={color.ink} />
                <Text style={styles.actionLabel}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.md },
  thumb: { width: 56, height: 56, borderRadius: radius.sm },
  thumbFallback: { backgroundColor: 'rgba(22,24,28,0.04)', alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 6 },
  value: { fontFamily: fontFamily.display, fontSize: 18, letterSpacing: 0.5, color: color.accent },
  actions: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: color.glassBorder,
  },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: space.sm },
  actionLabel: { fontFamily: fontFamily.medium, fontSize: 12, color: color.inkMuted },
});
