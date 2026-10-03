/**
 * PropertyCard — Layer 2. Three states: compact, expanded, focused.
 * Cards chain: `onGenerate` lets an expanded card contextually produce
 * the next card (insight, commute, affordability…).
 */
import React from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { ScoreRing } from './TrustScoreBadge';
import TrustScoreBadge, { VerificationNode } from './TrustScoreBadge';
import { color, fontFamily, motion, radius, space, type } from './tokens';

export type PropertyCardState = 'compact' | 'expanded' | 'focused';

export type PropertyData = {
  id: string;
  title: string;
  location: string;
  price: string;
  image: string;
  trustScore: number;
  verified?: boolean;
  nodes?: VerificationNode[];
  aiSummary?: string;
};

export type PropertyCardProps = {
  property: PropertyData;
  state?: PropertyCardState;
  saved?: boolean;
  onPress?: () => void;
  onSave?: () => void;
  /** Card chaining — ask this card to generate the next contextual card */
  onGenerate?: (kind: 'insight' | 'analysis' | 'viewing') => void;
  tab?: 'Overview' | "Toju's Take" | 'Finance';
  onTabChange?: (tab: 'Overview' | "Toju's Take" | 'Finance') => void;
};

export default function PropertyCard({
  property,
  state = 'compact',
  saved = false,
  onPress,
  onSave,
  onGenerate,
  tab = 'Overview',
  onTabChange,
}: PropertyCardProps) {
  const imageHeight = state === 'compact' ? 170 : state === 'expanded' ? 230 : 360;

  return (
    <Pressable onPress={onPress}>
      <GlassCard depthLayer={2} padding={0}>
        <View>
          <Image source={{ uri: property.image }} style={[styles.image, { height: imageHeight }]} />
          {property.verified && (
            <View style={styles.verifiedTag}>
              <Icon name="check.circle" size="xs" color={color.success} />
              <Text style={styles.verifiedText}>Verified</Text>
            </View>
          )}
          <Pressable style={styles.saveBtn} onPress={onSave} hitSlop={8}>
            <Icon name={saved ? 'heart.fill' : 'heart'} size="sm" color={saved ? color.accent : color.ink} />
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={styles.headRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.price}>{property.price}</Text>
              <Text style={type.title}>{property.title}</Text>
              <View style={styles.locRow}>
                <Icon name="pin" size="xs" color={color.inkDim} />
                <Text style={type.label}>{property.location}</Text>
              </View>
            </View>
            {state === 'compact' ? (
              <ScoreRing score={property.trustScore} size={48} />
            ) : null}
          </View>

          {state !== 'compact' && (
            <Animated.View entering={FadeIn.duration(motion.standard)} style={{ gap: space.lg, marginTop: space.lg }}>
              <TrustScoreBadge score={property.trustScore} size={56} nodes={property.nodes} />
              {property.aiSummary && (
                <View style={styles.aiLine}>
                  <Icon name="sparkles" size="xs" color={color.accent} />
                  <Text style={[type.body, { flex: 1, fontSize: 13.5, lineHeight: 20 }]}>{property.aiSummary}</Text>
                </View>
              )}
              <View style={styles.actions}>
                <ActionButton label="Ask Toju" icon="sparkles" primary onPress={() => onGenerate?.('insight')} />
                <ActionButton label="Analyse" icon="chart" onPress={() => onGenerate?.('analysis')} />
                <ActionButton label="Visit" icon="calendar" onPress={() => onGenerate?.('viewing')} />
              </View>
            </Animated.View>
          )}

          {state === 'focused' && (
            <View style={styles.tabs}>
              {(['Overview', "Toju's Take", 'Finance'] as const).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.tabBtn, tab === t && styles.tabActive]}
                  onPress={() => onTabChange?.(t)}
                >
                  <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </GlassCard>
    </Pressable>
  );
}

function ActionButton({
  label, icon, primary, onPress,
}: { label: string; icon: 'sparkles' | 'chart' | 'calendar'; primary?: boolean; onPress?: () => void }) {
  return (
    <Pressable style={[styles.action, primary && styles.actionPrimary]} onPress={onPress}>
      <Icon name={icon} size="xs" color={primary ? color.onAccent : color.ink} />
      <Text style={[styles.actionText, primary && { color: color.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  image: { width: '100%', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  verifiedTag: {
    position: 'absolute',
    top: space.md,
    left: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  verifiedText: { fontFamily: fontFamily.semibold, fontSize: 11, color: color.success },
  saveBtn: {
    position: 'absolute',
    top: space.sm + 2,
    right: space.sm + 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: space.lg },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  price: { fontFamily: fontFamily.display, fontSize: 27, letterSpacing: 1.2, color: color.accent },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  aiLine: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: color.accentSoft,
    borderRadius: radius.sm,
    padding: space.md,
  },
  actions: { flexDirection: 'row', gap: space.sm },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: space.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22,24,28,0.05)',
  },
  actionPrimary: { backgroundColor: color.accent },
  actionText: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: color.ink },
  tabs: { flexDirection: 'row', gap: space.xs, marginTop: space.lg },
  tabBtn: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22,24,28,0.04)',
  },
  tabActive: { backgroundColor: color.accentSoft, borderWidth: 1, borderColor: color.accentBorder },
  tabText: { fontFamily: fontFamily.medium, fontSize: 12.5, color: color.inkMuted },
  tabTextActive: { color: color.accent },
});
