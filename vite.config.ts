import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8001" } },
  build: {
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id))
            return "react-vendor";
          if (id.includes("/node_modules/three/")) return "three-core";
          if (/\/node_modules\/(\@react-three\/|three-stdlib\/)/.test(id))
            return "scene-vendor";
        },
      },
    },
  },
});
