/**
 * ConsumerReviewCard — star rating, review text, reviewer type (verified
 * transaction / verified viewing), date. Compact and expanded states.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, space, type } from './tokens';

export type ConsumerReviewCardData = {
  id: string;
  rating: number; // 1–5
  text: string | null;
  reviewerName: string;
  verifiedTransaction: boolean;
  dateLabel: string;
};

export type ConsumerReviewCardProps = {
  review: ConsumerReviewCardData;
  compact?: boolean;
};

function Stars({ rating }: { rating: number }) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={[styles.star, { color: i <= rating ? color.gold : color.inkFaint }]}>
          ★
        </Text>
      ))}
    </View>
  );
}

export default function ConsumerReviewCard({ review, compact = false }: ConsumerReviewCardProps) {
  const [expanded, setExpanded] = useState(!compact);
  const longText = (review.text?.length ?? 0) > 120;

  return (
    <GlassCard depthLayer={1} padding={space.md}>
      <View style={styles.head}>
        <Stars rating={review.rating} />
        {review.verifiedTransaction && (
          <View style={styles.verified}>
            <Icon name="check.circle" size="xs" color={color.success} />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        )}
      </View>

      {review.text && (
        <Text
          style={[type.body, { fontSize: 13.5, marginTop: space.sm }]}
          numberOfLines={expanded ? undefined : 3}
        >
          {review.text}
        </Text>
      )}
      {longText && compact && (
        <Pressable onPress={() => setExpanded((e) => !e)}>
          <Text style={styles.more}>{expanded ? 'Show less' : 'Read more'}</Text>
        </Pressable>
      )}

      <View style={styles.foot}>
        <Text style={[type.label, { fontSize: 12 }]}>{review.reviewerName}</Text>
        <Text style={type.caption}>{review.dateLabel}</Text>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stars: { flexDirection: 'row', gap: 1 },
  star: { fontSize: 14 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  verifiedText: { fontFamily: fontFamily.semibold, fontSize: 11, color: color.success },
  more: { fontFamily: fontFamily.semibold, fontSize: 12, color: color.accent, marginTop: 4 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
});
