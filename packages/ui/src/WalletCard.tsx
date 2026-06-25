/**
 * WalletCard — a Synapse wallet (a dedicated virtual account at a licensed
 * partner). Shows the mirrored balance, purpose, optional savings-goal
 * progress, and a partner-custody disclosure. Balance is never the source of
 * truth — it mirrors the partner ledger.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import Tag from './Tag';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type WalletCardData = {
  purposeLabel: string;
  balanceLabel: string;
  partnerName: string;
  status: 'active' | 'frozen' | 'closed';
  goal?: { label: string; targetLabel: string; progressPct: number } | null;
};

export type WalletCardProps = { wallet: WalletCardData };

const STATUS_VARIANT = { active: 'verified', frozen: 'pending', closed: 'category' } as const;

export default function WalletCard({ wallet }: WalletCardProps) {
  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        <View style={styles.purpose}>
          <Icon name="wallet" size="sm" color={color.accent} />
          <Text style={type.label}>{wallet.purposeLabel}</Text>
        </View>
        <Tag label={wallet.status} variant={STATUS_VARIANT[wallet.status]} />
      </View>

      <Text style={styles.balance}>{wallet.balanceLabel}</Text>

      {wallet.goal && (
        <View style={styles.goal}>
          <View style={styles.goalHead}>
            <Text style={type.caption}>{wallet.goal.label}</Text>
            <Text style={styles.goalTarget}>{wallet.goal.targetLabel}</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, wallet.goal.progressPct)}%` }]} />
          </View>
        </View>
      )}

      <View style={styles.partner}>
        <Icon name="shield" size="xs" color={color.gold} />
        <Text style={type.caption}>Virtual account at {wallet.partnerName} · balance mirrored & reconciled</Text>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  purpose: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  balance: { fontFamily: fontFamily.display, fontSize: 38, letterSpacing: 1, color: color.ink, marginTop: space.sm },
  goal: { marginTop: space.md, gap: 6 },
  goalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalTarget: { fontFamily: fontFamily.semibold, fontSize: 12, color: color.ink },
  track: { height: 6, borderRadius: 3, backgroundColor: color.inkFaint, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: color.accent },
  partner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md,
    paddingVertical: space.sm, paddingHorizontal: space.md,
    backgroundColor: color.goldSoft, borderRadius: radius.sm,
  },
});
