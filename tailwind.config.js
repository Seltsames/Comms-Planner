/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#FFF4EC",
          100: "#FFE3D0",
          200: "#FFC7A1",
          300: "#FFA872",
          400: "#FF8943",
          500: "#FF6B1A",
          600: "#F25400",
          700: "#C74000",
          800: "#9C3200",
          900: "#722500",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
