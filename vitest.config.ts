import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["api/_ans/__tests__/**/*.spec.ts"],
    testTimeout: 15_000,
    environment: "node",
  },
});
