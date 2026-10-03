"use client";
import { useEffect, useState } from "react";

export type ExperiencePreferences = {
  theme: "dark" | "light";
  sound: boolean;
  vibrate: boolean;
  notify: boolean;
  reduceMotion: boolean;
  showExploreTips: boolean;
};
const defaults: ExperiencePreferences = {
  theme: "light",
  sound: true,
  vibrate: false,
  notify: true,
  reduceMotion: false,
  showExploreTips: true,
};
const key = "mall-quest-experience";

export function useExperiencePreferences() {
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const saved = JSON.parse(localStorage.getItem(key) || sessionStorage.getItem(key) || "null");
        if (saved) setPreferences({
          theme: saved.theme === "light" ? "light" : "dark",
          sound: saved.sound !== false,
          vibrate: saved.vibrate === true,
          notify: saved.notify !== false,
          reduceMotion: saved.reduceMotion === true,
          showExploreTips: saved.showExploreTips !== false,
        });
      } catch { /* Storage may be unavailable; retain working defaults. */ }
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.questTheme = preferences.theme;
    document.documentElement.dataset.questReduceMotion = String(preferences.reduceMotion);
    try { localStorage.setItem(key, JSON.stringify(preferences)); } catch {}
    try { sessionStorage.setItem(key, JSON.stringify(preferences)); } catch {}
  }, [preferences, ready]);
  return { preferences, setPreferences, ready };
}
