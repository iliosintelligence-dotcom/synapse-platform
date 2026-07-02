/**
 * @synapse/ui — the Synapse primitive design system.
 * Every screen in mobile (and RN-web surfaces) is assembled from these.
 */

// Tokens — single source of truth
export * from './tokens';

// Foundation
export { default as GlassCard } from './GlassCard';
export type { GlassCardProps } from './GlassCard';
export { default as Icon } from './Icon';
export type { IconName } from './Icon';
export * from './Typography';

// Core controls
export { default as Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export { default as Input } from './Input';
export type { InputProps } from './Input';
export { default as Tag } from './Tag';
export type { TagProps, TagVariant } from './Tag';
export { default as Avatar } from './Avatar';
export type { AvatarProps, AvatarSize } from './Avatar';

// Trust
export { default as TrustScoreBadge, ScoreRing } from './TrustScoreBadge';
export { default as VerificationBadge } from './VerificationBadge';
export { default as PropertyBadge } from './PropertyBadge';
export type { PropertyBadgeProps } from './PropertyBadge';

// Property
export { default as PropertyCard } from './PropertyCard';
export type { PropertyCardProps, PropertyCardState, PropertyData } from './PropertyCard';
export { default as PropertyComparisonCard } from './PropertyComparisonCard';
export type { PropertyComparisonCardProps, ComparisonDimension } from './PropertyComparisonCard';
export { default as PropertyImageViewer } from './PropertyImageViewer';
export type { PropertyImageViewerProps, ViewerControl } from './PropertyImageViewer';

// AI — InsightCard is the Layer-1 name for AIInsightCard
export { default as InsightCard, TojuAvatar } from './AIInsightCard';
export type { AIInsightCardProps as InsightCardProps } from './AIInsightCard';
export { default as AIConversationCard } from './AIConversationCard';
export type { AIConversationCardProps, ConversationAction } from './AIConversationCard';
export { default as TypingIndicator } from './TypingIndicator';
export { default as FloatingAIOrb } from './FloatingAIOrb';

// Generated information layers
export { default as CommuteCard } from './CommuteCard';
export type { CommuteCardProps, TravelOption } from './CommuteCard';
export { default as AffordabilityCard } from './AffordabilityCard';
export type { AffordabilityCardProps, PaymentScenario } from './AffordabilityCard';
export { default as NeighbourhoodCard } from './NeighbourhoodCard';
export type { NeighbourhoodCardProps, NeighbourhoodCategory } from './NeighbourhoodCard';
export { default as MapCard } from './MapCard';
export type { MapCardProps, MapPin } from './MapCard';

// People + workflows
export { default as AgentCard } from './AgentCard';
export type { AgentCardProps } from './AgentCard';
export { default as ViewingCard } from './ViewingCard';
export type { ViewingCardProps, TimeSlot } from './ViewingCard';
export { default as ProximityAlertCard } from './ProximityAlertCard';

// Navigation + input
export { default as FloatingSearch } from './FloatingSearch';
export type { FloatingSearchProps } from './FloatingSearch';
export { default as BottomSheet } from './BottomSheet';
export type { BottomSheetProps, SheetSize } from './BottomSheet';
export { default as VisionDock } from './VisionDock';
export type { VisionDockProps, VisionDockMode } from './VisionDock';

// Card chaining
export { default as CardChainView, useCardChain, canGenerate, CHAIN_GRAPH } from './CardChain';
export type { CardKind, ChainEntry, CardChainViewProps } from './CardChain';

// ── Layer 2: transaction operating system ──
export { default as LeadCard } from './LeadCard';
export type { LeadCardProps, LeadCardData } from './LeadCard';
export { default as PipelineColumn } from './PipelineColumn';
export type { PipelineColumnProps } from './PipelineColumn';
export { default as PipelineBoard } from './PipelineBoard';
export type { PipelineBoardProps, PipelineStageGroup } from './PipelineBoard';
export { default as DealRoomCard } from './DealRoomCard';
export type { DealRoomCardProps, DealRoomCardData, DealRoomQuickAction } from './DealRoomCard';
export { default as TaskCard } from './TaskCard';
export type { TaskCardProps, TaskCardData } from './TaskCard';
export { default as TimelineCard } from './TimelineCard';
export type { TimelineCardProps, TimelineCardData } from './TimelineCard';
export { default as ActivityFeed } from './ActivityFeed';
export type { ActivityFeedProps, ActivityGroup } from './ActivityFeed';
export { default as NotificationCard } from './NotificationCard';
export type { NotificationCardProps, NotificationCardData, NotificationChannelKind } from './NotificationCard';
export { default as PerformanceCard } from './PerformanceCard';
export type { PerformanceCardProps, PerformanceCardData } from './PerformanceCard';
export { default as ViewingManagementCard } from './ViewingManagementCard';
export type {
  ViewingManagementCardProps,
  ViewingManagementCardData,
  ViewingOutcomeForm,
  ViewingStatusKind,
  ViewingOutcomeKind,
  BudgetFitKind,
} from './ViewingManagementCard';

// ── Layer 4: trust operating system ──
export { default as VerificationTierBadge } from './VerificationTierBadge';
export type { VerificationTierBadgeProps, TierKind } from './VerificationTierBadge';
export { default as TrustScoreRing } from './TrustScoreRing';
export type { TrustScoreRingProps } from './TrustScoreRing';
export { default as PropertyVerificationPanel } from './PropertyVerificationPanel';
export type { PropertyVerificationPanelProps, VerificationNodeView } from './PropertyVerificationPanel';
export { default as DocumentVaultCard } from './DocumentVaultCard';
export type { DocumentVaultCardProps, VaultCategory } from './DocumentVaultCard';
export { default as DisputeCard } from './DisputeCard';
export type { DisputeCardProps, DisputeCardData, DisputeCardAction } from './DisputeCard';
export { default as FraudFlagCard } from './FraudFlagCard';
export type { FraudFlagCardProps, FraudFlagCardData, FraudSeverityKind } from './FraudFlagCard';
export { default as TrustTimelineStrip } from './TrustTimelineStrip';
export type { TrustTimelineStripProps, TimelineMilestone } from './TrustTimelineStrip';
export { default as ConsumerReviewCard } from './ConsumerReviewCard';
export type { ConsumerReviewCardProps, ConsumerReviewCardData } from './ConsumerReviewCard';
export { default as ReputationSummaryCard } from './ReputationSummaryCard';
export type { ReputationSummaryCardProps, ReputationSummaryCardData } from './ReputationSummaryCard';

// ── Layer 5: distribution operating system ──
export { default as ContentCard } from './ContentCard';
export type { ContentCardProps, ContentCardData, ContentCardState } from './ContentCard';
export { default as CaptionPreviewCard } from './CaptionPreviewCard';
export type { CaptionPreviewCardProps, CaptionPlatform } from './CaptionPreviewCard';
export { default as CampaignCard } from './CampaignCard';
export type { CampaignCardProps, CampaignCardData } from './CampaignCard';
export { default as DiscoveryFeedCard } from './DiscoveryFeedCard';
export type { DiscoveryFeedCardProps, DiscoveryFeedCardData, FeedKind } from './DiscoveryFeedCard';
export { default as ReferralCard } from './ReferralCard';
export type { ReferralCardProps, ReferralCardData } from './ReferralCard';
export { default as MarketplaceHealthCard } from './MarketplaceHealthCard';
export type { MarketplaceHealthCardProps, MarketplaceHealthCardData, HealthStatusKind } from './MarketplaceHealthCard';
export { default as GrowthMetricCard } from './GrowthMetricCard';
export type { GrowthMetricCardProps, GrowthMetricCardData } from './GrowthMetricCard';
export { default as ViralLoopCard } from './ViralLoopCard';
export type { ViralLoopCardProps, ViralLoopCardData, LoopStep } from './ViralLoopCard';
export { default as SocialAccountCard } from './SocialAccountCard';
export type { SocialAccountCardProps, SocialAccountCardData, SocialPlatformKind } from './SocialAccountCard';

// Layer 6 — financial infrastructure
export { default as EscrowCard } from './EscrowCard';
export type { EscrowCardProps, EscrowCardData, EscrowStatusKind, EscrowMilestoneView } from './EscrowCard';
export { default as CommissionLedgerCard } from './CommissionLedgerCard';
export type { CommissionLedgerCardProps, CommissionLedgerCardData, CommissionStatusKind } from './CommissionLedgerCard';
export { default as RepaymentScheduleCard } from './RepaymentScheduleCard';
export type { RepaymentScheduleCardProps, RepaymentScheduleCardData, RepaymentRow, RepaymentRowStatus } from './RepaymentScheduleCard';
export { default as FinancialIdentityCard } from './FinancialIdentityCard';
export type { FinancialIdentityCardProps, FinancialIdentityCardData, ScoreComponent } from './FinancialIdentityCard';
export { default as WalletCard } from './WalletCard';
export type { WalletCardProps, WalletCardData } from './WalletCard';

// Storybook-style mock props
export * as mocks from './mocks';

// Motion system (Lottie + tokens)
export * from './motion';
