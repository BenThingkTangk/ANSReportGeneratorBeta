import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

/**
 * Light/dark theme toggle. Hydration-safe — renders a skeleton until mounted
 * to avoid SSR/CSR token mismatch flicker on first paint.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme !== "light";
  const next = isDark ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      data-testid="theme-toggle"
      className="touch-target relative inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border/40 bg-card/50 hover:bg-card/80 transition-colors text-muted-foreground hover:text-foreground"
    >
      {mounted ? (
        isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />
      ) : (
        <span className="w-4 h-4" />
      )}
    </button>
  );
}
