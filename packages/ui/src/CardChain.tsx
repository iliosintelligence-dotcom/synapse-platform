/**
 * CardChain — the chaining logic. An ordered sequence of cards where each
 * card contextually generates the next, driven by Toju — not page flows.
 *
 * Every card kind declares what it can generate (CHAIN_GRAPH). The component
 * animates: a new card slides up beneath the current one, pushing earlier
 * cards into a stacked state. Swipe down on the top card to navigate back.
 */
import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  SlideInDown,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { motion, space } from './tokens';

/* ───────────── chain graph ───────────── */

export type CardKind =
  | 'property'
  | 'insight'
  | 'conversation'
  | 'comparison'
  | 'commute'
  | 'affordability'
  | 'mortgage'
  | 'agent'
  | 'viewing'
  | 'neighbourhood'
  | 'map'
  | 'proximity';

/** Which cards each kind can contextually generate. */
export const CHAIN_GRAPH: Record<CardKind, CardKind[]> = {
  property: ['insight', 'comparison', 'commute', 'neighbourhood', 'agent', 'viewing'],
  insight: ['commute', 'comparison', 'affordability', 'conversation'],
  conversation: ['property', 'insight', 'comparison', 'map'],
  comparison: ['insight', 'affordability', 'commute'],
  commute: ['affordability', 'map'],
  affordability: ['mortgage', 'viewing'],
  mortgage: ['viewing'],
  agent: ['viewing'],
  viewing: [],
  neighbourhood: ['map', 'commute'],
  map: ['property', 'commute'],
  proximity: ['property'],
};

export function canGenerate(from: CardKind, to: CardKind): boolean {
  return CHAIN_GRAPH[from].includes(to);
}

/* ───────────── chain state ───────────── */

export type ChainEntry = {
  id: string;
  kind: CardKind;
  /** Render the card for this entry */
  render: () => React.ReactNode;
};

export function useCardChain(initial: ChainEntry[] = []) {
  const [chain, setChain] = useState<ChainEntry[]>(initial);

  const push = useCallback((entry: ChainEntry) => {
    setChain((c) => {
      const tail = c[c.length - 1];
      if (tail && !canGenerate(tail.kind, entry.kind)) {
        console.warn(`CardChain: ${tail.kind} does not declare ${entry.kind} as generable`);
      }
      return [...c, entry];
    });
  }, []);

  const pop = useCallback(() => {
    setChain((c) => (c.length > 1 ? c.slice(0, -1) : c));
  }, []);

  const reset = useCallback((entries: ChainEntry[]) => setChain(entries), []);

  return { chain, push, pop, reset };
}

/* ───────────── chain renderer ───────────── */

export type CardChainViewProps = {
  chain: ChainEntry[];
  onPop: () => void;
  /** How many stacked (earlier) cards remain partially visible */
  visibleStack?: number;
};

export default function CardChainView({ chain, onPop, visibleStack = 2 }: CardChainViewProps) {
  const top = chain[chain.length - 1];
  const stacked = chain.slice(Math.max(0, chain.length - 1 - visibleStack), chain.length - 1);

  const swipeBack = Gesture.Pan()
    .activeOffsetY(24)
    .onEnd((e) => {
      if (e.translationY > 70) runOnJS(onPop)();
    });

  if (!top) return null;

  return (
    <View style={styles.wrap}>
      {/* Earlier cards — pushed into a stacked, receded state */}
      {stacked.map((entry, i) => {
        const depthFromTop = stacked.length - i;
        return (
          <Animated.View
            key={entry.id}
            layout={LinearTransition.duration(motion.expanded)}
            style={[
              styles.stacked,
              {
                transform: [{ scale: 1 - depthFromTop * 0.035 }],
                opacity: 1 - depthFromTop * 0.28,
                marginBottom: -space.section,
              },
            ]}
            pointerEvents="none"
          >
            {entry.render()}
          </Animated.View>
        );
      })}

      {/* Active card — slides up beneath, swipe down to go back */}
      <GestureDetector gesture={swipeBack}>
        <Animated.View
          key={top.id}
          entering={SlideInDown.duration(motion.expanded).springify().damping(24).stiffness(220)}
          exiting={FadeOut.duration(motion.standard)}
          layout={LinearTransition.duration(motion.expanded)}
        >
          {top.render()}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  stacked: {},
});
