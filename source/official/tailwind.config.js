/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1.5rem",
        lg: "2rem",
        xl: "4rem",
      },
      screens: {
        "2xl": "1440px",
      },
    },
    extend: {
      colors: {
        navy: {
          50: "#eef2f9",
          100: "#d5deef",
          200: "#aabbdf",
          300: "#7e94cf",
          400: "#536fbf",
          500: "#2d4a9e",
          600: "#1f3678",
          700: "#15265a",
          800: "#0e1a40",
          900: "#0a1230",
          950: "#060a1c",
        },
        forest: {
          50: "#f0f7f2",
          100: "#dcebe0",
          200: "#b9d6c2",
          300: "#7ab094",
          400: "#5d9676",
          500: "#4a7c5e",
          600: "#3a634b",
          700: "#2d5a3d",
          800: "#244831",
          900: "#1a3a28",
        },
        cream: {
          50: "#fdfcf9",
          100: "#faf7f2",
          200: "#f3ecdf",
          300: "#ead9be",
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', '"Noto Serif SC"', "serif"],
        sans: ['"Inter"', '"Noto Sans SC"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      fontSize: {
        "10xl": ["10rem", { lineHeight: "0.9" }],
      },
      animation: {
        "fade-up": "fadeUp 0.8s ease-out forwards",
        "fade-in": "fadeIn 1s ease-out forwards",
        "float": "float 6s ease-in-out infinite",
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "marquee": "marquee 30s linear infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(30px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-20px)" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [],
};
