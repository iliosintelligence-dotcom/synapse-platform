/**
 * VisionDock — bottom navigation dock. White, thin top border.
 * Consumer: Home, Search, Saved, Alerts, Profile.
 * Agency: Dashboard, Pipeline, Listings, Analytics, Profile.
 * Active: heavier stroke + accent dot. Inactive: outline, muted.
 *
 * (Thin wrapper over NavigationRail with the Layer-1 naming.)
 */
import NavigationRail, {
  type NavigationRailProps,
  type RailMode,
} from './NavigationRail';

export type VisionDockProps = NavigationRailProps;
export type VisionDockMode = RailMode;

const VisionDock = NavigationRail;
export default VisionDock;
