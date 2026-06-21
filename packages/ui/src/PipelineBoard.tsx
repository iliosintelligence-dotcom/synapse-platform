/**
 * PipelineBoard — horizontal scroll of PipelineColumns, one per stage.
 * Presentational: the screen wires Realtime (subscribeToPipeline) and passes
 * grouped leads + per-stage value labels. Drag-to-move is handled by the
 * screen via onMoveLead (gesture wiring lives at the screen layer so the
 * primitive stays pure).
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import PipelineColumn from './PipelineColumn';
import type { LeadCardData } from './LeadCard';
import { space } from './tokens';

export type PipelineStageGroup = {
  stage: string;
  stageLabel: string;
  leads: LeadCardData[];
  totalValueLabel?: string;
};

export type PipelineBoardProps = {
  stages: PipelineStageGroup[];
  columnWidth?: number;
  onLeadPress?: (leadId: string) => void;
};

export default function PipelineBoard({ stages, columnWidth = 280, onLeadPress }: PipelineBoardProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {stages.map((s) => (
        <View key={s.stage} style={{ width: columnWidth }}>
          <PipelineColumn
            stageLabel={s.stageLabel}
            leads={s.leads}
            totalValueLabel={s.totalValueLabel}
            width={columnWidth}
            onLeadPress={onLeadPress}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
});
