import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import path from "path";
import { readFileSync } from "fs";

const uniScssTokens = readFileSync(path.resolve(__dirname, "src/uni.scss"), "utf8");

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `${uniScssTokens}\n`,
        silenceDeprecations: ["legacy-js-api", "import", "global-builtin", "color-functions"],
      },
    },
  },
});
