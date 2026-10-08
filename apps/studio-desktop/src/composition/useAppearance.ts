import { useEffect } from "react";
import type { UiPreferences } from "./uiPreferences";
export function useAppearance(values: UiPreferences) {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const apply = () => {
      root.dataset.theme =
        values.theme === "system"
          ? media?.matches
            ? "light"
            : "dark"
          : values.theme;
      root.style.setProperty(
        "--ui-font",
        {
          system: '"Segoe UI",system-ui,sans-serif',
          yahei: '"Microsoft YaHei UI","Segoe UI",sans-serif',
          simsun: 'SimSun,"Songti SC",serif',
        }[values.fontFamily],
      );
      root.style.setProperty("--ui-font-size", `${values.fontSize}px`);
      root.style.setProperty(
        "--code-font",
        {
          consolas: 'Consolas,"Cascadia Code",monospace',
          courier: '"Courier New",monospace',
          system: "ui-monospace,monospace",
        }[values.codeFont],
      );
      window.dispatchEvent(new Event("blocky-appearance"));
    };
    apply();
    media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [values.theme, values.fontSize, values.fontFamily, values.codeFont]);
}
