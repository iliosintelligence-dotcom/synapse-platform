/**
 * Toju Conversation — the consumer home and the front door of Synapse.
 *
 * Liquid-glass theme: the conversation sits on a warm interior photo, with
 * frosted-glass bubbles (expo-blur) and the Synapse terracotta palette intact —
 * terracotta user bubbles + send, warm near-white text on glass over the photo.
 *
 * Hero-first: opens on a centered FloatingSearch capsule + a short Toju intro
 * that fades into the conversation on first send. Wired to the live toju-chat
 * Edge Function (returns property UUIDs → fetched and mapped to cards). The
 * composer drives the conversation; `suggestedAction` renders as its own
 * affordance (Layer 9 "half-open door"). USE_MOCK drives it without a backend.
 *
 * Background photo: swap the remote stand-in for a bundled asset — save your
 * image to apps/mobile/assets/toju-bg.jpg and set
 *   const TOJU_BG = require('../../assets/toju-bg.jpg');
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
  ImageBackground,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, FadeOut, FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PropertyCard,
  FloatingSearch,
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

/** Warm-interior backdrop. Stand-in remote image; replace with a bundled asset:
 *  const TOJU_BG = require('../../assets/toju-bg.jpg'); */
const TOJU_BG = { uri: 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=1200&q=80' };

const STARTERS = ['I want to buy a home', "I'm looking to invest", '3-bed in Lekki under ₦180M'];

/* warm palette for text/glass over the dark photo (accent stays terracotta) */
const ON_GLASS = '#FBEFE7';
const ON_GLASS_DIM = 'rgba(251,239,231,0.62)';
const GLASS_BORDER = 'rgba(255,255,255,0.26)';

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
    "Good afternoon. I'm Toju — your consultant at Synapse. Tell me what you're looking for and I'll find verified homes that fit. No forms, no endless scrolling.",
  properties: [],
};

/* ───────── glass primitive (frosted over the photo) ───────── */
function Glass({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.glassWrap, style]}>
      <BlurView intensity={36} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.glassSheen} pointerEvents="none" />
      {children}
    </View>
  );
}

function TojuAvatar() {
  return (
    <View style={styles.avToju}>
      <Icon name="sparkles" size="xs" color={color.onAccent} />
    </View>
  );
}

