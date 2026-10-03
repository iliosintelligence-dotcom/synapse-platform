# Design System (packages/ui)

VisionOS-on-mobile. Light mode only. Depth from blur + shadow, never colour.
All values come from `packages/ui/src/tokens.ts` — no hardcoded values anywhere.

## Tokens

- **Depth** — 5 layers (0 canvas → 4 focus modal): each declares blur intensity,
  glass fill, z hint. Components declare their layer.
- **Shadows** — 3 levels, large radius / low opacity, mapped to layers 1–3.
- **Motion** — micro 100ms, standard 180ms, expanded 250ms (hard ceiling 300ms).
  Spring configs (`spring.micro/standard/expanded`) for Reanimated.
- **Colour** — white canvas `#FDFDFC`, surface `#FFFFFF`, ink `#16181C`,
  terracotta accent `#C2552B` (CTAs/AI moments only), gold `#9C7A1E`
  (verification), green `#2E7D4F` (trust/verified). No brown palette, no dark mode.
- **Type** — Bebas Neue display; DM Sans light/regular/medium/semibold.
  Five styles: Display, Title, Body, Label, Caption (use the `Typography`
  wrappers, not raw `<Text>`).
- **Spacing** — xs 6 → section 56. If it feels tight, go up a step.
- **Radius** — sm 12 / md 18 / lg 24 / xl 30 / pill.
- **Icons** — inline SVG, SF-Symbols style, single 1.6 stroke weight
  (`Icon` primitive, 34 glyphs). No third-party icon sets.

## Primitives

| Primitive | Key props | Notes |
|---|---|---|
| `GlassCard` | `depthLayer 0–4, blur?, padding?, borderRadius?, shadowLevel 1–3, edgeHighlight, edgeGlow` | Foundation; everything extends it |
| `PropertyCard` | `property, state: compact/expanded/focused, onGenerate(kind)` | Chains into insight/analysis/viewing |
| `InsightCard` | `label, reasoning, confidence?` | Higher translucency + edge glow; never a recommendation without the why |
| `AgentCard` | `agencyName, agentName, verificationLabel, available, tojuSummary, onCall/onWhatsApp/onSchedule` | Human-first |
| `BottomSheet` | `visible, size: collapsed/half/expanded, onClose, onSizeChange` | Spring + drag handle (gesture-handler) |
| `FloatingSearch` | `prompts?, rotateMs?, onActivate, onVoice` | Conversation entry, not a query box |
| `Avatar` | `name, imageUrl?, size sm–xl, verified?` | Initials fallback, gold check overlay |
| `Button` | `label, variant: filled/ghost/destructive, size, icon?, loading?` | DM Sans semibold, pill |
| `Input` | `label?, error?, icon?` + TextInputProps | Glass field; default/focused/error |
| `Tag` | `label, variant: verified/pending/status/category` | |
| `PropertyBadge` | `trustScore, nodes (entity type), verified?` | Maps DB nodes → ring chips; FAILED never rendered |
| `VisionDock` | `mode: consumer/agency, activeTab, onSelect` | 5 tabs per mode; accent dot active state |
| `Typography` | `Display/Title/Body/Label/Caption` | Style-token wrappers |

Plus the extended card library carried forward from the prototype:
`AIConversationCard`, `TypingIndicator`, `FloatingAIOrb`, `CommuteCard`,
`AffordabilityCard`, `NeighbourhoodCard`, `MapCard`, `PropertyComparisonCard`,
`PropertyImageViewer`, `ProximityAlertCard`, `ViewingCard`, and the
`CardChain` system (`CHAIN_GRAPH`, `useCardChain`, `CardChainView`).

## Usage rules

1. Never hardcode a colour, duration, radius, or spacing value.
2. Never use raw `<Text>` — use Typography wrappers.
3. Cards declare a depth layer; don't fake elevation with borders.
4. Accent is for CTAs, AI moments, and active states only.
5. Consumer surfaces never show failed verification states.
6. Web (dashboard) consumes token VALUES via Tailwind config —
   `apps/dashboard/tailwind.config.ts` mirrors `tokens.ts`.
   TODO(layer-2): generate the Tailwind theme from tokens.ts to remove the
   manual sync.
