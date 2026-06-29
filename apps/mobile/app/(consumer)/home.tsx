/**
 * Toju Conversation — the consumer home and the front door of Synapse.
 *
 * Hero-first: opens on a centered FloatingSearch capsule + a short Toju intro
 * (the signature entry), which fades into the conversation the moment the
 * consumer taps the capsule, taps a starter, or types. From there Toju asks
 * progressive questions and recommends a short set of verified listings (last
 * 14 days), chaining PropertyCards inline. (Defining screen 1/3.)
 *
 * Functionality: wired to the live toju-chat Edge Function via
 * `toju.sendTojuMessage` (returns property UUIDs → fetched and mapped to cards).
 * A persistent composer drives the conversation; `suggestedAction` renders as
 * its own affordance, never folded into the prose (Layer 9 "half-open door").
 *
 * Set USE_MOCK = true to drive the screen from src/mock without a backend.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Animated, { FadeIn, FadeOut, FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PropertyCard,
  TypingIndicator,
  FloatingSearch,
  GlassCard,
  Icon,
  Display,
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
import { toju, properties } from '@synapse/api';
import type { PropertyWithMedia, TojuSuggestedAction } from '@synapse/types';
import { mockToju } from '../../src/mock';

/** Flip to true to exercise the screen without a live backend. */
const USE_MOCK = false;

const STARTERS = ['I want to buy a home', "I'm looking to invest", '3-bed in Lekki under ₦180M'];

type TojuEntry = {
  kind: 'toju';
  message: string;
  reasoning?: string;
  properties: PropertyData[];
  suggestedAction?: TojuSuggestedAction | null;
  suggestions?: string[];
};

type Entry =
  | { kind: 'user'; text: string }
  | TojuEntry
  | { kind: 'typing' }
  | { kind: 'error'; text: string; retryText: string };

const GREETING: TojuEntry = {
  kind: 'toju',
  message:
    "I'm Toju — your property consultant. Tell me what you're looking for and I'll do the rest. No forms, no endless scrolling.",
  properties: [],
};

type UiNode = { name: string; status: 'pass' | 'pending' };

/** Coerce stored verification nodes to the consumer card shape, tolerating both
 *  the DB `{ key, status }` form and the seeded `{ name, status }` form. */
function toUiNodes(raw: unknown): UiNode[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((n): UiNode => {
      const o = (n ?? {}) as Record<string, unknown>;
      const name =
        typeof o.name === 'string'
          ? o.name
          : typeof o.key === 'string'
            ? o.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
            : '';
      const status = o.status === 'pass' || o.status === 'verified' ? 'pass' : 'pending';
      return { name, status };
    })
    .filter((n) => n.name);
}

/** Map a live property row to the card shape the UI renders. */
function toCard(p: PropertyWithMedia): PropertyData {
  const ai = (p as { ai_analysis?: { summary?: string } | null }).ai_analysis;
  return {
    id: p.id,
    title: p.title,
    location: [p.city, p.state].filter(Boolean).join(', '),
    price: formatPrice(p.price, p.price_period),
    image: p.media?.[0]?.url ?? 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=900&q=80',
    trustScore: p.trust_score ?? 0,
    verified: p.verification_status === 'verified',
    nodes: toUiNodes(p.verification_nodes),
    aiSummary: ai?.summary ?? undefined,
  };
}

