import { defineConfig } from "vite";

// GitHub Pages serves project sites from /<repo-name>/. Dev server stays at the root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/straddle-carrier-game/" : "/",
}));
