import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { useAuthStore } from "../stores/authStore";

export type ThemePreference = "light" | "dark" | "auto";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
    theme: ThemePreference;
    resolvedTheme: ResolvedTheme;
    setTheme: (theme: ThemePreference) => void;
    toggleTheme: () => void;
}

const STORAGE_KEY = "pulsemail-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

const prefersDark = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

const readStoredTheme = (): ThemePreference => {
    if (typeof window === "undefined") return "auto";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "auto"
        ? stored
        : "auto";
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const preferredTheme = useAuthStore(
        (state) => state.user?.preferences?.theme
    );
    const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme);
    const [systemDark, setSystemDark] = useState(prefersDark);

    // A signed-in user's saved preference wins over the anonymous fallback.
    useEffect(() => {
        if (preferredTheme) setThemeState(preferredTheme);
    }, [preferredTheme]);

    useEffect(() => {
        const query = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = (event: MediaQueryListEvent) =>
            setSystemDark(event.matches);
        query.addEventListener("change", onChange);
        return () => query.removeEventListener("change", onChange);
    }, []);

    const resolvedTheme: ResolvedTheme =
        theme === "auto" ? (systemDark ? "dark" : "light") : theme;

    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("dark", resolvedTheme === "dark");
        root.style.colorScheme = resolvedTheme;
    }, [resolvedTheme]);

    const setTheme = useCallback((next: ThemePreference) => {
        setThemeState(next);
        window.localStorage.setItem(STORAGE_KEY, next);
    }, []);

    const toggleTheme = useCallback(() => {
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
    }, [resolvedTheme, setTheme]);

    const value = useMemo(
        () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
        [theme, resolvedTheme, setTheme, toggleTheme]
    );

    return (
        <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
};