type UiNode = { name: string; status: 'pass' | 'pending' };
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

  useEffect(() => {
    if (USE_MOCK) return;
    toju
      .getCurrentSession()
      .then((s) => {
        if (s?.id) sessionId.current = s.id;
      })
      .catch(() => {});
  }, []);

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
    <ImageBackground source={TOJU_BG} resizeMode="cover" style={styles.screen}>
      <View style={styles.scrim} pointerEvents="none" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {!active ? (
          /* ───────── Hero ───────── */
          <Animated.View
            exiting={FadeOut.duration(220)}
            style={[styles.hero, { paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}
          >
            <Animated.View entering={FadeInDown.duration(420)} style={styles.heroInner}>
              <Label style={{ letterSpacing: 4, color: ON_GLASS_DIM }}>SYNAPSE</Label>
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
                  <Pressable key={s} onPress={() => send(s)}>
                    <Glass style={styles.chip}>
                      <Caption style={{ color: ON_GLASS }}>{s}</Caption>
                    </Glass>
                  </Pressable>
                ))}
              </View>
            </Animated.View>
          </Animated.View>
        ) : (
          /* ───────── Conversation ───────── */
          <Animated.View entering={FadeIn.duration(260)} style={{ flex: 1 }}>
            <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
              <Label style={{ letterSpacing: 3, color: ON_GLASS_DIM }}>SYNAPSE</Label>
              <View style={styles.headerRow}>
                <Title style={{ fontSize: 26, letterSpacing: 1, color: ON_GLASS }}>Toju</Title>
                <View style={styles.statusDot} />
                <Caption style={{ color: ON_GLASS_DIM }}>Online · your consultant</Caption>
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
                    <View key={i} style={styles.userRow}>
                      <View style={styles.userBubble}>
                        <Body style={styles.userText}>{entry.text}</Body>
                      </View>
                      <View style={styles.avUser}>
                        <Icon name="person" size="xs" color={ON_GLASS} />
                      </View>
                    </View>
                  );
                }
                if (entry.kind === 'typing') {
                  return (
                    <View key={i} style={styles.tojuRow}>
                      <TojuAvatar />
                      <Glass style={styles.typingBubble}>
                        <View style={styles.dots}>
                          <View style={[styles.dot, { opacity: 1 }]} />
                          <View style={[styles.dot, { opacity: 0.6 }]} />
                          <View style={[styles.dot, { opacity: 0.3 }]} />
                        </View>
                        <Caption style={{ color: ON_GLASS_DIM, fontStyle: 'italic' }}>
                          checking verified listings…
                        </Caption>
                      </Glass>
                    </View>
                  );
                }
                if (entry.kind === 'error') {
                  return (
                    <Pressable key={i} style={styles.tojuRow} onPress={() => send(entry.retryText)}>
                      <TojuAvatar />
                      <Glass style={styles.bubble}>
                        <Body style={{ color: ON_GLASS, fontSize: 13.5 }}>{entry.text}</Body>
                      </Glass>
                    </Pressable>
                  );
                }

                return (
                  <View key={i} style={{ gap: space.sm }}>
                    <Label style={styles.tojuName}>Toju</Label>
                    <View style={styles.tojuRow}>
                      <TojuAvatar />
                      <Glass style={styles.bubble}>
                        <Body style={{ color: ON_GLASS, lineHeight: 21 }}>{entry.message}</Body>
                        {entry.reasoning ? (
                          <View style={styles.reasoning}>
                            <Caption style={{ color: color.accent, letterSpacing: 1 }}>WHY</Caption>
                            <Body style={{ fontSize: 13, lineHeight: 19, color: ON_GLASS }}>{entry.reasoning}</Body>
                          </View>
                        ) : null}
                      </Glass>
                    </View>

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
                          <Pressable key={s} onPress={() => send(s)} disabled={sending}>
                            <Glass style={styles.chip}>
                              <Caption style={{ color: ON_GLASS }}>{s}</Caption>
                            </Glass>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>

            {/* Frosted composer */}
            <View style={[styles.composerWrap, { paddingBottom: insets.bottom + space.sm }]}>
              <Glass style={styles.composer}>
                <TextInput
                  ref={inputRef}
                  style={styles.input}
                  placeholder="Tell Toju what you're looking for…"
                  placeholderTextColor={ON_GLASS_DIM}
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
              </Glass>
            </View>
          </Animated.View>
        )}
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#2c180f' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(28,16,10,0.42)' },

  glassWrap: { overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: GLASS_BORDER },
  glassSheen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.06)' },

  avToju: {
    width: 30, height: 30, borderRadius: 15, flexShrink: 0,
    backgroundColor: 'rgba(194,85,43,0.92)', alignItems: 'center', justifyContent: 'center',
  },
  avUser: {
    width: 30, height: 30, borderRadius: 15, flexShrink: 0,
    backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: GLASS_BORDER,
    alignItems: 'center', justifyContent: 'center',
  },

  // hero
  hero: { flex: 1, paddingHorizontal: space.lg, justifyContent: 'center' },
  heroInner: { gap: space.md },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  heroTitle: { fontSize: 64, letterSpacing: 2, color: ON_GLASS },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.success },
  heroIntro: { fontSize: 16, lineHeight: 24, color: 'rgba(251,239,231,0.82)', maxWidth: 360 },
  heroSearch: { marginTop: space.md },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },

  // conversation
  header: { paddingHorizontal: space.lg, paddingBottom: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  scroll: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },

  tojuName: { color: ON_GLASS_DIM, marginLeft: 40, marginBottom: -space.xs, fontSize: 12 },
  tojuRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  bubble: { flex: 1, padding: space.md, borderBottomLeftRadius: 7 },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomLeftRadius: 7 },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#E8A06A' },

  userRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', gap: space.sm },
  userBubble: {
    backgroundColor: 'rgba(194,85,43,0.88)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 22, borderBottomRightRadius: 7,
    paddingHorizontal: space.md, paddingVertical: space.sm + 2, maxWidth: '78%',
  },
  userText: { color: '#fff', fontFamily: fontFamily.regular, lineHeight: 20 },

  reasoning: {
    marginTop: space.sm, paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: GLASS_BORDER, gap: 4,
  },

  matches: { gap: space.sm, marginLeft: 40 },
  matchesHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  matchesLabel: { letterSpacing: 1.5, color: color.accent, fontSize: 11 },
  matchesCount: {
    minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9,
    backgroundColor: 'rgba(194,85,43,0.22)', alignItems: 'center', justifyContent: 'center',
  },
  matchesCountText: { color: '#F0B894', fontSize: 11, fontFamily: fontFamily.semibold },

  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginLeft: 40 },

  actionButton: {
    alignSelf: 'flex-start', marginLeft: 40,
    paddingHorizontal: space.md, paddingVertical: space.sm + 2,
    borderRadius: radius.pill, backgroundColor: color.accent,
  },
  actionLabel: { color: color.onAccent, letterSpacing: 0.5 },

  composerWrap: { paddingHorizontal: space.lg, paddingTop: space.sm },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, borderRadius: 28, paddingHorizontal: space.md, paddingVertical: space.xs + 2 },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120, paddingTop: space.sm, paddingBottom: space.sm,
    fontFamily: fontFamily.regular, fontSize: 15, color: ON_GLASS,
  },
  sendButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: color.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  sendButtonDisabled: { opacity: 0.45 },
});
