/**
 * CampaignCard — name, type badge, date range, active platforms, and the
 * funnel (reach · inquiries · closes) as three inline numbers. Expandable to
 * full campaign analytics.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Tag from './Tag';
import Icon from './Icon';
import { color, fontFamily, space, type } from './tokens';

export type CampaignCardData = {
  id: string;
  name: string;
  typeLabel: string;
  dateRange: string;
  platforms: string[];
  status: 'draft' | 'active' | 'paused' | 'completed';
  reach: number;
  inquiries: number;
  closes: number;
};

export type CampaignCardProps = {
  campaign: CampaignCardData;
  onPress?: () => void;
};

const STATUS_VARIANT = { draft: 'category', active: 'status', paused: 'pending', completed: 'verified' } as const;

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

export default function CampaignCard({ campaign, onPress }: CampaignCardProps) {
  return (
    <Pressable onPress={onPress}>
      <GlassCard depthLayer={2}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { fontSize: 15 }]} numberOfLines={1}>{campaign.name}</Text>
            <Text style={type.caption}>{campaign.dateRange}</Text>
          </View>
          <Tag label={campaign.status} variant={STATUS_VARIANT[campaign.status]} />
        </View>

        <View style={styles.tags}>
          <Tag label={campaign.typeLabel} variant="category" />
          {campaign.platforms.map((p) => (
            <Tag key={p} label={p} variant="category" />
          ))}
        </View>

        <View style={styles.funnel}>
          <Funnel value={fmt(campaign.reach)} label="reach" />
          <Icon name="chevron.right" size="xs" color={color.inkFaint} />
          <Funnel value={fmt(campaign.inquiries)} label="inquiries" />
          <Icon name="chevron.right" size="xs" color={color.inkFaint} />
          <Funnel value={fmt(campaign.closes)} label="closes" accent />
        </View>
      </GlassCard>
    </Pressable>
  );
}

function Funnel({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View style={styles.funnelItem}>
      <Text style={[styles.funnelVal, accent && { color: color.accent }]}>{value}</Text>
      <Text style={type.caption}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  funnel: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: space.md, paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: color.glassBorder,
  },
  funnelItem: { alignItems: 'center', flex: 1 },
  funnelVal: { fontFamily: fontFamily.display, fontSize: 22, color: color.ink, letterSpacing: 0.4 },
});
