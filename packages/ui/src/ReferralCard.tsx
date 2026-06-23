/**
 * ReferralCard — referral code with copy button, referral count, reward
 * status, and an anonymised referred-users list. Consumer profile surface.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type ReferralCardData = {
  code: string;
  totalReferred: number;
  totalTransacted: number;
  rewardsIssued: number;
  rewardsPending: number;
  /** anonymised initials of referred users */
  referredInitials: string[];
};

export type ReferralCardProps = {
  data: ReferralCardData;
  onCopy?: () => void;
  onShare?: () => void;
};

export default function ReferralCard({ data, onCopy, onShare }: ReferralCardProps) {
  return (
    <GlassCard depthLayer={2}>
      <Text style={[type.label, { color: color.inkMuted }]}>Your referral code</Text>
      <View style={styles.codeRow}>
        <Text style={styles.code}>{data.code}</Text>
        <Pressable style={styles.copyBtn} onPress={onCopy}>
          <Icon name="bookmark" size="xs" color={color.accent} />
          <Text style={styles.copyText}>Copy</Text>
        </Pressable>
      </View>

      <View style={styles.stats}>
        <Stat value={String(data.totalReferred)} label="referred" />
        <View style={styles.divider} />
        <Stat value={String(data.totalTransacted)} label="transacted" />
        <View style={styles.divider} />
        <Stat value={String(data.rewardsIssued)} label="rewards" accent />
      </View>

      {data.referredInitials.length > 0 && (
        <View style={styles.avatars}>
          {data.referredInitials.slice(0, 6).map((init, i) => (
            <View key={i} style={[styles.avatar, { marginLeft: i === 0 ? 0 : -8 }]}>
              <Text style={styles.avatarText}>{init}</Text>
            </View>
          ))}
          {data.rewardsPending > 0 && (
            <Text style={[type.caption, { marginLeft: space.sm }]}>
              {data.rewardsPending} reward{data.rewardsPending > 1 ? 's' : ''} pending
            </Text>
          )}
        </View>
      )}

      <Pressable style={styles.share} onPress={onShare}>
        <Icon name="message" size="xs" color={color.onAccent} />
        <Text style={styles.shareText}>Share &amp; earn</Text>
      </Pressable>
    </GlassCard>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statVal, accent && { color: color.accent }]}>{value}</Text>
      <Text style={type.caption}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 6 },
  code: {
    fontFamily: fontFamily.display, fontSize: 28, letterSpacing: 2, color: color.ink, flex: 1,
  },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: color.accentSoft, borderWidth: 1, borderColor: color.accentBorder,
    paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.pill,
  },
  copyText: { fontFamily: fontFamily.semibold, fontSize: 12, color: color.accent },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { fontFamily: fontFamily.display, fontSize: 22, color: color.ink },
  divider: { width: 1, height: 30, backgroundColor: color.glassBorder },
  avatars: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: color.accentSoft, borderWidth: 1.5, borderColor: color.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: fontFamily.semibold, fontSize: 10.5, color: color.accent },
  share: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: space.lg, paddingVertical: space.md, borderRadius: radius.pill, backgroundColor: color.accent,
  },
  shareText: { fontFamily: fontFamily.semibold, fontSize: 13.5, color: color.onAccent },
});
