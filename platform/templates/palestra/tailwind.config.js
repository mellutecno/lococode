/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#fff7ec",
          100: "#ffead0",
          200: "#ffd29a",
          300: "#ffb35d",
          400: "#ff9131",
          500: "#fb7416",
          600: "#ec570c",
          700: "#c3410c",
          800: "#9b3411",
          900: "#7d2d12",
        },
      },
    },
  },
  plugins: [],
};
