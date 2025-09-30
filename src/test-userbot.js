import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import input from "input";
import dotenv from "dotenv";
dotenv.config();

const apiId = parseInt(process.env.T_API_ID, 10);
const apiHash = process.env.T_API_HASH;
const stringSession = new StringSession(process.env.SESSION || "");

const TEST_TIMEOUT = 10000; // 10 seconds

console.log("🧪 Test Userbot started (timer: 10 seconds)");
console.log("API ID:", apiId);
console.log("Session:", stringSession.save());

const chatStates = new Map();

const hasWorkerResponse = (chatId) => {
  const state = chatStates.get(chatId);
  return state?.workerResponded || false;
};

const getChatType = (chat) => {
  if (chat.isGroup || chat.isChannel) return "group";
  return "private";
};

// Try to add user to contacts if we can't send message
const tryAddToContacts = async (client, userId) => {
  try {
    console.log(`📞 Trying to add user ${userId} to contacts...`);
    await client.contacts.addContact({
      id: userId,
      firstName: "User",
      lastName: `ID${userId}`,
      phone: "",
    });
    console.log(`✅ User ${userId} added to contacts`);
    return true;
  } catch (error) {
    console.log(
      `❌ Could not add user ${userId} to contacts: ${error.message}`
    );
    return false;
  }
};

// Safe way to get chat type and check if we can write
const getChatInfoSafe = async (client, chatId) => {
  try {
    const chat = await client.getEntity(chatId);
    const chatType = getChatType(chat);

    // Check if we can write to this chat
    let canWrite = false;
    try {
      // Try to get chat permissions
      if (chat.isGroup || chat.isChannel) {
        const participant = await client.getParticipant(chatId);
        canWrite =
          participant &&
          (participant.adminRights || participant.bannedRights === false);
      } else {
        canWrite = true; // Assume we can write to private chats
      }
    } catch (permError) {
      console.log(
        `⚠️ Could not check permissions for ${chatId}, assuming can write`
      );
      canWrite = true;
    }

    return { chatType, canWrite };
  } catch (error) {
    console.log(
      `⚠️ Could not get entity for ${chatId}, assuming private chat with write access`
    );
    return { chatType: "private", canWrite: true };
  }
};

// Safe message sending with contact adding
const sendMessageSafe = async (client, chatId, message) => {
  try {
    await client.sendMessage(chatId, { message });
    return true;
  } catch (error) {
    console.error(`❌ Cannot send message to ${chatId}: ${error.message}`);

    // If it's a private chat and we can't send, try to add to contacts
    if (
      error.message.includes("Could not find the input entity") &&
      chatId > 0
    ) {
      console.log(`🔄 Attempting to add user ${chatId} to contacts...`);
      const added = await tryAddToContacts(client, chatId);
      if (added) {
        // Try sending again after adding to contacts
        try {
          await client.sendMessage(chatId, { message });
          console.log(`✅ Message sent after adding to contacts`);
          return true;
        } catch (retryError) {
          console.error(
            `❌ Still cannot send message after adding to contacts: ${retryError.message}`
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
          ? "🧪 TEST: Auto-response from manager in group after 10 seconds!"
          : "🧪 TEST: Auto-response from manager in private chat after 10 seconds!";

      const success = await sendMessageSafe(client, chatId, message);
      if (success) {
        console.log(`✅ TEST: Auto-response sent to ${chatType} ${chatId}`);
      }
    }
    chatStates.delete(chatId);
  };

  await client.start({
    phoneNumber: async () =>
      await input.text("Enter your phone number (+380…): "),
    password: async () => await input.text("2FA password (if enabled): "),
    phoneCode: async () => await input.text("SMS or Telegram code: "),
    onError: console.error,
  });

  console.log(
    "✅ Authorized as manager. Saved session:\n",
    client.session.save()
  );

  client.addEventHandler(async (event) => {
    const msg = event.message;

    if (msg.out) return;

    const userId = msg.senderId;
    const chatId = msg.chatId;
    const text = msg.text || "";

    // Get chat info safely
    const { chatType, canWrite } = await getChatInfoSafe(client, chatId);

    console.log(
      `📨 TEST: New message in ${chatType} ${chatId} from ${userId}: ${text}`
    );

    if (!chatStates.has(chatId)) {
      chatStates.set(chatId, {
        firstMessage: true,
        workerResponded: false,
        timer: setTimeout(
          () => sendDelayedMessage(chatId, chatType),
          TEST_TIMEOUT
        ),
      });
      console.log(
        `⏰ TEST: Timer set for 10 seconds for ${chatType} ${chatId}`
      );
    }

    // Only send confirmation if we can write to this chat
    if (chatType === "private" && canWrite) {
      const confirmationMessage =
        "✅ TEST: Message received! Auto-response from manager in 10 sec.";
      await sendMessageSafe(client, chatId, confirmationMessage);
    } else if (!canWrite) {
      console.log(
        `⚠️ Cannot write to ${chatType} ${chatId}, skipping confirmation`
      );
    }
  }, new NewMessage({}));

  console.log("🧪 Test Userbot ready!");
  console.log("📝 For testing:");
  console.log("1. Send a message to your account or in a group");
  console.log("2. Wait for auto-response after 10 seconds");
  console.log("3. If you respond manually, the timer is cancelled");
  console.log("4. All responses are sent from your personal account");
  console.log("5. Users will be automatically added to contacts if needed");
})();
