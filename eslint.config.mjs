import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Kjente gjeldsposter: noen steder er typene fra Prisma/Next så
      // tungvinte å uttrykke at `any` er brukt. Vi varsler i stedet for å
      // blokkere, slik at lint kan kjøre grønt i CI mens gjelden ryddes.
      "@typescript-eslint/no-explicit-any": "warn",
      // Fanger blant annet `<label>` uten htmlFor eller omsluttet kontroll.
      // Pluginen registreres allerede av eslint-config-next.
      "jsx-a11y/label-has-associated-control": [
        "error",
        { assert: "either", depth: 3 },
      ],
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/tabindex-no-positive": "error",
      // autoFocus brukes bevisst i noen få skjemaer; varsle, ikke blokker.
      "jsx-a11y/no-autofocus": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Genererte test- og dekningsartefakter skal ikke lintes.
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
