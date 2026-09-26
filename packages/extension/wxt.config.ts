import { defineConfig } from "wxt";
import { buildManifest } from "./lib/manifest";

export default defineConfig({
  manifest: ({ mode }) => buildManifest(mode),
});
