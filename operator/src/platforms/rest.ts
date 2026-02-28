import Fastify, { type FastifyInstance } from "fastify";
import type { OperatorConfig } from "../types.js";
import type { SessionManager } from "../session-manager.js";

function isAuthorized(authHeader: string | undefined, expectedToken: string | undefined): boolean {
  if (!expectedToken) return true;
  if (!authHeader) return false;
  const value = authHeader.replace(/^Bearer\s+/i, "").trim();
  return value === expectedToken;
}

export async function startRestApi(config: OperatorConfig, sessions: SessionManager): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  app.addHook("onRequest", async (request, reply) => {
    const token = config.rest.bearerToken;
    if (!token) return;
    const ok = isAuthorized(request.headers.authorization, token);
    if (!ok) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  app.post("/chat", async (request) => {
    const body = request.body as { conversationId: string; message: string };
    const result = await sessions.sendMessage(body.conversationId, body.message);
    return { response: result.text, toolCalls: result.toolCalls };
  });

  app.post("/chat/stream", async (request, reply) => {
    const body = request.body as { conversationId: string; message: string };
    if (!body?.conversationId || !body?.message) {
      await reply.code(400).send({ error: "conversationId and message are required" });
      return;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const writeEvent = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let latestText = "";
    const toolCalls: string[] = [];

    try {
      await sessions.sendMessage(body.conversationId, body.message, {
        callbacks: {
          onText: (text) => {
            latestText = text;
            writeEvent("text", { text });
          },
          onToolCall: (toolName) => {
            toolCalls.push(toolName);
            writeEvent("tool", { toolName });
          },
        },
      });

      writeEvent("done", { text: latestText, toolCalls });
    } catch (error: any) {
      writeEvent("error", { message: error?.message || String(error) });
    } finally {
      reply.raw.end();
    }
  });

  app.get("/conversations", async () => {
    const active = await sessions.listActiveConversations();
    const known = await sessions.listKnownConversations();
    return { active, known };
  });

  app.delete("/conversations/:id", async (request) => {
    const params = request.params as { id: string };
    const ended = await sessions.endConversation(params.id);
    return { ended };
  });

  await app.listen({ host: config.rest.host, port: config.rest.port });
  return app;
}
