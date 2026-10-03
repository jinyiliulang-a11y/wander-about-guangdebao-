"use client";
import { useCallback, useEffect, useRef } from "react";
import type { ExperiencePreferences } from "./use-experience-preferences";

export function useCelebration(preferences: ExperiencePreferences) {
  const context = useRef<AudioContext | null>(null);
  const seen = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = context.current;
      context.current = null;
      if (current) void current.close().catch(() => {});
    };
  }, []);

  const prime = useCallback(() => {
    if (!preferences.sound || !mounted.current || typeof window === "undefined") return;
    try {
      const Constructor = window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) return;
      if (!context.current || context.current.state === "closed") context.current = new Constructor();
      if (context.current.state === "suspended") void context.current.resume().catch(() => {});
    } catch { /* Browser audio permissions must not affect the saved reward. */ }
  }, [preferences.sound]);

  const celebrate = useCallback((rewardId: string) => {
    if (!rewardId || !mounted.current || seen.current.has(rewardId)) return;
    seen.current.add(rewardId);
    if (preferences.vibrate && typeof navigator !== "undefined") {
      try { navigator.vibrate?.([50, 35, 70]); } catch {}
    }
    if (!preferences.sound) return;
    prime();
    const audio = context.current;
    if (!audio || audio.state !== "running") return;
    try {
      const start = audio.currentTime;
      [659.25, 880].forEach((frequency, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const at = start + index * 0.14;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.07, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(at);
        oscillator.stop(at + 0.19);
      });
    } catch { /* Optional celebration never changes the claim result. */ }
  }, [preferences.sound, preferences.vibrate, prime]);

  return { prime, celebrate };
}
