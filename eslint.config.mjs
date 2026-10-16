import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", ".claude/**", "drizzle/**", "data/**", "screenshots/**", "docs/**", "next-env.d.ts"] },
  ...next,
  ...ts,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
export default config;
