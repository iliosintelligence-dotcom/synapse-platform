/**
 * ViewingManagementCard — the agency-side viewing: property image, consumer
 * name, scheduled time, agent, status badge, and an inline outcome-capture
 * form revealed on completion. (Distinct from the Layer-1 consumer-facing
 * ViewingCard, which schedules slots.)
 *
 * The post-viewing fields are the AI signal layer for future lead scoring.
 */
import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Tag from './Tag';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type ViewingStatusKind =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type ViewingOutcomeKind = 'interested' | 'not_interested' | 'offer_pending' | 'offer_made';
export type BudgetFitKind = 'yes' | 'maybe' | 'no';

export type ViewingOutcomeForm = {
  interestLevel: number; // 1–5
  budgetFit: BudgetFitKind;
  likelihoodToProceed: number; // 1–10
  outcome: ViewingOutcomeKind;
  concerns?: string;
};

export type ViewingManagementCardData = {
  id: string;
  propertyTitle: string;
  propertyImage: string | null;
  consumerName: string;
  scheduledLabel: string;
  agentName: string | null;
  status: ViewingStatusKind;
};

export type ViewingManagementCardProps = {
  viewing: ViewingManagementCardData;
  onCapture?: (outcome: ViewingOutcomeForm) => void;
};

const STATUS_VARIANT = {
  scheduled: 'status',
  confirmed: 'status',
  completed: 'verified',
  cancelled: 'category',
  no_show: 'pending',
} as const;

const OUTCOMES: { key: ViewingOutcomeKind; label: string }[] = [
  { key: 'interested', label: 'Interested' },
  { key: 'offer_pending', label: 'Offer pending' },
  { key: 'offer_made', label: 'Offer made' },
  { key: 'not_interested', label: 'Not interested' },
];

export default function ViewingManagementCard({ viewing, onCapture }: ViewingManagementCardProps) {
  const [capturing, setCapturing] = useState(false);
  const [interest, setInterest] = useState(3);
  const [likelihood, setLikelihood] = useState(5);
  const [budgetFit, setBudgetFit] = useState<BudgetFitKind>('maybe');
  const [outcome, setOutcome] = useState<ViewingOutcomeKind>('interested');

  const canCapture = viewing.status === 'completed' || viewing.status === 'confirmed';

  return (
    <GlassCard depthLayer={2} padding={0}>
      <View style={styles.head}>
        {viewing.propertyImage ? (
          <Image source={{ uri: viewing.propertyImage }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]}>
            <Icon name="building" size="md" color={color.inkDim} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { fontSize: 14 }]} numberOfLines={1}>
            {viewing.propertyTitle}
          </Text>
          <Text style={type.caption}>{viewing.consumerName}</Text>
          <View style={styles.meta}>
            <Icon name="clock" size="xs" color={color.inkDim} />
            <Text style={type.caption}>{viewing.scheduledLabel}</Text>
          </View>
        </View>
        <Tag label={viewing.status.replace('_', ' ')} variant={STATUS_VARIANT[viewing.status]} />
      </View>

      {canCapture && !capturing && (
        <Pressable style={styles.captureBtn} onPress={() => setCapturing(true)}>
          <Icon name="sparkles" size="xs" color={color.accent} />
          <Text style={styles.captureBtnText}>Capture outcome</Text>
        </Pressable>
      )}

      {capturing && (
        <View style={styles.form}>
          <Scale label="Interest level" value={interest} max={5} onChange={setInterest} />
          <Scale label="Likelihood to proceed" value={likelihood} max={10} onChange={setLikelihood} />

          <Text style={styles.fieldLabel}>Budget fit</Text>
          <View style={styles.choices}>
            {(['yes', 'maybe', 'no'] as BudgetFitKind[]).map((b) => (
              <Choice key={b} label={b} active={budgetFit === b} onPress={() => setBudgetFit(b)} />
            ))}
          </View>

          <Text style={styles.fieldLabel}>Outcome</Text>
          <View style={styles.choices}>
            {OUTCOMES.map((o) => (
              <Choice
                key={o.key}
                label={o.label}
                active={outcome === o.key}
                onPress={() => setOutcome(o.key)}
              />
            ))}
          </View>

          <Pressable
            style={styles.save}
            onPress={() =>
              onCapture?.({
                interestLevel: interest,
                budgetFit,
                likelihoodToProceed: likelihood,
                outcome,
              })
            }
          >
            <Text style={styles.saveText}>Save outcome</Text>
          </Pressable>
        </View>
      )}
    </GlassCard>
  );
}

function Scale({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <View style={styles.scale}>
      <View style={styles.scaleHead}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.scaleValue}>
          {value}/{max}
        </Text>
      </View>
      <View style={styles.scaleTrack}>
        {Array.from({ length: max }).map((_, i) => (
          <Pressable
            key={i}
            style={[styles.scaleDot, i < value && styles.scaleDotOn]}
            onPress={() => onChange(i + 1)}
          />
        ))}
      </View>
    </View>
  );
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.choice, active && styles.choiceOn]} onPress={onPress}>
      <Text style={[styles.choiceText, active && { color: color.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.md },
  thumb: { width: 56, height: 56, borderRadius: radius.sm },
  thumbFallback: { backgroundColor: 'rgba(22,24,28,0.04)', alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  captureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: space.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: color.glassBorder,
  },
  captureBtnText: { fontFamily: fontFamily.semibold, fontSize: 13, color: color.accent },
  form: {
    padding: space.md,
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: color.glassBorder,
  },
  fieldLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: color.inkMuted,
  },
  scale: { gap: 6 },
  scaleHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scaleValue: { fontFamily: fontFamily.semibold, fontSize: 12, color: color.accent },
  scaleTrack: { flexDirection: 'row', gap: 5 },
  scaleDot: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(22,24,28,0.08)' },
  scaleDotOn: { backgroundColor: color.accent },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  choice: {
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22,24,28,0.04)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  choiceOn: { backgroundColor: color.accentSoft, borderColor: color.accentBorder },
  choiceText: { fontFamily: fontFamily.medium, fontSize: 12.5, color: color.inkMuted, textTransform: 'capitalize' },
  save: {
    backgroundColor: color.accent,
    borderRadius: radius.pill,
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.xs,
  },
  saveText: { fontFamily: fontFamily.semibold, fontSize: 13.5, color: color.surface },
});
