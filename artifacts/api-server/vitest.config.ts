import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["./src/__tests__/global-setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
