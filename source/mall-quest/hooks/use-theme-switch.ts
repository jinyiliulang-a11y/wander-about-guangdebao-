"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import type { ExperiencePreferences } from "./use-experience-preferences";
import "../components/theme-transition.css";

type ThemeTask = {
  timers: number[];
  transition: ReturnType<Document["startViewTransition"]> | null;
};

/** Theme changes keep the existing preference owner and never reset its fields. */
export function useThemeSwitch(
  preferences: ExperiencePreferences,
  setPreferences: Dispatch<SetStateAction<ExperiencePreferences>>,
) {
  const active = useRef<ThemeTask | null>(null);
  useEffect(() => () => {
    const task = active.current;
    active.current = null;
    task?.timers.forEach(window.clearTimeout);
    task?.transition?.skipTransition();
    delete document.documentElement.dataset.questThemeTransition;
  }, []);

  return useCallback((requestedTheme?: ExperiencePreferences["theme"]) => {
    if (active.current || requestedTheme === preferences.theme) return;
    const nextTheme = requestedTheme || (preferences.theme === "light" ? "dark" : "light");
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      flushSync(() => setPreferences(current => ({ ...current, theme: nextTheme })));
    };
    if (preferences.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      commit();
      return;
    }
    const task: ThemeTask = { timers: [], transition: null };
    active.current = task;
    const clear = () => {
      if (active.current !== task) return;
      task.timers.forEach(window.clearTimeout);
      active.current = null;
      delete document.documentElement.dataset.questThemeTransition;
    };
    if (typeof document.startViewTransition === "function") {
      document.documentElement.dataset.questThemeTransition = "snapshot";
      try {
        task.transition = document.startViewTransition(commit);
        // Skipped or superseded snapshots must not leave an unhandled rejection.
        void task.transition.ready.catch(() => {});
        void task.transition.finished.catch(() => {}).finally(clear);
        task.timers.push(window.setTimeout(() => {
          task.transition?.skipTransition();
          commit();
          clear();
        }, 1000));
        return;
      } catch {
        // Browser snapshot capture can fail; perform the preference update once.
        commit();
        clear();
        return;
      }
    }
    document.documentElement.dataset.questThemeTransition = "exit";
    task.timers.push(window.setTimeout(() => {
      commit();
      document.documentElement.dataset.questThemeTransition = "enter";
      task.timers.push(window.setTimeout(clear, 220));
    }, 140));
  }, [preferences.theme, preferences.reduceMotion, setPreferences]);
}
