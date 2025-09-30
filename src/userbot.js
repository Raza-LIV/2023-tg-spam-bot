import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
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

const getChatType = (chat) => {
  if (chat.isGroup || chat.isChannel) return "group";
  return "private";
};

const tryAddToContacts = async (client, userId) => {
  try {
    await client.invoke({
      _: "contacts.addContact",
      id: userId,
      firstName: "User",
      lastName: `ID${userId}`,
      phone: "",
      addPhonePrivacyException: false,
    });
    return true;
  } catch (error) {
    return false;
  }
};

const getChatInfoSafe = async (client, chatId) => {
  try {
    const chat = await client.getEntity(chatId);
    const chatType = getChatType(chat);

    let canWrite = false;
    try {
      if (chat.isGroup || chat.isChannel) {
        const participant = await client.getParticipant(chatId);
        canWrite =
          participant &&
          (participant.adminRights || participant.bannedRights === false);
      } else {
        canWrite = true;
      }
    } catch (permError) {
      console.log(
        `Could not check permissions for ${chatId}, assuming can write`
      );
      canWrite = true;
    }

    return { chatType, canWrite };
  } catch (error) {
    console.log(
      `Could not get entity for ${chatId}, assuming private chat with write access`
    );
    return { chatType: "private", canWrite: true };
  }
};

const sendMessageSafe = async (client, chatId, message) => {
  try {
    await client.sendMessage(chatId, { message });
    return true;
  } catch (error) {
    console.error(`Cannot send message to ${chatId}: ${error.message}`);

    if (
      error.message.includes("Could not find the input entity") &&
      chatId > 0
    ) {
      console.log(`Attempting to add user ${chatId} to contacts...`);
      const added = await tryAddToContacts(client, chatId);
      if (added) {
        try {
          await client.sendMessage(chatId, { message });
          console.log(`Message sent after adding to contacts`);
          return true;
        } catch (retryError) {
          console.error(
            `Still cannot send message after adding to contacts: ${retryError.message}`
          );
        }
      }
    }

    return false;
  }
};

(async () => {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  const sendDelayedMessage = async (chatId, chatType = "private") => {
    if (!hasWorkerResponse(chatId)) {
      const message =
        chatType === "group"
          ? "Thank you for your message! Our team will get back to you shortly. We typically respond within 24 hours during business days."
          : "Thank you for reaching out! I'll review your message and get back to you as soon as possible. If this is urgent, please call our support line.";

      const success = await sendMessageSafe(client, chatId, message);
      if (success) {
        console.log(`Auto-response sent to ${chatType} ${chatId}`);
      }
    }
    chatStates.delete(chatId);
  };

  try {
    await client.start({
      phoneNumber: async () => {
        return await input.text("Enter your phone number (+380…): ");
      },
      password: async () => {
        return await input.text("2FA password (if enabled): ");
      },
      phoneCode: async () => {
        return await input.text("SMS or Telegram code: ");
      },
      onError: (error) => {
        console.error("Authentication error:", error.message);

        if (error.message.includes("FLOOD")) {
          console.log(
            "Too many authentication attempts. Please wait before trying again."
          );
          process.exit(1);
        } else if (error.message.includes("PHONE_CODE_INVALID")) {
          console.log("Invalid phone code. Please check and try again.");
        } else if (error.message.includes("PASSWORD_REQUIRED")) {
          console.log("2FA password is required.");
        } else {
          console.log(
            "Authentication failed. Please check your credentials."
          );
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

    client.addEventHandler(async (event) => {
      const msg = event.message;

      if (msg.out) return;

      const userId = msg.senderId;
      const chatId = msg.chatId;
      const text = msg.text || "";

      const { chatType, canWrite } = await getChatInfoSafe(client, chatId);

      console.log(
        `New message in ${chatType} ${chatId} from ${userId}: ${text}`
      );

      if (!chatStates.has(chatId)) {
        chatStates.set(chatId, {
          firstMessage: true,
          workerResponded: false,
          timer: setTimeout(() => sendDelayedMessage(chatId, chatType), 1200),
        });
        console.log(`Timer set for 2 minutes for ${chatType} ${chatId}`);
      }

      if (chatType === "private" && canWrite) {
        const confirmationMessage =
          "Message received! I'll review and respond shortly.";
        await sendMessageSafe(client, chatId, confirmationMessage);
      } else if (!canWrite) {
        console.log(`Cannot write to ${chatType} ${chatId}, skipping confirmation`);
      }
    }, new NewMessage({}));

    console.log("🎯 Userbot ready for work!");
    console.log("📝 How it works:");
    console.log("1. When a message arrives, a 2-minute timer is set");
    console.log(
      "2. If you don't respond within this time, userbot will auto-reply"
    );
    console.log("3. If you respond manually, the timer is cancelled");
    console.log("4. All responses are sent from your personal account");
    console.log("5. Users will be automatically added to contacts if needed");
  } catch (error) {
    console.error("❌ Failed to start userbot:", error.message);

    if (error.message.includes("FLOOD")) {
      console.log(
        "⚠️ Too many authentication attempts. Please wait before trying again."
      );
    } else if (error.message.includes("API_ID_INVALID")) {
      console.log("❌ Invalid API ID. Please check your credentials.");
    } else if (error.message.includes("API_HASH_INVALID")) {
      console.log("❌ Invalid API Hash. Please check your credentials.");
    } else {
      console.log("❌ Unexpected error occurred.");
    }

    process.exit(1);
  }
})();
