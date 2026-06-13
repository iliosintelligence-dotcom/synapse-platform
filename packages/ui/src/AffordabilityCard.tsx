/**
 * AffordabilityCard — generated from a PropertyCard or CommuteCard.
 * Monthly cost, mortgage scenarios, flex options, down payment guidance.
 * Chains into a deeper mortgage analysis via onExpandMortgage.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type PaymentScenario = { name: string; amount: string; note: string };

export type AffordabilityCardProps = {
  monthlyEstimate: string;
  scenarios?: PaymentScenario[];
  downPaymentGuidance?: string;
  onExpandMortgage?: () => void;
};

export default function AffordabilityCard({
  monthlyEstimate,
  scenarios = [],
  downPaymentGuidance,
  onExpandMortgage,
}: AffordabilityCardProps) {
  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        <View style={styles.iconWrap}>
          <Icon name="wallet" size="sm" color={color.accent} />
        </View>
        <View>
          <Text style={type.label}>Estimated monthly</Text>
          <Text style={styles.amount}>{monthlyEstimate}</Text>
        </View>
      </View>

      {scenarios.length > 0 && (
        <View style={styles.scenarios}>
          {scenarios.map((s) => (
            <View key={s.name} style={styles.scenario}>
              <View style={{ flex: 1 }}>
                <Text style={[type.title, { fontSize: 13.5 }]}>{s.name}</Text>
                <Text style={type.caption}>{s.note}</Text>
              </View>
              <Text style={styles.scenarioAmount}>{s.amount}</Text>
            </View>
          ))}
        </View>
      )}

      {downPaymentGuidance && (
        <View style={styles.guidance}>
          <Icon name="sparkles" size="xs" color={color.accent} />
          <Text style={[type.body, { flex: 1, fontSize: 13, lineHeight: 19 }]}>{downPaymentGuidance}</Text>
        </View>
      )}

      {onExpandMortgage && (
        <Pressable style={styles.expand} onPress={onExpandMortgage}>
          <Text style={styles.expandText}>Full mortgage analysis</Text>
          <Icon name="chevron.right" size="xs" color={color.accent} />
        </Pressable>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amount: { fontFamily: fontFamily.display, fontSize: 26, letterSpacing: 1.2, color: color.accent },
  scenarios: { marginTop: space.lg, gap: 0 },
  scenario: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: color.glassBorder,
  },
  scenarioAmount: { fontFamily: fontFamily.display, fontSize: 18, letterSpacing: 0.8, color: color.ink },
  guidance: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: color.accentSoft,
    borderRadius: radius.sm,
    padding: space.md,
    marginTop: space.md,
  },
  expand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: space.lg,
    paddingVertical: space.sm,
  },
  expandText: { fontFamily: fontFamily.semibold, fontSize: 13, color: color.accent },
});
