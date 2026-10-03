/**
 * EscrowCard — an escrow account with its milestone ladder. Shows the held
 * amount, status, the licensed partner holding the funds, and each milestone's
 * approval state. Funds only move on a confirmed partner webhook (status here
 * mirrors the partner).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import Tag from './Tag';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type EscrowStatusKind =
  | 'pending_funding'
  | 'funded'
  | 'held'
  | 'partially_released'
  | 'released'
  | 'refunded'
  | 'disputed';

export type EscrowMilestoneView = {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected';
  releaseLabel: string | null;
};

export type EscrowCardData = {
  amountLabel: string;
  status: EscrowStatusKind;
  partnerName: string;
  typeLabel: string;
  milestones: EscrowMilestoneView[];
};

export type EscrowCardProps = { escrow: EscrowCardData };

const STATUS_VARIANT: Record<EscrowStatusKind, 'status' | 'pending' | 'verified' | 'category'> = {
  pending_funding: 'pending',
  funded: 'status',
  held: 'status',
  partially_released: 'status',
  released: 'verified',
  refunded: 'category',
  disputed: 'pending',
};

export default function EscrowCard({ escrow }: EscrowCardProps) {
  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={type.label}>{escrow.typeLabel}</Text>
          <Text style={styles.amount}>{escrow.amountLabel}</Text>
        </View>
        <Tag label={escrow.status.replace(/_/g, ' ')} variant={STATUS_VARIANT[escrow.status]} />
      </View>

      <View style={styles.partner}>
        <Icon name="shield" size="xs" color={color.gold} />
        <Text style={type.caption}>Held by {escrow.partnerName} · funds move only on partner confirmation</Text>
      </View>

      <View style={styles.milestones}>
        {escrow.milestones.map((m) => {
          const done = m.status === 'approved';
          return (
            <View key={m.id} style={styles.milestone}>
              <View style={[styles.dot, done ? styles.dotDone : m.status === 'rejected' ? styles.dotRej : styles.dotPend]}>
                {done && <Icon name="check" size="xs" color={color.surface} weight={2.4} />}
              </View>
              <Text style={[type.body, { flex: 1, fontSize: 13.5 }]}>{m.name}</Text>
              {m.releaseLabel && <Text style={styles.release}>{m.releaseLabel}</Text>}
            </View>
          );
        })}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  amount: { fontFamily: fontFamily.display, fontSize: 30, letterSpacing: 1, color: color.accent },
  partner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm,
    paddingVertical: space.sm, paddingHorizontal: space.md,
    backgroundColor: color.goldSoft, borderRadius: radius.sm,
  },
  milestones: { marginTop: space.md, gap: 2 },
  milestone: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: color.glassBorder,
  },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  dotDone: { backgroundColor: color.success, borderColor: color.success },
  dotPend: { backgroundColor: color.pendingSoft, borderColor: color.pendingBorder },
  dotRej: { backgroundColor: 'rgba(179,84,30,0.12)', borderColor: 'rgba(179,84,30,0.3)' },
  release: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: color.ink },
});
