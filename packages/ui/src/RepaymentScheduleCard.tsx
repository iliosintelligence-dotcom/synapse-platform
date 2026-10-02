/**
 * RepaymentScheduleCard — a payment schedule (rent-financing or developer
 * installments): progress bar, next due, and the per-installment ladder.
 * The schedule is the partner lender's / developer's, mirrored for display.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, space, type } from './tokens';

export type RepaymentRowStatus = 'upcoming' | 'paid' | 'late' | 'missed';

export type RepaymentRow = {
  id: string;
  label: string; // "Installment 3 · Due 12 Jun"
  amountLabel: string;
  status: RepaymentRowStatus;
};

export type RepaymentScheduleCardData = {
  title: string;
  paidCount: number;
  totalCount: number;
  nextDueLabel: string | null;
  rows: RepaymentRow[];
};

export type RepaymentScheduleCardProps = {
  schedule: RepaymentScheduleCardData;
};

const STATUS_COLOR: Record<RepaymentRowStatus, string> = {
  upcoming: color.inkDim,
  paid: color.success,
  late: color.pending,
  missed: color.warning,
};

export default function RepaymentScheduleCard({ schedule }: RepaymentScheduleCardProps) {
  const pct = schedule.totalCount > 0 ? Math.round((schedule.paidCount / schedule.totalCount) * 100) : 0;
  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { fontSize: 15 }]}>{schedule.title}</Text>
          <Text style={type.caption}>
            {schedule.paidCount} of {schedule.totalCount} paid
            {schedule.nextDueLabel ? ` · next ${schedule.nextDueLabel}` : ''}
          </Text>
        </View>
        <Text style={styles.pct}>{pct}%</Text>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>

      <View style={styles.rows}>
        {schedule.rows.map((r) => (
          <View key={r.id} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: STATUS_COLOR[r.status] }]} />
            <Text style={[type.body, { flex: 1, fontSize: 13 }]}>{r.label}</Text>
            <Text style={[styles.amt, r.status === 'paid' && { color: color.success }]}>{r.amountLabel}</Text>
          </View>
        ))}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pct: { fontFamily: fontFamily.display, fontSize: 24, color: color.accent, letterSpacing: 0.5 },
  track: { height: 4, borderRadius: 2, backgroundColor: color.inkFaint, marginTop: space.md, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: color.accent },
  rows: { marginTop: space.md, gap: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: color.glassBorder,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  amt: { fontFamily: fontFamily.medium, fontSize: 13, color: color.ink },
});
