/**
 * DiscoveryFeedCard — feed-type badge (Recommended / Trending / New /
 * Investment / Reduced), property image, match score or trend indicator, and
 * Toju's one-line reason. Tapping expands to a full PropertyCard.
 */
import React from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Icon, { type IconName } from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type FeedKind =
  | 'recommended'
  | 'nearby'
  | 'trending'
  | 'new_listings'
  | 'investment_picks'
  | 'recently_reduced';

export type DiscoveryFeedCardData = {
  id: string;
  feedKind: FeedKind;
  propertyTitle: string;
  propertyImage: string | null;
  price: string;
  matchScore: number | null;
  reason: string;
};

export type DiscoveryFeedCardProps = {
  item: DiscoveryFeedCardData;
  onPress?: () => void;
};

const FEED_META: Record<FeedKind, { label: string; icon: IconName; color: string }> = {
  recommended: { label: 'Recommended', icon: 'sparkles', color: color.accent },
  nearby: { label: 'Nearby', icon: 'pin', color: color.success },
  trending: { label: 'Trending', icon: 'chart', color: color.warning },
  new_listings: { label: 'New', icon: 'house', color: color.accent },
  investment_picks: { label: 'Investment', icon: 'wallet', color: color.gold },
  recently_reduced: { label: 'Reduced', icon: 'card', color: color.success },
};

export default function DiscoveryFeedCard({ item, onPress }: DiscoveryFeedCardProps) {
  const meta = FEED_META[item.feedKind];
  return (
    <Pressable onPress={onPress}>
      <GlassCard depthLayer={2} padding={0}>
        <View style={styles.imageWrap}>
          {item.propertyImage ? (
            <Image source={{ uri: item.propertyImage }} style={styles.image} />
          ) : (
            <View style={[styles.image, styles.imageFallback]}>
              <Icon name="building" size="lg" color={color.inkDim} />
            </View>
          )}
          <View style={[styles.feedBadge, { borderColor: meta.color }]}>
            <Icon name={meta.icon} size="xs" color={meta.color} />
            <Text style={[styles.feedBadgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          {item.matchScore !== null && (
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreText}>{Math.round(item.matchScore)}% match</Text>
            </View>
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={[type.title, { fontSize: 14, flex: 1 }]} numberOfLines={1}>
              {item.propertyTitle}
            </Text>
            <Text style={styles.price}>{item.price}</Text>
          </View>
          <View style={styles.reason}>
            <Icon name="sparkles" size="xs" color={color.accent} />
            <Text style={[type.caption, { flex: 1 }]} numberOfLines={2}>{item.reason}</Text>
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  imageWrap: { position: 'relative' },
  image: { width: '100%', height: 180, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  imageFallback: { backgroundColor: 'rgba(22,24,28,0.05)', alignItems: 'center', justifyContent: 'center' },
  feedBadge: {
    position: 'absolute', top: space.md, left: space.md,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1,
    paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill,
  },
  feedBadgeText: { fontFamily: fontFamily.semibold, fontSize: 11 },
  scoreBadge: {
    position: 'absolute', top: space.md, right: space.md,
    backgroundColor: 'rgba(22,24,28,0.6)', paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill,
  },
  scoreText: { fontFamily: fontFamily.semibold, fontSize: 11, color: '#fff' },
  body: { padding: space.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  price: { fontFamily: fontFamily.display, fontSize: 20, letterSpacing: 0.5, color: color.accent },
  reason: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 6 },
});
