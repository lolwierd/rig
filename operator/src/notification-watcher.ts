import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { DispatchWatchTarget } from "./types.js";

interface SessionDoneEvent {
  conversationId: string;
  bridgeId: string;
  title: string;
}

export class NotificationWatcher extends EventEmitter {
  private readonly rigUrl: string;
  private readonly watched = new Map<string, WebSocket>();

  constructor(rigUrl: string) {
    super();
    this.rigUrl = rigUrl;
  }

  watch(target: DispatchWatchTarget): void {
    if (this.watched.has(target.bridgeId)) {
      return;
    }

    const wsUrl = this.rigUrl.replace(/^http/, "ws") + `/api/ws/${encodeURIComponent(target.bridgeId)}`;
    const ws = new WebSocket(wsUrl);
    this.watched.set(target.bridgeId, ws);

    let done = false;

    const finish = (): void => {
      if (done) return;
      done = true;
      this.emit("session-done", {
        conversationId: target.conversationId,
        bridgeId: target.bridgeId,
        title: target.title,
      } satisfies SessionDoneEvent);
      ws.close();
      this.watched.delete(target.bridgeId);
    };

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(String(raw));
        if (data.type === "exit") {
          finish();
          return;
        }
        if (data.type === "event" && data.event?.type === "agent_end") {
          finish();
        }
      } catch {
        // Ignore malformed events.
      }
    });

    ws.on("error", () => {
      this.watched.delete(target.bridgeId);
    });

    ws.on("close", () => {
      this.watched.delete(target.bridgeId);
    });
  }

  shutdown(): void {
    for (const ws of this.watched.values()) {
      ws.close();
    }
    this.watched.clear();
  }
}
