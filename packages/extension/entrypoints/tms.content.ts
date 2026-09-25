import { runSite } from "@/lib/inject";
import { TMS_CONFIG } from "@/lib/sites";

export default defineContentScript({
  matches: TMS_CONFIG.matches,
  main() {
    runSite(TMS_CONFIG);
  },
});
