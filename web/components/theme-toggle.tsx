"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const KEY = "calibra-theme";

/**
 * Three states, not two.
 *
 * "System" is a real choice and the default: most people never touch a theme
 * control and want the page to follow their OS. A two-way toggle silently
 * removes the ability to go back to that once it has been used.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === "dark" || stored === "light") setTheme(stored);
    } catch {
      // Private browsing, or site data blocked. The default is still correct.
    }
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Preference is lost on reload, but the page is correct right now.
    }
  };

  // Render a stable placeholder until mounted: the server cannot know the
  // stored theme, so labelling the button before hydration would flicker.
  const label = !mounted ? "Theme" : theme === "system" ? "Auto" : theme === "dark" ? "Dark" : "Light";
  const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";

  return (
    <button
      type="button"
      onClick={() => apply(next)}
      aria-label={`Theme: ${label}. Switch to ${next}.`}
      title={`Theme: ${label}`}
      style={{ minWidth: 76, justifyContent: "center" }}
    >
      {label}
    </button>
  );
}
