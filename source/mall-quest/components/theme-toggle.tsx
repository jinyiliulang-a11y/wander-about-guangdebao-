"use client";

import { Moon, Sun } from "lucide-react";
import type { ExperiencePreferences } from "@/hooks/use-experience-preferences";
import "./theme-toggle.css";

export function ThemeToggle({ theme, onToggle }: {
  theme: ExperiencePreferences["theme"];
  onToggle: () => void;
}) {
  const dark = theme === "dark";
  const label = dark ? "切换浅色" : "切换深色";
  return <button
    className="quest-theme-toggle"
    type="button"
    data-current-theme={theme}
    aria-label={`${label}外观`}
    title={`当前${dark ? "深色" : "浅色"}外观 · ${label}`}
    onClick={onToggle}
  >
    {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    <span>{label}</span>
  </button>;
}
