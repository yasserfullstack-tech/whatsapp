import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

type Probe = {
  name: string;
  run: (api: APIRequestContext) => Promise<Awaited<ReturnType<APIRequestContext["get"]>>>;
};

const id = randomUUID();

const probes: Probe[] = [
  { name: "audience preview", run: (api) => api.post("/api/audiences/preview", { data: {} }) },
  { name: "segment creation", run: (api) => api.post("/api/audiences/segments", { data: {} }) },
  { name: "campaign creation", run: (api) => api.post("/api/campaigns", { data: {} }) },
  { name: "campaign detail", run: (api) => api.get(`/api/campaigns/${id}`) },
  { name: "campaign control", run: (api) => api.post(`/api/campaigns/${id}/control`, { data: { action: "pause" } }) },
  { name: "contact import presign", run: (api) => api.post("/api/contact-imports/presign", { data: {} }) },
  { name: "contact import detail", run: (api) => api.get(`/api/contact-imports/${id}`) },
  { name: "contact import queue", run: (api) => api.post(`/api/contact-imports/${id}`) },
  { name: "contact suppression", run: (api) => api.post(`/api/contacts/${id}/suppress`, { data: {} }) },
  { name: "contact consent restore", run: (api) => api.post(`/api/contacts/${id}/resubscribe`, { data: {} }) },
  { name: "template creation", run: (api) => api.post("/api/templates", { data: {} }) },
  { name: "template synchronization", run: (api) => api.post("/api/templates/sync", { data: {} }) },
  { name: "embedded signup completion", run: (api) => api.post("/api/meta/embedded-signup/complete", { data: {} }) },
  { name: "workspace data export", run: (api) => api.get("/api/settings/data/export") },
];

test.describe("unauthenticated API access", () => {
  for (const probe of probes) {
    test(`${probe.name} rejects anonymous callers before processing input`, async ({ request }) => {
      const response = await probe.run(request);
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });
  }
});
