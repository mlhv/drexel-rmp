import { lookupProfessorViaRmp } from "@drexel-rmp/shared";
import { browser } from "wxt/browser";
import { getCached, setCached } from "@/lib/cache";
import { DIRECT_TIMEOUT_MS, WORKER_TIMEOUT_MS, WORKER_URL } from "@/lib/config";
import { createLookupService } from "@/lib/lookup";
import { createWorkerFetcher, withTimeout } from "@/lib/workerClient";

export default defineBackground(() => {
  const service = createLookupService({
    getCached,
    setCached,
    fetchFromWorker: createWorkerFetcher(WORKER_URL, WORKER_TIMEOUT_MS),
    fetchDirect: (name) => lookupProfessorViaRmp(name, withTimeout(fetch, DIRECT_TIMEOUT_MS)),
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as { type?: string; name?: string };
    if (msg?.type === "LOOKUP_PROFESSOR" && typeof msg.name === "string") {
      service
        .lookup(msg.name)
        .then(sendResponse)
        .catch(() => sendResponse(null));
      return true; // keep the message channel open for the async response
    }
  });
});
