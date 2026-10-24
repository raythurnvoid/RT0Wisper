import { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";

const BANNER_DISMISSED_KEY = "toneStyleBannerDismissed";

const readFlag = (key: string) => localStorage.getItem(key) === "true";

export const dismissToneStyleBanner = () => localStorage.setItem(BANNER_DISMISSED_KEY, "true");

/**
 * Tone & Style's Home entry point: the banner until it is set up or dismissed,
 * and the setup dialog it opens.
 */
export function useToneStylePrompt() {
  const toneStyleEnabled = useSettingsStore((s) => s.toneStyleEnabled);
  const [bannerDismissed, setBannerDismissed] = useState(() => readFlag(BANNER_DISMISSED_KEY));
  const [dialogOpen, setDialogOpen] = useState(false);

  const dismissBanner = useCallback(() => {
    dismissToneStyleBanner();
    setBannerDismissed(true);
  }, []);

  // Once Tone & Style is set up, Home stops offering it.
  useEffect(() => {
    if (toneStyleEnabled) dismissBanner();
  }, [toneStyleEnabled, dismissBanner]);

  return {
    showBanner: !toneStyleEnabled && !bannerDismissed,
    dialogOpen,
    setDialogOpen,
    dismissBanner,
  };
}
