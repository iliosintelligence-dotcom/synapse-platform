/**
 * PropertyBadge — trust score ring + verification node chips + verified
 * badge in one composed primitive. Consumer surfaces: passed/pending only.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import TrustScoreBadge, { type VerificationNode as RingNode } from './TrustScoreBadge';
import VerificationBadge from './VerificationBadge';
import { space } from './tokens';
import {
  VerificationNodeStatus,
  type VerificationNode,
} from '@synapse/types';

export type PropertyBadgeProps = {
  trustScore: number;
  nodes?: VerificationNode[];
  verified?: boolean;
  ringSize?: number;
};

/** Map entity nodes → ring chips. FAILED is never rendered to consumers. */
function toRingNodes(nodes: VerificationNode[]): RingNode[] {
  return nodes
    .filter((n) => n.status !== VerificationNodeStatus.FAILED)
    .map((n) => ({
      name: n.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      status: n.status === VerificationNodeStatus.PASSED ? 'pass' : 'pending',
    }));
}

export default function PropertyBadge({
  trustScore,
  nodes = [],
  verified = false,
  ringSize = 60,
}: PropertyBadgeProps) {
  return (
    <View style={styles.wrap}>
      {verified && <VerificationBadge label="Verified" />}
      <TrustScoreBadge score={trustScore} size={ringSize} nodes={toRingNodes(nodes)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, alignItems: 'flex-start' },
});
