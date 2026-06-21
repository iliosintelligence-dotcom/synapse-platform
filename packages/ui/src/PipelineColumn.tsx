/**
 * PipelineColumn — one stage column: name, lead count, total pipeline value,
 * scrollable list of LeadCards. Composed by PipelineBoard.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import LeadCard, { type LeadCardData } from './LeadCard';
import { color, fontFamily, radius, space, type } from './tokens';

export type PipelineColumnProps = {
  stageLabel: string;
  leads: LeadCardData[];
  /** Pre-formatted total value, e.g. "₦420M" */
  totalValueLabel?: string;
  width?: number;
  onLeadPress?: (leadId: string) => void;
};

export default function PipelineColumn({
  stageLabel,
  leads,
  totalValueLabel,
  width = 280,
  onLeadPress,
}: PipelineColumnProps) {
  return (
    <View style={[styles.column, { width }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[type.label, { color: color.ink }]}>{stageLabel}</Text>
          <View style={styles.count}>
            <Text style={styles.countText}>{leads.length}</Text>
          </View>
        </View>
        {totalValueLabel && <Text style={styles.value}>{totalValueLabel}</Text>}
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} onPress={() => onLeadPress?.(lead.id)} />
        ))}
        {leads.length === 0 && <Text style={styles.empty}>No leads</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingBottom: space.sm,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  count: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22,24,28,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontFamily: fontFamily.semibold, fontSize: 11, color: color.inkMuted },
  value: { fontFamily: fontFamily.display, fontSize: 16, letterSpacing: 0.5, color: color.accent },
  list: { flex: 1 },
  listContent: { gap: space.sm, paddingHorizontal: space.xs, paddingBottom: space.lg },
  empty: {
    fontFamily: fontFamily.light,
    fontSize: 12,
    color: color.inkDim,
    textAlign: 'center',
    paddingVertical: space.lg,
  },
});
