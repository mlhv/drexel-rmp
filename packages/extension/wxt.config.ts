import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Drexel RMP Ratings",
    description: "Rate My Professors ratings inline on Drexel course pages.",
    permissions: ["storage"],
    host_permissions: [
      "https://*.drexel.edu/*",
      "https://www.ratemyprofessors.com/*",
      "https://*.workers.dev/*",
      "http://localhost:8787/*",
    ],
  },
});
