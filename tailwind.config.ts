import type { Config } from "tailwindcss";

// Warm editorial tokens mirrored from tehb-website (client/src/index.css):
// bone #FAF6EE, warm ink #211A12, brand gold #F5C400 (fills only, never body text).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bone: "#FAF6EE",
        ink: "#211A12",
        gold: "#F5C400",
        "ink-muted": "#6B6152",
        line: "#E7DFD0",
      },
      borderRadius: {
        btn: "10px",
        "2xl": "1rem",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
