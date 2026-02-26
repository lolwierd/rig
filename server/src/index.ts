/**
 * Rig server entry point.
 *
 * HTTP + WebSocket server using Fastify.
 * Proxies the pi coding agent's RPC protocol to the frontend.
 */

import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { registerRoutes } from "./routes.js";
import { loadConfig } from "./config.js";
import { killAll } from "./pi-bridge.js";

async function main() {
	const config = loadConfig();
	const port = config.port;

	const app = Fastify({
		bodyLimit: 50 * 1024 * 1024, // 50MB — needed for image attachments
		logger: {
			level: "info",
			transport: {
				target: "pino-pretty",
				options: {
					translateTime: "HH:MM:ss",
					ignore: "pid,hostname",
				},
			},
		},
	});

	// ─── Plugins ──────────────────────────────────────────────────────────

	await app.register(fastifyCors, {
		origin: true, // Allow all origins in dev; tighten for production
	});

	await app.register(fastifyWebSocket);

	// Serve built frontend if it exists
	const frontendDist = resolve(import.meta.dirname, "../../frontend/dist");
	if (existsSync(frontendDist)) {
		await app.register(fastifyStatic, {
			root: frontendDist,
			prefix: "/",
			wildcard: false,
		});

		// SPA fallback: serve index.html for non-API routes
		app.setNotFoundHandler((req, reply) => {
			if (req.url.startsWith("/api/")) {
				reply.code(404).send({ error: "not found" });
			} else {
				reply.sendFile("index.html");
			}
		});
	}

	// ─── Routes ───────────────────────────────────────────────────────────

	await registerRoutes(app);

	// ─── Lifecycle ────────────────────────────────────────────────────────

	// Graceful shutdown
	const shutdown = async () => {
		app.log.info("Shutting down...");
		killAll();
		await app.close();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// ─── Start ────────────────────────────────────────────────────────────

	try {
		await app.listen({ port, host: "0.0.0.0" });
		console.log(`\n  ⚙  rig server running on http://localhost:${port}\n`);
	} catch (err) {
		app.log.error(err);
		process.exit(1);
	}
}

main();
