/**
 * Property Experience — not a "details page". A vertical chain of cards:
 * immersive photography → price/trust → Toju's take (with reasoning) →
 * the 7-node trust report → who's listing it → Contact Agency.
 * The chain replaces what other apps split across five screens. (Screen 2/3.)
 *
 * Contact Agency is the end of the consumer journey in Layer 0.5 — the lead
 * bridges to the agency on WhatsApp. Swap onContact for leads.createLead().
 */
import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Image, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  InsightCard,
  TrustScoreBadge,
  AgentCard,
  Icon,
  Display,
  Title,
  Body,
  Caption,
  color,
  space,
  radius,
  fontFamily,
} from '@synapse/ui';
import { findProperty } from '../../src/mock';

export default function PropertyExperience() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const property = findProperty(id ?? '');
  const [contacted, setContacted] = useState(false);

  if (!property) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Caption>Property not found.</Caption>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
        {/* Immersive edge-to-edge hero */}
        <View style={{ height: width * 0.92 }}>
          <Image source={{ uri: property.image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <Pressable style={[styles.back, { top: insets.top + space.sm }]} onPress={() => router.back()}>
            <Icon name="chevron.left" size="sm" color={color.ink} />
          </Pressable>
          {property.verified ? (
            <View style={[styles.verified, { top: insets.top + space.sm }]}>
              <Icon name="check.circle" size="xs" color={color.success} />
              <Caption style={{ color: color.success, fontFamily: fontFamily.semibold }}>Verified</Caption>
            </View>
          ) : null}
        </View>

        {/* Price + title, lifting over the photo */}
        <View style={styles.summary}>
          <Display style={{ fontSize: 40, color: color.accent }}>{property.price}</Display>
          <Title style={{ fontSize: 18, marginTop: 2 }}>{property.title}</Title>
          <View style={styles.loc}>
            <Icon name="pin" size="xs" color={color.inkDim} />
            <Caption>{property.location}</Caption>
          </View>
        </View>

        <View style={styles.chain}>
          {/* Toju's take */}
          {property.aiSummary ? (
            <InsightCard
              label="Toju's take"
              reasoning={property.aiSummary}
              confidence={property.trustScore}
            />
          ) : null}

          {/* The 7-node trust report */}
          <View style={styles.block}>
            <Caption style={styles.blockLabel}>TRUST REPORT</Caption>
            <View style={styles.trust}>
              <TrustScoreBadge score={property.trustScore} nodes={property.nodes} />
            </View>
          </View>

          {/* Who's listing it */}
          <View style={styles.block}>
            <Caption style={styles.blockLabel}>LISTED BY</Caption>
            <AgentCard
              agencyName="Prestige Realty Ltd."
              agentName="Adaeze Okonkwo"
              verificationLabel="Gold Partner"
              available
              tojuSummary="Closed 12 verified deals this year. Median response time 8 minutes. Strong record in the Lekki corridor."
            />
          </View>
        </View>
      </ScrollView>

      {/* Primary action — the only one in the MVP consumer journey */}
      <View style={[styles.dock, { paddingBottom: insets.bottom + space.md }]}>
        <Pressable
          style={[styles.contact, contacted && styles.contacted]}
          onPress={() => setContacted(true)}
          disabled={contacted}
        >
          <Icon name={contacted ? 'check' : 'message'} size="sm" color="#fff" />
          <Body style={styles.contactText}>
            {contacted ? 'Lead sent — the agency will reach you on WhatsApp' : 'Contact Agency'}
          </Body>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  center: { alignItems: 'center', justifyContent: 'center' },
  back: {
    position: 'absolute',
    left: space.lg,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verified: {
    position: 'absolute',
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  summary: {
    backgroundColor: color.canvas,
    marginTop: -24,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  chain: { padding: space.lg, gap: space.lg },
  block: { gap: space.sm },
  blockLabel: { letterSpacing: 1, color: color.inkDim },
  trust: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: 'rgba(253,253,252,0.92)',
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: color.glassBorder,
  },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: color.accent,
    borderRadius: radius.pill,
    paddingVertical: space.md,
  },
  contacted: { backgroundColor: color.success },
  contactText: { color: '#fff', fontFamily: fontFamily.semibold },
});
