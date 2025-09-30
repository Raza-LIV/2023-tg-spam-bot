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
console.log("Auth process started");
console.log("API ID:", apiId);
(async () => {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.start({
      phoneNumber: async () => {
        console.log("Please enter your phone number (+380...):");
        return await input.text("Enter your phone number (+380…): ");
      },
      password: async () => {
        console.log("Please enter your 2FA password:");
        return await input.text("2FA password (if enabled): ");
      },
      phoneCode: async () => {
        console.log("Please enter the SMS or Telegram code:");
        return await input.text("SMS or Telegram code: ");
      },
      onError: (error) => {
        console.error("Authentication error:", error.message);
        if (error.message.includes("FLOOD")) {
          console.log("Too many attempts. Please wait before trying again.");
          process.exit(1);
        } else if (error.message.includes("PHONE_CODE_INVALID")) {
          console.log("Invalid phone code. Please check and try again.");
        } else if (error.message.includes("PASSWORD_REQUIRED")) {
          console.log("2FA password is required.");
        } else {
          console.log("Authentication failed. Please check your credentials.");
          process.exit(1);
        }
      },
    });

    const currentConfig = await loadConfig();
    currentConfig.SESSION = client.session.save();
    await saveConfig(currentConfig);
    console.log(
      "Authorized as manager. Saved session:\n",
      client.session.save()
    );
    process.exit(0);
  } catch (error) {
    console.error("Failed to authenticate:", error.message);
    if (error.message.includes("FLOOD")) {
      console.log(
        "Too many authentication attempts. Please wait before trying again."
      );
    } else if (error.message.includes("API_ID_INVALID")) {
      console.log("Invalid API ID. Please check your credentials.");
    } else if (error.message.includes("API_HASH_INVALID")) {
      console.log("Invalid API Hash. Please check your credentials.");
    } else {
      console.log("Unexpected error occurred.");
    }
    process.exit(1);
  }
})();
