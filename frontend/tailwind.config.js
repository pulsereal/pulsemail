/**
 * Colors are driven by CSS custom properties declared in src/index.css so the
 * same utility class resolves correctly in both themes. Semantic tokens
 * (canvas/surface/content/line) should be preferred over raw gray shades.
 */
const withOpacity = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

const ramp = (prefix) =>
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].reduce(
        (shades, shade) => ({
            ...shades,
            [shade]: withOpacity(`--color-${prefix}-${shade}`),
        }),
        {}
    );

module.exports = {
    darkMode: "class",
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        extend: {
            colors: {
                primary: ramp("primary"),
                success: ramp("success"),
                warning: ramp("warning"),
                danger: ramp("danger"),

                canvas: withOpacity("--color-canvas"),
                surface: {
                    DEFAULT: withOpacity("--color-surface"),
                    raised: withOpacity("--color-surface-raised"),
                    sunken: withOpacity("--color-surface-sunken"),
                    hover: withOpacity("--color-surface-hover"),
                },
                line: {
                    DEFAULT: withOpacity("--color-line"),
                    strong: withOpacity("--color-line-strong"),
                },
                content: {
                    DEFAULT: withOpacity("--color-content"),
                    muted: withOpacity("--color-content-muted"),
                    subtle: withOpacity("--color-content-subtle"),
                    inverted: withOpacity("--color-content-inverted"),
                },
                sidebar: {
                    DEFAULT: withOpacity("--color-sidebar"),
                    hover: withOpacity("--color-sidebar-hover"),
                    active: withOpacity("--color-sidebar-active"),
                    content: withOpacity("--color-sidebar-content"),
                    muted: withOpacity("--color-sidebar-muted"),
                },
            },
            fontFamily: {
                sans: ["Inter", "system-ui", "sans-serif"],
                mono: ["JetBrains Mono", "ui-monospace", "monospace"],
            },
            fontSize: {
                "2xs": ["0.6875rem", { lineHeight: "1rem" }],
            },
            spacing: {
                18: "4.5rem",
                88: "22rem",
                mail: "26rem",
            },
            animation: {
                "fade-in": "fadeIn 0.2s ease-out",
                "slide-up": "slideUp 0.24s ease-out",
                "slide-down": "slideDown 0.24s ease-out",
                "slide-in-right": "slideInRight 0.24s ease-out",
                shimmer: "shimmer 1.6s linear infinite",
            },
            keyframes: {
                fadeIn: {
                    "0%": { opacity: "0" },
                    "100%": { opacity: "1" },
                },
                slideUp: {
                    "0%": { transform: "translateY(8px)", opacity: "0" },
                    "100%": { transform: "translateY(0)", opacity: "1" },
                },
                slideDown: {
                    "0%": { transform: "translateY(-8px)", opacity: "0" },
                    "100%": { transform: "translateY(0)", opacity: "1" },
                },
                slideInRight: {
                    "0%": { transform: "translateX(16px)", opacity: "0" },
                    "100%": { transform: "translateX(0)", opacity: "1" },
                },
                shimmer: {
                    "0%": { backgroundPosition: "-500px 0" },
                    "100%": { backgroundPosition: "500px 0" },
                },
            },
            boxShadow: {
                soft: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 6px -1px rgb(0 0 0 / 0.06)",
                medium: "0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 6px -2px rgb(0 0 0 / 0.06)",
                hard: "0 12px 32px -8px rgb(0 0 0 / 0.18), 0 4px 12px -4px rgb(0 0 0 / 0.1)",
            },
            backdropBlur: {
                xs: "2px",
            },
        },
    },
    plugins: [
        require("@tailwindcss/forms"),
        require("@tailwindcss/typography"),
        require("@tailwindcss/aspect-ratio"),
    ],
};
