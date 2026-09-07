import { ref } from "vue";

const isDark = ref(false);

function applyTheme(dark) {
  if (dark) {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
  }
}

export function initTheme() {
  const saved = localStorage.getItem("app_theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  isDark.value = saved === "dark" || (!saved && prefersDark);
  applyTheme(isDark.value);

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (!localStorage.getItem("app_theme")) {
        isDark.value = e.matches;
        applyTheme(isDark.value);
      }
    });
  }
}

export function useTheme() {
  function toggleTheme() {
    isDark.value = !isDark.value;
    localStorage.setItem("app_theme", isDark.value ? "dark" : "light");
    applyTheme(isDark.value);
  }

  return {
    isDark,
    toggleTheme,
  };
}
