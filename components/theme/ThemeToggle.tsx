"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme/ThemeProvider";

interface ThemeToggleProps {
  /** "sidebar" (ligne pleine largeur, avec libellé) ou "icon" (bouton compact). */
  variant?: "sidebar" | "icon";
}

export function ThemeToggle({ variant = "sidebar" }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isLight ? "Passer en mode sombre" : "Passer en mode clair"}
        className="flex h-9 w-9 items-center justify-center border border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        {isLight ? <Moon size={16} /> : <Sun size={16} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="pressable flex min-h-[44px] w-full items-center gap-3 rounded-control px-4 text-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {isLight ? <Moon size={18} /> : <Sun size={18} />}
      {isLight ? "Mode sombre" : "Mode clair"}
    </button>
  );
}
