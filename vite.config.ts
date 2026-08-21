import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Browser bundle for the Vibe Host / standard Node.js deployment. */
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
