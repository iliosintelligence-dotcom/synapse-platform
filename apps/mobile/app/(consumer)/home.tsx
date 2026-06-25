/**
 * Toju Conversation — the consumer home and the front door of Synapse.
 * Not a chat tab: a FloatingSearch capsule that expands into a reasoned
 * conversation. Toju asks progressive questions and chains PropertyCards
 * inline; tapping one opens the Property Experience. (Defining screen 1/3.)
 *
 * Mock Toju lives in src/mock — swap mockToju() for toju.sendTojuMessage().
 */
import React, { useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PropertyCard,
  TypingIndicator,
  FloatingSearch,
  GlassCard,
  Title,
  Body,
  Caption,
  Label,
  color,
  space,
  fontFamily,
  radius,
  type PropertyData,
} from '@synapse/ui';
import { MOCK_PROPERTIES, mockToju, type MockTojuTurn } from '../../src/mock';

type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'toju'; turn: MockTojuTurn }
  | { kind: 'typing' };

export default function TojuConversation() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [entries, setEntries] = useState<Entry[]>([
    {
      kind: 'toju',
      turn: {
        message:
          "I'm Toju — your property consultant. Tell me what you're looking for and I'll do the rest. No forms, no endless scrolling.",
        suggestions: ['I want to buy a home', "I'm looking to invest"],
      },
    },
  ]);
  const turnCount = useRef(0);

  const send = (text: string) => {
    const myTurn = turnCount.current;
    turnCount.current += 1;
    setEntries((e) => [...e, { kind: 'user', text }, { kind: 'typing' }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

    setTimeout(() => {
      const turn = mockToju(text, myTurn);
      setEntries((e) => [...e.filter((x) => x.kind !== 'typing'), { kind: 'toju', turn }]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }, 1100);
  };

  const openProperty = (p: PropertyData) => router.push(`/property/${p.id}`);

  // The suggestedAction is rendered as its own affordance, never folded into the
  // message text (Layer 9 "half-open door"). For now every actionable kind opens
  // the referenced property; a future 9.4 surface can branch on `kind`.
  const runAction = (action: NonNullable<MockTojuTurn['suggestedAction']>) => {
    if (action.kind !== 'none' && action.property_id) {
      router.push(`/property/${action.property_id}`);
    }
  };

  return (
    <View style={styles.screen}>
      {/* Ambient header */}
      <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
        <Label style={{ letterSpacing: 3, color: color.inkDim }}>SYNAPSE</Label>
        <View style={styles.headerRow}>
          <Title style={{ fontSize: 30, letterSpacing: 1 }}>Toju</Title>
          <View style={styles.statusDot} />
          <Caption>Online · your consultant</Caption>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 96 }]}
        showsVerticalScrollIndicator={false}
      >
        {entries.map((entry, i) => {
          if (entry.kind === 'user') {
            return (
              <View key={i} style={styles.userBubble}>
                <Body style={styles.userText}>{entry.text}</Body>
              </View>
            );
          }
          if (entry.kind === 'typing') return <TypingIndicator key={i} />;

          const { turn } = entry;
          return (
            <View key={i} style={{ gap: space.sm }}>
              <GlassCard depthLayer={2} edgeGlow>
                <Body>{turn.message}</Body>
                {turn.reasoning ? (
                  <View style={styles.reasoning}>
                    <Caption style={{ color: color.accent }}>WHY</Caption>
                    <Body style={{ fontSize: 13, lineHeight: 19 }}>{turn.reasoning}</Body>
                  </View>
                ) : null}
              </GlassCard>

              {turn.propertyIds?.map((pid) => {
                const p = MOCK_PROPERTIES.find((x) => x.id === pid);
                return p ? (
                  <PropertyCard key={pid} property={p} onPress={() => openProperty(p)} />
                ) : null;
              })}

              {turn.suggestedAction && turn.suggestedAction.kind !== 'none' ? (
                <Pressable
                  style={styles.actionButton}
                  onPress={() => runAction(turn.suggestedAction!)}
                >
                  <Label style={styles.actionLabel}>{turn.suggestedAction.label}</Label>
                </Pressable>
              ) : null}

              {turn.suggestions ? (
                <View style={styles.suggestions}>
                  {turn.suggestions.map((s) => (
                    <Pressable key={s} style={styles.suggestion} onPress={() => send(s)}>
                      <Caption style={{ color: color.inkMuted }}>{s}</Caption>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.dock, { bottom: insets.bottom + space.md }]}>
        <FloatingSearch
          prompts={['Find a home near my office', 'What can I afford in Lekki?', '3-bed under ₦150M']}
          onActivate={() => send('I want to buy a home')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  header: { paddingHorizontal: space.lg, paddingBottom: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.success },
  scroll: { padding: space.lg, gap: space.md },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: color.ink,
    borderRadius: radius.lg,
    borderBottomRightRadius: 6,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    maxWidth: '84%',
  },
  userText: { color: '#fff', fontFamily: fontFamily.regular },
  reasoning: {
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: color.glassBorder,
    gap: 4,
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, paddingHorizontal: space.xs },
  suggestion: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: color.surface,
  },
  actionButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: color.accent,
  },
  actionLabel: { color: color.canvas, letterSpacing: 0.5 },
  dock: { position: 'absolute', left: space.lg, right: space.lg },
});
