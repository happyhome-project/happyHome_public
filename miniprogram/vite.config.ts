import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import path from "path";
import { readFileSync } from "fs";

const uniScssTokens = readFileSync(path.resolve(__dirname, "src/uni.scss"), "utf8");
const buildInfoSource = readFileSync(path.resolve(__dirname, "src/generated/build-info.ts"), "utf8");
const buildVersion = buildInfoSource.match(/version:\s*["']([^"']+)["']/)?.[1] || "";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  define: {
    __HH_BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  build: {
    target: "es2017",
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `${uniScssTokens}\n`,
        silenceDeprecations: ["legacy-js-api", "import", "global-builtin", "color-functions"],
      },
    },
  },
});
