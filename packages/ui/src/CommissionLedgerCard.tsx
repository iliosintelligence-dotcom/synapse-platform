/**
 * CommissionLedgerCard — one commission ledger row: deal value, gross
 * commission, the split, the agent's net payout, and pay status. Gives agency
 * owners the visibility that replaces spreadsheet reconciliation.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import Tag from './Tag';
import { color, fontFamily, space, type } from './tokens';

export type CommissionStatusKind = 'pending' | 'approved' | 'paid';

export type CommissionLedgerCardData = {
  dealLabel: string;
  agentName: string;
  transactionValueLabel: string;
  grossLabel: string;
  netPayoutLabel: string;
  splitLabel: string; // e.g. "Agent 60% · Lead 10% · Agency 30%"
  status: CommissionStatusKind;
  paidLabel: string | null;
};

export type CommissionLedgerCardProps = {
  entry: CommissionLedgerCardData;
};

const STATUS_VARIANT = { pending: 'pending', approved: 'status', paid: 'verified' } as const;

export default function CommissionLedgerCard({ entry }: CommissionLedgerCardProps) {
  return (
    <GlassCard depthLayer={1} padding={space.md}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { fontSize: 14 }]} numberOfLines={1}>{entry.dealLabel}</Text>
          <Text style={type.caption}>{entry.agentName} · deal {entry.transactionValueLabel}</Text>
        </View>
        <Tag label={entry.status} variant={STATUS_VARIANT[entry.status]} />
      </View>

      <View style={styles.amounts}>
        <View style={styles.amt}>
          <Text style={type.caption}>Gross</Text>
          <Text style={styles.amtVal}>{entry.grossLabel}</Text>
        </View>
        <View style={styles.amt}>
          <Text style={type.caption}>Agent net</Text>
          <Text style={[styles.amtVal, { color: color.accent }]}>{entry.netPayoutLabel}</Text>
        </View>
      </View>

      <Text style={[type.caption, { marginTop: space.sm }]}>{entry.splitLabel}</Text>
      {entry.paidLabel && (
        <Text style={[type.caption, { color: color.success, marginTop: 2 }]}>✓ Paid {entry.paidLabel}</Text>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  amounts: { flexDirection: 'row', gap: space.xl, marginTop: space.md },
  amt: {},
  amtVal: { fontFamily: fontFamily.display, fontSize: 20, letterSpacing: 0.5, color: color.ink },
});
