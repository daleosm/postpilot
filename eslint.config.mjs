import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-playwright*/**",
    "out/**",
    "build/**",
    // The standalone site has its own generated Next/static output.
    // Linting these bundles produces framework noise rather than source errors.
    "site/.next/**",
    "site/out/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
