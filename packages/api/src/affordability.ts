/**
 * api/affordability — System 4. Advisory only — never a credit decision.
 * The analysis is computed against conservative benchmarks and stored; Toju
 * surfaces it in recommendation reasoning. The reasoning text always discloses
 * the basis and that it is not a financing approval.
 */
import { getDb } from '@synapse/database';
import {
  AFFORDABILITY,
  FinancingRecommendation,
  type AffordabilityAnalysis,
  type AffordabilityRequest,
} from '@synapse/types';

/**
 * Compute (and persist) an affordability analysis. Pure, conservative math —
 * safe to run client-side because it makes no credit decision. The result is
 * informational; actual financing approval belongs only to Systems 2/3.
 */
export async function analyseAffordability(
  input: AffordabilityRequest & { property_monthly_cost?: number; property_price?: number },
): Promise<AffordabilityAnalysis> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const net = input.monthly_income - input.monthly_expenses;
  const debt = input.existing_debt ?? 0;
  const safe = Math.max(0, Math.round(net * AFFORDABILITY.rent_to_income_ceiling));
  const stretch = Math.max(0, Math.round(net * AFFORDABILITY.debt_to_income_ceiling - debt));
  // a rough max price assumes ~25-year horizon on the safe monthly budget
  const recommendedMax = Math.round(safe * 12 * 25);

  let rec: FinancingRecommendation;
  const cost = input.property_monthly_cost ?? null;
  if (cost === null) rec = FinancingRecommendation.NOT_RECOMMENDED;
  else if (cost <= safe) rec = FinancingRecommendation.CASH;
  else if (cost <= stretch) rec = FinancingRecommendation.RENT_NOW_PAY_MONTHLY;
  else if (cost <= stretch * 1.5) rec = FinancingRecommendation.MORTGAGE_MARKETPLACE;
  else rec = FinancingRecommendation.NOT_RECOMMENDED;

  const reasoning =
    `Based on what you've told me, a safe monthly budget is about ₦${safe.toLocaleString('en-NG')} — ` +
    `roughly ${Math.round(AFFORDABILITY.rent_to_income_ceiling * 100)}% of your stated net income. ` +
    (cost !== null
      ? `This property's monthly cost is ₦${cost.toLocaleString('en-NG')}. `
      : '') +
    `This is an estimate from the figures you provided — not a credit approval or pre-qualification.`;

  const { data, error } = await db
    .from('affordability_analyses')
    .insert({
      user_id: auth.user.id,
      property_id: input.property_id ?? null,
      declared_monthly_income: input.monthly_income,
      declared_monthly_expenses: input.monthly_expenses,
      declared_existing_debt: debt,
      safe_monthly_budget: safe,
      stretch_monthly_budget: stretch,
      recommended_max_property_price: recommendedMax,
      financing_recommendation: rec,
      recommendation_reasoning: reasoning,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as AffordabilityAnalysis;
}

export async function listMyAffordability(): Promise<AffordabilityAnalysis[]> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await db
    .from('affordability_analyses')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('calculated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AffordabilityAnalysis[];
}
