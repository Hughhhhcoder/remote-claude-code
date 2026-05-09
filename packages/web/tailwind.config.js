/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        accent: {
          300: "rgb(var(--accent-300) / <alpha-value>)",
          400: "rgb(var(--accent-400) / <alpha-value>)",
          500: "rgb(var(--accent-500) / <alpha-value>)",
          600: "rgb(var(--accent-600) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
