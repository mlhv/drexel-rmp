import { defineConfig } from "wxt";
import { buildManifest } from "./lib/manifest";

export default defineConfig({
  modules: ["@wxt-dev/auto-icons"],
  autoIcons: { baseIconPath: "assets/icon.svg" },
  manifest: ({ mode }) => buildManifest(mode),
  zip: { artifactTemplate: "du-professorview-{{version}}-{{browser}}.zip" },
});
