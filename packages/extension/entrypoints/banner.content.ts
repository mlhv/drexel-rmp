import { runSite } from "@/lib/inject";
import { BANNER_CONFIG } from "@/lib/sites";

export default defineContentScript({
  matches: BANNER_CONFIG.matches,
  main() {
    runSite(BANNER_CONFIG);
  },
});
