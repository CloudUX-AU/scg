import { defineConfig } from "vite";

// Production builds use relative asset paths so they resolve wherever GitHub Pages serves them.
// The dev server stays at the root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
}));
