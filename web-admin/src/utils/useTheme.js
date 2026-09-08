import { ref, computed } from "vue";

// Theme mode: "light" | "dark" | "system"
const themeMode = ref("system");
const systemPrefersDark = ref(false);

// Reactive boolean: whether the currently applied visual theme is dark
const isDark = computed(() => {
  if (themeMode.value === "dark") return true;
  if (themeMode.value === "light") return false;
  return systemPrefersDark.value;
});

function applyTheme(dark) {
  if (typeof document === "undefined") return;
  if (dark) {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
  }
}

let listenerRegistered = false;

export function initTheme() {
  if (typeof window === "undefined") return;

  const mediaQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mediaQuery) {
    systemPrefersDark.value = mediaQuery.matches;
    if (!listenerRegistered) {
      mediaQuery.addEventListener("change", (e) => {
        systemPrefersDark.value = e.matches;
        if (themeMode.value === "system") {
          applyTheme(isDark.value);
        }
      });
      listenerRegistered = true;
    }
  }

  const saved = localStorage.getItem("app_theme");
  if (saved === "dark" || saved === "light" || saved === "system") {
    themeMode.value = saved;
  } else {
    // Default to 'system' if not explicitly set
    themeMode.value = "system";
  }

  applyTheme(isDark.value);
}

export function useTheme() {
  function setTheme(mode) {
    if (mode !== "light" && mode !== "dark" && mode !== "system") return;
    themeMode.value = mode;
    localStorage.setItem("app_theme", mode);
    applyTheme(isDark.value);
  }

  function toggleTheme() {
    // Cycles: system -> light -> dark -> system
    if (themeMode.value === "system") {
      setTheme("light");
    } else if (themeMode.value === "light") {
      setTheme("dark");
    } else {
      setTheme("system");
    }
  }

  return {
    themeMode,
    isDark,
    systemPrefersDark,
    setTheme,
    toggleTheme,
  };
}
