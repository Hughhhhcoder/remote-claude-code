import { expect, test, request as apiRequest } from "@playwright/test";

test.describe("REST API", () => {
  test("GET /api/v1/health returns ok without auth", async ({ baseURL }) => {
    const api = await apiRequest.newContext({ baseURL });
    const res = await api.get("/api/v1/health");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; sessions: number };
    expect(body.ok).toBe(true);
    expect(typeof body.sessions).toBe("number");
    await api.dispose();
  });

  test("GET /api/openapi.json returns OpenAPI 3.1 spec", async ({ baseURL }) => {
    const api = await apiRequest.newContext({ baseURL });
    const res = await api.get("/api/openapi.json");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(body.openapi).toMatch(/^3\./);
    expect(body.paths).toHaveProperty("/api/v1/sessions");
    expect(body.paths).toHaveProperty("/api/v1/health");
    await api.dispose();
  });

  test("GET /api/v1/sessions on loopback returns sessions array", async ({ baseURL }) => {
    const api = await apiRequest.newContext({ baseURL });
    const res = await api.get("/api/v1/sessions");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { sessions: Array<{ id: string }> };
    expect(Array.isArray(body.sessions)).toBe(true);
    await api.dispose();
  });

  test("POST /api/v1/sessions creates a session and GET shows it", async ({ baseURL }) => {
    const api = await apiRequest.newContext({ baseURL });
    const create = await api.post("/api/v1/sessions", {
      data: { permissionMode: "default", driver: "cli" },
    });
    expect(create.status()).toBe(201);
    const created = (await create.json()) as { session: { id: string } };
    expect(created.session.id).toBeTruthy();

    const list = await api.get("/api/v1/sessions");
    expect(list.status()).toBe(200);
    const body = (await list.json()) as { sessions: Array<{ id: string }> };
    const ids = body.sessions.map((s) => s.id);
    expect(ids).toContain(created.session.id);

    // Cleanup
    const del = await api.delete(`/api/v1/sessions/${created.session.id}`);
    expect([200, 404]).toContain(del.status());
    await api.dispose();
  });

  test("GET /api/v1/projects returns at least default project", async ({ baseURL }) => {
    const api = await apiRequest.newContext({ baseURL });
    const res = await api.get("/api/v1/projects");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { projects: Array<{ id: string; isDefault?: boolean }> };
    expect(body.projects.length).toBeGreaterThan(0);
    await api.dispose();
  });

  test("non-existent route returns 404 JSON", async ({ baseURL }) => {
    const api = await apiRequest.newContext({ baseURL });
    const res = await api.get("/api/v1/does-not-exist");
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("not_found");
    await api.dispose();
  });
});
