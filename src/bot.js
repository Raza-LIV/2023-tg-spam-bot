import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const TEST_GROUP_ID = process.env.TEST_GROUP_ID;
console.log("Admin Chat ID:", ADMIN_CHAT_ID);
console.log("Test Group ID:", TEST_GROUP_ID);

const chatStates = new Map();

const hasWorkerResponse = (chatId) => {
  const state = chatStates.get(chatId);
  return state?.workerResponded || false;
};

const sendDelayedMessage = (chatId, chatType = "private") => {
  if (!hasWorkerResponse(chatId)) {
    const message =
      chatType === "group"
        ? "Thank you for your message! Our team will get back to you shortly. We typically respond within 24 hours during business days."
        : "Thank you for reaching out! I'll review your message and get back to you as soon as possible. If this is urgent, please call our support line.";

    bot
      .sendMessage(chatId, message)
      .then(() => {
        console.log(`Auto-response sent to ${chatType} ${chatId}`);
      })
      .catch((error) => {
        console.error(
          `Error sending auto-response to ${chatType} ${chatId}:`,
          error.message
        );
      });
  }
  chatStates.delete(chatId);
};

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  bot.sendMessage(chatId, `Bot started! Chat type: ${chatType}`);
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = `Available commands:
/start - Start the bot
/help - Show this message
/myid - Show your chat ID
/reply <text> - Reply as manager (admin only)
/test - Test auto-response after 2 min
/status - Show chat status`;

  bot.sendMessage(chatId, helpText);
});

bot.onText(/\/myid/, (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  bot.sendMessage(
    chatId,
    `Your chat ID: ${chatId}\nChat type: ${chatType}`
  );
});

bot.onText(/\/test/, (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;

  bot.sendMessage(chatId, "Testing auto-response after 2 minutes...");

  chatStates.set(chatId, {
    firstMessage: true,
    workerResponded: false,
    timer: setTimeout(() => sendDelayedMessage(chatId, chatType), 120000),
  });
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const state = chatStates.get(chatId);
  const status = state
    ? `Active timer: ${
        state.workerResponded ? "Response given" : "Waiting for response"
      }`
    : "No active state";
  bot.sendMessage(chatId, `Status: ${status}`);
});

bot.onText(/^\/reply (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const replyText = match[1];

  if (ADMIN_CHAT_ID && chatId.toString() === ADMIN_CHAT_ID.toString()) {
    const targetChatId = process.argv[2] || chatId;

    if (chatStates.has(targetChatId)) {
      const state = chatStates.get(targetChatId);
      state.workerResponded = true;
      clearTimeout(state.timer);
      chatStates.set(targetChatId, state);

      bot.sendMessage(targetChatId, `Manager: ${replyText}`);
      bot.sendMessage(chatId, `Response sent to chat ${targetChatId}`);
    } else {
      bot.sendMessage(chatId, "No active chat for response");
    }
  } else {
    bot.sendMessage(chatId, "You don't have permission for this command");
  }
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const messageText = msg.text || "";

  if (messageText.startsWith("/")) return;

  console.log(`New message in ${chatType} ${chatId}: ${messageText}`);

  if (!chatStates.has(chatId)) {
    chatStates.set(chatId, {
      firstMessage: true,
      workerResponded: false,
      timer: setTimeout(() => sendDelayedMessage(chatId, chatType), 120000),
    });
    console.log(`Timer set for 2 minutes for ${chatType} ${chatId}`);
  }

  if (ADMIN_CHAT_ID && chatId.toString() !== ADMIN_CHAT_ID.toString()) {
    const forwardText = `New message from ${chatType} ${chatId}:\n${messageText}`;

    bot
      .sendMessage(ADMIN_CHAT_ID, forwardText)
      .then(() => {
        console.log("Message forwarded to admin");
      })
      .catch((error) => {
        console.error("Error forwarding to admin:", error.message);
      });
  }

  const confirmationMessage =
    chatType === "group"
      ? "Message received! Manager will be notified."
      : "Message received! Manager will be notified.";

  bot.sendMessage(chatId, confirmationMessage);
});

bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

bot.on("error", (error) => {
  console.error("Bot error:", error);
});

console.log("🎯 Bot ready for testing!");
console.log("📝 For testing:");
console.log("1. Add BOT_TOKEN and ADMIN_CHAT_ID to .env");
console.log("2. Add bot to group and set TEST_GROUP_ID");
console.log("3. Send message to group or bot privately");
console.log("4. Wait for auto-response after 2 minutes or use /reply as admin");
