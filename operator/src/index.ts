import { loadConfig } from "./config.js";
import { NotificationWatcher } from "./notification-watcher.js";
import { startRestApi } from "./platforms/rest.js";
import { startTelegramBot } from "./platforms/telegram.js";
import { SessionManager } from "./session-manager.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const sessions = new SessionManager(config);
  const watcher = new NotificationWatcher(config.rigUrl);

  sessions.on("dispatch", (target) => {
    watcher.watch(target);
  });

  const rest = await startRestApi(config, sessions);
  const bot = await startTelegramBot(config, sessions, watcher);

  const shutdown = async (): Promise<void> => {
    watcher.shutdown();
    await sessions.shutdown();
    await rest.close();
    if (bot) {
      await bot.stop();
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  console.log(`Rig operator running (REST ${config.rest.host}:${config.rest.port})`);
}

void main();
