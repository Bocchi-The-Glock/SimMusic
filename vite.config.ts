import vinext from "vinext";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const standalone = process.env.SIMMUSIC_TARGET === 'node';

export default defineConfig({
  resolve: { alias: standalone ? { 'cloudflare:workers': fileURLToPath(new URL('./server/bindings.ts', import.meta.url)) } : {} },
  plugins: [
    vinext(),
    ...(!standalone ? [cloudflare({
      configPath: existsSync("wrangler.production.json") ? "wrangler.production.json" : "wrangler.jsonc",
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      inspectorPort: false,
    })] : []),
  ],
});
