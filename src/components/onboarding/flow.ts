// Keys the upstream onboarding flow persisted. AppRouter still reads them to
// tell whether a setup was left unfinished.
export const ONBOARDING_SESSION_KEY = "onboardingSessionV2";
export const LEGACY_ONBOARDING_STEP_KEY = "onboardingCurrentStep";

export interface OnboardingProgressState {
  /** Zero-based position among the counted steps. */
  index: number;
  /** Number of counted steps in the current route. */
  total: number;
}
