/**
 * Mock props — every primitive is independently renderable with these,
 * Storybook-style. No API calls anywhere in the library.
 */
import type { PropertyData } from './PropertyCard';
import type { VerificationNode } from './TrustScoreBadge';
import type { ComparisonDimension } from './PropertyComparisonCard';
import type { TravelOption } from './CommuteCard';
import type { PaymentScenario } from './AffordabilityCard';
import type { TimeSlot } from './ViewingCard';
import type { NeighbourhoodCategory } from './NeighbourhoodCard';
import type { MapPin } from './MapCard';
import type { EscrowCardData } from './EscrowCard';
import type { CommissionLedgerCardData } from './CommissionLedgerCard';
import type { RepaymentScheduleCardData } from './RepaymentScheduleCard';
import type { FinancialIdentityCardData } from './FinancialIdentityCard';
import type { WalletCardData } from './WalletCard';

export const mockNodes: VerificationNode[] = [
  { name: 'Title', status: 'pass' },
  { name: 'Survey', status: 'pass' },
  { name: 'Structure', status: 'pass' },
  { name: 'Flood', status: 'pass' },
  { name: 'Legal', status: 'pass' },
  { name: 'Area Intel', status: 'pass' },
  { name: 'Financial', status: 'pending' },
];

export const mockProperty: PropertyData = {
  id: 'p1',
  title: '3-Bed Apartment, Lekki Phase 1',
  location: 'Lekki Phase 1, Lagos',
  price: '₦165M',
  image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=900&q=80',
  trustScore: 94,
  verified: true,
  nodes: mockNodes,
  aiSummary:
    '87% match — your commute from here to Lagos Island is 14 minutes shorter than comparable listings in this price range.',
};

export const mockPropertyB: PropertyData = {
  id: 'p2',
  title: '3-Bed Terrace, Ikate',
  location: 'Ikate, Lekki, Lagos',
  price: '₦148M',
  image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=900&q=80',
  trustScore: 91,
  verified: true,
  nodes: mockNodes,
};

export const mockComparison: ComparisonDimension[] = [
  { key: 'price', label: 'Price', a: '₦165M', b: '₦148M', winner: 'b' },
  { key: 'commute', label: 'Commute', a: '32 min', b: '46 min', winner: 'a' },
  { key: 'investment', label: '5-yr growth', a: '+38%', b: '+52%', winner: 'b' },
  { key: 'trust', label: 'Trust score', a: '94', b: '91', winner: 'a' },
];

export const mockTravelOptions: TravelOption[] = [
  { mode: 'Drive', icon: 'car', time: '32 min' },
  { mode: 'Off-peak', icon: 'clock', time: '21 min' },
  { mode: 'BRT', icon: 'pin', time: '55 min' },
];

export const mockScenarios: PaymentScenario[] = [
  { name: 'Outright', amount: '₦165M', note: 'Escrow-protected single payment' },
  { name: 'Annual', amount: '₦165M/yr', note: 'Standard annual commitment' },
  { name: 'Installment', amount: '₦13.8M/mo', note: '12-month structured tranches' },
];

export const mockSlots: TimeSlot[] = [
  { id: 's1', day: 'Sat', time: '10:00' },
  { id: 's2', day: 'Sat', time: '14:00' },
  { id: 's3', day: 'Sun', time: '11:00' },
  { id: 's4', day: 'Mon', time: '09:00' },
];

export const mockNeighbourhood: NeighbourhoodCategory[] = [
  { key: 'schools', label: 'Schools', icon: 'people', summary: '4 international schools within 3km' },
  { key: 'health', label: 'Hospitals', icon: 'shield', summary: '2 accredited hospitals within 10 min' },
  { key: 'food', label: 'Restaurants', icon: 'sparkles', summary: '28 rated spots — strong brunch culture' },
];

export const mockPins: MapPin[] = [
  { id: 'p1', price: '₦165M', x: 0.28, y: 0.32 },
  { id: 'p2', price: '₦148M', x: 0.58, y: 0.52 },
  { id: 'p3', price: '₦178M', x: 0.78, y: 0.24 },
];

export const mockImages = [
  'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80',
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80',
  'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200&q=80',
];

/* ───────── Layer 6 — financial infrastructure ───────── */

export const mockEscrow: EscrowCardData = {
  amountLabel: '₦12,500,000',
  status: 'held',
  partnerName: 'Sterling MFB',
  typeLabel: 'Purchase escrow',
  milestones: [
    { id: 'm1', name: 'Documents verified', status: 'approved', releaseLabel: '10%' },
    { id: 'm2', name: 'Survey & title check passed', status: 'approved', releaseLabel: '20%' },
    { id: 'm3', name: 'Possession handover confirmed', status: 'pending', releaseLabel: '70%' },
  ],
};

export const mockCommission: CommissionLedgerCardData = {
  dealLabel: '3-Bed · Lekki Phase 1',
  agentName: 'Bola Adeyemi',
  transactionValueLabel: '₦165M',
  grossLabel: '₦4,950,000',
  netPayoutLabel: '₦2,970,000',
  splitLabel: 'Agent 60% · Team lead 10% · Agency 30%',
  status: 'approved',
  paidLabel: null,
};

export const mockRepayment: RepaymentScheduleCardData = {
  title: 'Rent — 2-Bed, Yaba',
  paidCount: 4,
  totalCount: 12,
  nextDueLabel: '12 Jul',
  rows: [
    { id: 'r1', label: 'Installment 4 · 12 Jun', amountLabel: '₦220,000', status: 'paid' },
    { id: 'r2', label: 'Installment 5 · 12 Jul', amountLabel: '₦220,000', status: 'upcoming' },
    { id: 'r3', label: 'Installment 6 · 12 Aug', amountLabel: '₦220,000', status: 'upcoming' },
  ],
};

export const mockFinancialIdentity: FinancialIdentityCardData = {
  overallScore: 78,
  components: [
    { label: 'Payment reliability', value: 82 },
    { label: 'Verification completeness', value: 90 },
    { label: 'Transaction history', value: 64 },
  ],
  rentalHistoryVerified: true,
  improveHint: 'Complete one more on-time rent cycle to push your reliability score past 85.',
};

export const mockWallet: WalletCardData = {
  purposeLabel: 'Rent savings',
  balanceLabel: '₦640,000',
  partnerName: 'Sterling MFB',
  status: 'active',
  goal: { label: 'Annual rent target', targetLabel: '₦640k / ₦1.2M', progressPct: 53 },
};
