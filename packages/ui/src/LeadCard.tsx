/**
 * LeadCard — a lead at a glance in the pipeline. Extends GlassCard (Layer 2).
 * Name, property interest, stage badge, score, last activity, assigned agent,
 * source badge, risk flag.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Avatar from './Avatar';
import Tag from './Tag';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type LeadCardData = {
  id: string;
  consumerName: string;
  propertyTitle: string;
  stageLabel: string;
  /** 0–100; null until scored */
  leadScore: number | null;
  lastActivityLabel: string | null;
  assignedAgentName: string | null;
  sourceLabel: string;
  /** 'low' | 'medium' | 'high' | null */
  riskLevel: 'low' | 'medium' | 'high' | null;
};

export type LeadCardProps = {
  lead: LeadCardData;
  onPress?: () => void;
};

const RISK_COLOR: Record<'low' | 'medium' | 'high', string> = {
  low: color.success,
  medium: color.pending,
  high: color.warning,
};

export default function LeadCard({ lead, onPress }: LeadCardProps) {
  return (
    <Pressable onPress={onPress}>
      <GlassCard depthLayer={2} padding={space.md}>
        <View style={styles.topRow}>
          <Text style={[type.title, { fontSize: 14, flex: 1 }]} numberOfLines={1}>
            {lead.consumerName}
          </Text>
          {lead.riskLevel && (
            <View style={[styles.riskDot, { backgroundColor: RISK_COLOR[lead.riskLevel] }]} />
          )}
          {lead.leadScore !== null && (
            <View style={styles.score}>
              <Text style={styles.scoreText}>{Math.round(lead.leadScore)}</Text>
            </View>
          )}
        </View>

        <Text style={[type.caption, { marginTop: 2 }]} numberOfLines={1}>
          {lead.propertyTitle}
        </Text>

        <View style={styles.badges}>
          <Tag label={lead.stageLabel} variant="status" />
          <Tag label={lead.sourceLabel} variant="category" />
        </View>

        <View style={styles.footer}>
          {lead.assignedAgentName ? (
            <View style={styles.agent}>
              <Avatar name={lead.assignedAgentName} size="sm" />
              <Text style={type.caption} numberOfLines={1}>
                {lead.assignedAgentName}
              </Text>
            </View>
          ) : (
            <View style={styles.unassigned}>
              <Icon name="person" size="xs" color={color.inkDim} />
              <Text style={type.caption}>Unassigned</Text>
            </View>
          )}
          {lead.lastActivityLabel && (
            <Text style={[type.caption, { color: color.inkDim }]}>{lead.lastActivityLabel}</Text>
          )}
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  riskDot: { width: 8, height: 8, borderRadius: 4 },
  score: {
    minWidth: 28,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    backgroundColor: color.accentSoft,
    borderWidth: 1,
    borderColor: color.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: { fontFamily: fontFamily.semibold, fontSize: 12, color: color.accent },
  badges: { flexDirection: 'row', gap: space.xs, marginTop: space.sm, flexWrap: 'wrap' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
  },
  agent: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  unassigned: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