function formatPrice(n: number, period?: string): string {
  const naira =
    n >= 1_000_000 ? `₦${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : `₦${n.toLocaleString()}`;
  const suffix =
    period === 'per_year' ? '/yr' : period === 'per_month' ? '/mo' : period === 'per_night' ? '/night' : '';
  return naira + suffix;
}

export default function TojuConversation() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const [active, setActive] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const sessionId = useRef<string | undefined>(undefined);
  const mockTurn = useRef(0);

  const scrollDown = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

  // Resume the consumer's existing Toju session id (server appends to it).
  useEffect(() => {
    if (USE_MOCK) return;
    toju
      .getCurrentSession()
      .then((s) => {
        if (s?.id) sessionId.current = s.id;
      })
      .catch(() => {
        /* not signed in yet / offline — a fresh session is created on first send */
      });
  }, []);

  // Enter the conversation (hero → chat), optionally focusing the composer.
  const enter = (focus: boolean) => {
    setActive(true);
    if (focus) setTimeout(() => inputRef.current?.focus(), 120);
  };

  async function resolveCards(ids: string[]): Promise<PropertyData[]> {
    if (ids.length === 0) return [];
    const rows = await Promise.all(ids.map((id) => properties.getProperty(id).catch(() => null)));
    return rows.filter((r): r is PropertyWithMedia => r !== null).map(toCard);
  }

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (!active) setActive(true);
    setInput('');
    setSending(true);
    setEntries((e) => [...e.filter((x) => x.kind !== 'error'), { kind: 'user', text: trimmed }, { kind: 'typing' }]);
    scrollDown();

    try {
      let next: TojuEntry;
      if (USE_MOCK) {
        await new Promise((r) => setTimeout(r, 900));
        const turn = mockToju(trimmed, mockTurn.current++);
        next = {
          kind: 'toju',
          message: turn.message,
          reasoning: turn.reasoning,
          properties: [],
          suggestedAction: turn.suggestedAction,
          suggestions: turn.suggestions,
        };
      } else {
        const res = await toju.sendTojuMessage(trimmed, sessionId.current);
        sessionId.current = res.session_id;
        next = {
          kind: 'toju',
          message: res.message,
          properties: await resolveCards(res.property_ids ?? []),
          suggestedAction: res.suggestedAction ?? null,
        };
      }
      setEntries((e) => [...e.filter((x) => x.kind !== 'typing'), next]);
    } catch {
      setEntries((e) => [
        ...e.filter((x) => x.kind !== 'typing'),
        { kind: 'error', text: "I couldn't reach the network just now. Tap to try again.", retryText: trimmed },
      ]);
    } finally {
      setSending(false);
      scrollDown();
    }
  };

  const openProperty = (id: string) => router.push(`/property/${id}`);
  const runAction = (a: TojuSuggestedAction) => {
    if (a.kind !== 'none' && a.property_id) openProperty(a.property_id);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ───────── Hero (resting state) ───────── */}
      {!active ? (
        <Animated.View
          exiting={FadeOut.duration(220)}
          style={[styles.hero, { paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}
        >
          <Animated.View entering={FadeInDown.duration(420)} style={styles.heroInner}>
            <Label style={{ letterSpacing: 4, color: color.inkDim }}>SYNAPSE</Label>
            <View style={styles.heroTitleRow}>
              <Display style={styles.heroTitle}>TOJU</Display>
              <View style={styles.statusDot} />
            </View>
            <Body style={styles.heroIntro}>
              Your property consultant. Tell me what you're looking for — I'll find verified homes that
              fit. No forms, no endless scrolling.
            </Body>

            <View style={styles.heroSearch}>
              <FloatingSearch
                prompts={['Find a home near my office', 'What can I afford in Lekki?', '3-bed under ₦150M']}
                onActivate={() => enter(true)}
                onVoice={() => enter(true)}
              />
            </View>

            <View style={styles.heroChips}>
              {STARTERS.map((s) => (
                <Pressable key={s} style={styles.suggestion} onPress={() => send(s)}>
                  <Caption style={{ color: color.inkMuted }}>{s}</Caption>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        </Animated.View>
      ) : (
        /* ───────── Conversation ───────── */
        <Animated.View entering={FadeIn.duration(260)} style={{ flex: 1 }}>
          <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
            <Label style={{ letterSpacing: 3, color: color.inkDim }}>SYNAPSE</Label>
            <View style={styles.headerRow}>
              <Title style={{ fontSize: 26, letterSpacing: 1 }}>Toju</Title>
              <View style={styles.statusDot} />
              <Caption>Online · your consultant</Caption>
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
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
              if (entry.kind === 'error') {
                return (
                  <Pressable key={i} style={styles.errorCard} onPress={() => send(entry.retryText)}>
                    <Icon name="arrow.up" size="xs" color={color.warning} />
                    <Body style={{ flex: 1, fontSize: 13.5, color: color.inkDim }}>{entry.text}</Body>
                  </Pressable>
                );
              }

              return (
                <View key={i} style={{ gap: space.sm }}>
                  <GlassCard depthLayer={2} edgeGlow>
                    <Body>{entry.message}</Body>
                    {entry.reasoning ? (
                      <View style={styles.reasoning}>
                        <Caption style={{ color: color.accent }}>WHY</Caption>
                        <Body style={{ fontSize: 13, lineHeight: 19 }}>{entry.reasoning}</Body>
                      </View>
                    ) : null}
                  </GlassCard>

                  {entry.properties.length > 0 ? (
                    <View style={styles.matches}>
                      <View style={styles.matchesHeader}>
                        <Icon name="sparkles" size="xs" color={color.accent} />
                        <Label style={styles.matchesLabel}>VERIFIED MATCHES</Label>
                        <View style={styles.matchesCount}>
                          <Caption style={styles.matchesCountText}>{entry.properties.length}</Caption>
                        </View>
                      </View>
                      {entry.properties.map((p) => (
                        <PropertyCard key={p.id} property={p} onPress={() => openProperty(p.id)} />
                      ))}
                    </View>
                  ) : null}

                  {entry.suggestedAction && entry.suggestedAction.kind !== 'none' ? (
                    <Pressable style={styles.actionButton} onPress={() => runAction(entry.suggestedAction!)}>
                      <Label style={styles.actionLabel}>{entry.suggestedAction.label}</Label>
                    </Pressable>
                  ) : null}

                  {entry.suggestions ? (
                    <View style={styles.suggestions}>
                      {entry.suggestions.map((s) => (
                        <Pressable key={s} style={styles.suggestion} onPress={() => send(s)} disabled={sending}>
                          <Caption style={{ color: color.inkMuted }}>{s}</Caption>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          {/* Persistent composer */}
          <View style={[styles.composer, { paddingBottom: insets.bottom + space.sm }]}>
            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="Tell Toju what you're looking for…"
                placeholderTextColor={color.inkDim}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={() => send(input)}
                returnKeyType="send"
                multiline
                editable={!sending}
              />
              <Pressable
                style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
                onPress={() => send(input)}
                disabled={!input.trim() || sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={color.onAccent} />
                ) : (
                  <Icon name="arrow.up" size="sm" color={color.onAccent} weight={2.4} />
                )}
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },

  // hero
  hero: { flex: 1, paddingHorizontal: space.lg, justifyContent: 'center' },
  heroInner: { gap: space.md },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  heroTitle: { fontSize: 64, letterSpacing: 2, color: color.ink },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.success },
  heroIntro: { fontSize: 16, lineHeight: 24, color: color.inkMuted, maxWidth: 360 },
  heroSearch: { marginTop: space.md },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },

  // conversation
  header: { paddingHorizontal: space.lg, paddingBottom: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: space.xl },
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
  matches: { gap: space.sm },
  matchesHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.xs, marginTop: 2 },
  matchesLabel: { letterSpacing: 1.5, color: color.accent, fontSize: 11 },
  matchesCount: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchesCountText: { color: color.accent, fontSize: 11, fontFamily: fontFamily.semibold },
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
  actionLabel: { color: color.onAccent, letterSpacing: 0.5 },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: color.surface,
  },
  composer: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    backgroundColor: color.canvas,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: color.glassBorder,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: space.md,
    paddingTop: space.sm + 2,
    paddingBottom: space.sm + 2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: color.surface,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    color: color.ink,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
});
