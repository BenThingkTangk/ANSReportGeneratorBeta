import { defineConfig } from "vitest/config";
import path from "node:path";

// SEPARATE client render config (jsdom). Kept distinct from vitest.config.ts so
// the node-based API/eval suites and the CI regression gate are unaffected.
export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      // Redirect recharts to a lightweight stub. The real recharts transitive
      // graph (d3/*) stalls vite's transform under jsdom; the null-safety logic
      // under test does not depend on chart internals.
      recharts: path.resolve(
        import.meta.dirname,
        "client/src/__tests__/stubs/recharts.tsx",
      ),
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  test: {
    include: ["client/src/__tests__/**/*.spec.tsx"],
    testTimeout: 30_000,
    environment: "jsdom",
    globals: true,
  },
});
