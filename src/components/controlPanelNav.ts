import type React from "react";
import { useTranslation } from "react-i18next";
import { Home, BookOpen, ScrollText } from "./icons";

export type ControlPanelView = "home" | "dictionary" | "logs";

export interface ControlPanelNavItem {
  id: ControlPanelView;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

/**
 * Single source of truth for main-window navigation. The sidebar renders these
 * rows and the top bar shows the active item's label as the page title, so the
 * two can never disagree.
 */
export function useControlPanelNavItems(): ControlPanelNavItem[] {
  const { t } = useTranslation();

  return [
    { id: "home", label: t("sidebar.home"), icon: Home },
    { id: "dictionary", label: t("sidebar.dictionary"), icon: BookOpen },
    { id: "logs", label: t("sidebar.logs"), icon: ScrollText },
  ];
}
