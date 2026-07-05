import { lookupProfessorViaRmp } from "@drexel-rmp/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = { Bindings: { RMP_CACHE: KVNamespace } };

const POSITIVE_TTL_SECONDS = 7 * 24 * 60 * 60; // found: 7 days
const NEGATIVE_TTL_SECONDS = 24 * 60 * 60; // not_found: 1 day

const app = new Hono<Env>();
app.use("*", cors()); // ratings are public data; tighten to the extension origin post-publish

app.get("/prof", async (c) => {
  const name = c.req.query("name")?.trim().toLowerCase();
  if (!name) return c.json({ error: "name required" }, 400);

  const key = `prof:${name}`;
  const cached = await c.env.RMP_CACHE.get(key, "json");
  if (cached) return c.json(cached);

  try {
    const result = await lookupProfessorViaRmp(name);
    await c.env.RMP_CACHE.put(key, JSON.stringify(result), {
      expirationTtl: result.status === "found" ? POSITIVE_TTL_SECONDS : NEGATIVE_TTL_SECONDS,
    });
    return c.json(result);
  } catch {
    return c.json({ error: "rmp_unavailable" }, 502);
  }
});

export default app;
