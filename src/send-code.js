import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, "..", "config.json");
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading config:", error);
    process.exit(1);
  }
}
async function saveConfig(config) {
  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error("Error saving config:", error);
  }
}
const config = await loadConfig();
const apiId = parseInt(config.T_API_ID, 10);
const apiHash = config.T_API_HASH;
const stringSession = new StringSession(config.SESSION || "");
const phoneNumber = process.env.PHONE_NUMBER;
console.log("📤 Send code process started");
console.log("API ID:", apiId);

(async () => {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.start({
      phoneNumber: async () => phoneNumber,
      password: async () => {
        console.log("2FA_NEEDED");
        return new Promise((resolve) => {
          process.stdin.once("data", (data) => {
            resolve(data.toString().trim());
          });
        });
      },
      phoneCode: async () => {
        console.log("WAITING_FOR_CODE");
        return new Promise((resolve) => {
          process.stdin.once("data", (data) => {
            resolve(data.toString().trim());
          });
        });
      },
      onError: (err) => {
        console.error("AUTH_ERROR:", err.message);
        process.exit(1);
      },
    });
    const currentConfig = await loadConfig();
    currentConfig.SESSION = client.session.save();
    await saveConfig(currentConfig);

    console.log("AUTH_SUCCESS");
    process.exit(0);
  } catch (error) {
    console.error("AUTH_ERROR:", error.message);
    process.exit(1);
  }
})();
