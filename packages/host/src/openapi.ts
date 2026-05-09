export function openApiSpec(): Record<string, unknown> {
  const bearer = [{ bearerAuth: [] as string[] }];
  return {
    openapi: "3.1.0",
    info: {
      title: "RCC Host REST API",
      version: "1.0.0",
      description:
        "HTTP mirror of the main WebSocket frames. Lets curl/Postman/third-party integrations drive an RCC host without speaking the ws protocol.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error", "code"],
          properties: {
            error: { type: "string" },
            code: { type: "string" },
          },
        },
        SessionMeta: {
          type: "object",
          properties: {
            id: { type: "string" },
            cwd: { type: "string" },
            createdAt: { type: "number" },
            lastActiveAt: { type: "number" },
            status: { type: "string", enum: ["running", "exited"] },
            permissionMode: { type: "string" },
            projectId: { type: "string", nullable: true },
            driver: { type: "string", enum: ["cli", "sdk"] },
          },
        },
      },
    },
    security: bearer,
    paths: {
      "/api/v1/health": {
        get: {
          summary: "Liveness probe (no auth)",
          security: [],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      sessions: { type: "number" },
                      devices: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/sessions": {
        get: {
          summary: "List sessions",
          responses: {
            200: {
              description: "sessions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      sessions: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SessionMeta" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: "Create a session",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    cwd: { type: "string" },
                    permissionMode: {
                      type: "string",
                      enum: [
                        "default",
                        "plan",
                        "acceptEdits",
                        "bypassPermissions",
                        "auto",
                        "dontAsk",
                      ],
                    },
                    projectId: { type: "string" },
                    starterId: { type: "string" },
                    driver: { type: "string", enum: ["cli", "sdk"] },
                    cols: { type: "number" },
                    rows: { type: "number" },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { session: { $ref: "#/components/schemas/SessionMeta" } },
                  },
                },
              },
            },
            400: errorResponse(),
          },
        },
      },
      "/api/v1/sessions/{sid}": {
        parameters: [sidParam()],
        get: {
          summary: "Get session meta",
          responses: { 200: { description: "ok" }, 404: errorResponse() },
        },
        delete: {
          summary: "Close a session",
          responses: { 200: { description: "ok" }, 404: errorResponse() },
        },
      },
      "/api/v1/sessions/{sid}/resume": {
        parameters: [sidParam()],
        post: {
          summary: "Resume an archived session",
          responses: { 200: { description: "ok" }, 404: errorResponse() },
        },
      },
      "/api/v1/sessions/{sid}/chat": {
        parameters: [sidParam()],
        get: {
          summary: "Get chat messages",
          responses: {
            200: {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      sid: { type: "string" },
                      messages: { type: "array", items: { type: "object" } },
                    },
                  },
                },
              },
            },
            404: errorResponse(),
          },
        },
      },
      "/api/v1/sessions/{sid}/input": {
        parameters: [sidParam()],
        post: {
          summary: "Write raw bytes to session stdin",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { type: "string" } },
                },
              },
            },
          },
          responses: { 200: { description: "ok" }, 404: errorResponse() },
        },
      },
      "/api/v1/sessions/{sid}/prompt": {
        parameters: [sidParam()],
        post: {
          summary: "Send a prompt (text + newline)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["prompt"],
                  properties: { prompt: { type: "string" } },
                },
              },
            },
          },
          responses: { 200: { description: "ok" }, 404: errorResponse() },
        },
      },
      "/api/v1/projects": {
        get: { summary: "List projects", responses: { 200: { description: "ok" } } },
        post: {
          summary: "Create project",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "cwd"],
                  properties: {
                    name: { type: "string" },
                    cwd: { type: "string" },
                    color: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "created" } },
        },
      },
      "/api/v1/projects/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        delete: { summary: "Delete project", responses: { 200: { description: "ok" } } },
      },
      "/api/v1/skills": {
        get: { summary: "List skills", responses: { 200: { description: "ok" } } },
        post: { summary: "Write a skill", responses: { 201: { description: "ok" } } },
      },
      "/api/v1/skills/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        get: { summary: "Read skill content", responses: { 200: { description: "ok" } } },
        put: {
          summary: "Enable / disable skill",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["enabled"],
                  properties: { enabled: { type: "boolean" } },
                },
              },
            },
          },
          responses: { 200: { description: "ok" } },
        },
        delete: { summary: "Delete skill", responses: { 200: { description: "ok" } } },
      },
      "/api/v1/mcp": {
        get: { summary: "List MCP servers", responses: { 200: { description: "ok" } } },
        post: { summary: "Add MCP server", responses: { 201: { description: "ok" } } },
      },
      "/api/v1/mcp/{name}": {
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        get: { summary: "Get MCP server detail", responses: { 200: { description: "ok" } } },
        put: { summary: "Enable/disable MCP server", responses: { 200: { description: "ok" } } },
        delete: { summary: "Remove MCP server", responses: { 200: { description: "ok" } } },
      },
      "/api/v1/commands": {
        get: { summary: "List slash commands", responses: { 200: { description: "ok" } } },
        post: { summary: "Save command", responses: { 201: { description: "ok" } } },
      },
      "/api/v1/commands/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        get: { summary: "Read command", responses: { 200: { description: "ok" } } },
        delete: { summary: "Delete command", responses: { 200: { description: "ok" } } },
      },
      "/api/v1/subagents": {
        get: { summary: "List subagents", responses: { 200: { description: "ok" } } },
        post: { summary: "Save subagent", responses: { 201: { description: "ok" } } },
      },
      "/api/v1/subagents/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        get: { summary: "Read subagent", responses: { 200: { description: "ok" } } },
        delete: { summary: "Delete subagent", responses: { 200: { description: "ok" } } },
      },
      "/api/v1/hooks": {
        get: { summary: "List hooks", responses: { 200: { description: "ok" } } },
        post: { summary: "Write hook", responses: { 201: { description: "ok" } } },
      },
      "/api/v1/hooks/{scope}/{event}/{index}": {
        parameters: [
          { name: "scope", in: "path", required: true, schema: { type: "string" } },
          { name: "event", in: "path", required: true, schema: { type: "string" } },
          { name: "index", in: "path", required: true, schema: { type: "integer" } },
        ],
        delete: { summary: "Delete hook entry", responses: { 200: { description: "ok" } } },
      },
      "/api/v1/permissions": {
        get: { summary: "List permissions", responses: { 200: { description: "ok" } } },
        post: { summary: "Add rule", responses: { 201: { description: "ok" } } },
        delete: { summary: "Remove rule", responses: { 200: { description: "ok" } } },
      },
      "/api/v1/starters": {
        get: { summary: "List starters", responses: { 200: { description: "ok" } } },
        post: { summary: "Save starter", responses: { 201: { description: "ok" } } },
      },
      "/api/v1/starters/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        delete: { summary: "Delete starter", responses: { 200: { description: "ok" } } },
      },
    },
  };
}

function sidParam(): Record<string, unknown> {
  return { name: "sid", in: "path", required: true, schema: { type: "string" } };
}

function errorResponse(): Record<string, unknown> {
  return {
    description: "error",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
      },
    },
  };
}
