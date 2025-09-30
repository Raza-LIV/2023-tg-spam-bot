import express from "express";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const CONFIG_FILE = path.join(__dirname, "..", "config.json");

let userbotProcess = null;
let authData = null;

async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return {
      T_API_ID: "",
      T_API_HASH: "",
      SESSION: "",
    };
  }
}

async function saveConfig(config) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function isUserbotRunning() {
  return userbotProcess && !userbotProcess.killed;
}

async function sendTelegramCode(apiId, apiHash, phoneNumber) {
  try {
    await saveConfig({
      T_API_ID: apiId,
      T_API_HASH: apiHash,
      SESSION: (await loadConfig()).SESSION || "",
    });

    const tempProcess = spawn("node", ["src/send-code.js"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        T_API_ID: apiId,
        T_API_HASH: apiHash,
        PHONE_NUMBER: phoneNumber,
      },
    });

    return new Promise((resolve, reject) => {
      let codeSent = false;
      let codeTimeout;

      tempProcess.stdout.on("data", (data) => {
        const output = data.toString();
        console.log("Send Telegram code stdout:", output);

        if (output.includes("WAITING_FOR_CODE")) {
          if (!codeSent) {
            codeSent = true;
            clearTimeout(codeTimeout);

            global.authProcess = tempProcess;

            resolve({
              success: true,
              message: "Code sent to Telegram! Check your messages.",
            });
          }
        } else if (output.includes("AUTH_SUCCESS")) {
          console.log("Authentication completed successfully");
          tempProcess.kill("SIGTERM");
          global.authProcess = null;
        }
      });

      tempProcess.stderr.on("data", (data) => {
        const error = data.toString();
        console.log("Send Telegram code stderr:", error);

        if (error.includes("AUTH_ERROR:")) {
          const errorMessage = error.split("AUTH_ERROR:")[1].trim();
          clearTimeout(codeTimeout);
          tempProcess.kill("SIGTERM");
          global.authProcess = null;

          if (error.includes("FLOOD")) {
            resolve({
              success: false,
              message:
                "Too many attempts. Please wait before trying again.",
            });
          } else if (error.includes("PHONE_NUMBER_INVALID")) {
            resolve({
              success: false,
              message: "Invalid phone number. Check the format.",
            });
          } else if (error.includes("PHONE_CODE_EXPIRED")) {
            resolve({
              success: false,
              message: "Code expired. Request a new code.",
            });
          } else {
            resolve({ success: false, message: errorMessage });
          }
        }
      });

      tempProcess.on("close", (code) => {
        console.log(`Send Telegram code process exited with code ${code}`);
        if (!codeSent) {
          clearTimeout(codeTimeout);
          resolve({
            success: false,
            message: "Failed to send code to Telegram",
          });
        }
      });

      tempProcess.on("error", (error) => {
        console.error("Send Telegram code process error:", error);
        clearTimeout(codeTimeout);
        resolve({
          success: false,
          message: `Process error: ${error.message}`,
        });
      });

      codeTimeout = setTimeout(() => {
        if (!codeSent) {
          tempProcess.kill("SIGTERM");
          resolve({
            success: false,
            message: "Timeout sending code to Telegram",
          });
        }
      }, 30000);
    });
  } catch (error) {
    console.error("Error sending Telegram code:", error);
    return {
      success: false,
      message: `Error sending code to Telegram: ${error.message}`,
    };
  }
}

async function authenticateUser(apiId, apiHash, authInfo) {
  try {
    if (!global.authProcess || global.authProcess.killed) {
      return { success: false, message: "You must send the code first" };
    }
    const tempProcess = global.authProcess;

    return new Promise((resolve, reject) => {
      let authCompleted = false;
      let authTimeout;
      let waitingFor2FA = false;

      tempProcess.stdin.write(authInfo.phoneCode + "\n");

      tempProcess.stdout.on("data", (data) => {
        const output = data.toString();
        console.log("Auth stdout:", output);

        if (output.includes("2FA_NEEDED")) {
          waitingFor2FA = true;
          if (authInfo.password) {
            tempProcess.stdin.write(authInfo.password + "\n");
          } else {
            clearTimeout(authTimeout);
            tempProcess.kill("SIGTERM");
            global.authProcess = null;
            resolve({
              success: false,
              needs2FA: true,
              message: "2FA password required",
            });
          }
        } else if (output.includes("AUTH_SUCCESS") && !authCompleted) {
          authCompleted = true;
          clearTimeout(authTimeout);

          setTimeout(async () => {
            try {
              const config = await loadConfig();
              resolve({
                success: true,
                message: "Authentication successful! Session saved.",
              });
            } catch (error) {
              resolve({ success: false, message: "Failed to save session" });
            }
          }, 1000);
        }
      });

      tempProcess.stderr.on("data", (data) => {
        const error = data.toString();
        console.log("Auth stderr:", error);

        if (error.includes("AUTH_ERROR:")) {
          const errorMessage = error.split("AUTH_ERROR:")[1].trim();
          clearTimeout(authTimeout);
          tempProcess.kill("SIGTERM");
          global.authProcess = null;

          if (error.includes("PASSWORD_HASH_INVALID")) {
            resolve({
              success: false,
              needs2FA: true,
              message: "Invalid 2FA password",
            });
          } else if (error.includes("PHONE_CODE_INVALID")) {
            resolve({
              success: false,
              message: "Invalid code. Check and try again.",
            });
          } else {
            resolve({ success: false, message: errorMessage });
          }
        }
      });

      authTimeout = setTimeout(() => {
        if (!waitingFor2FA) {
          tempProcess.kill("SIGTERM");
          global.authProcess = null;
          resolve({ success: false, message: "Authentication timed out" });
        }
      }, 60000);
    });
  } catch (error) {
    console.error("Error during authentication:", error);
    return { success: false, message: `Authentication error: ${error.message}` };
  }
}

async function startUserbot(apiId, apiHash) {
  if (isUserbotRunning()) {
    return { success: false, message: "Userbot is already running" };
  }

  try {
    const config = await loadConfig();
    if (!config.SESSION || config.SESSION.length === 0) {
      return { success: false, message: "You need to authenticate first" };
    }

    userbotProcess = spawn("node", ["src/userbot.js"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        T_API_ID: apiId,
        T_API_HASH: apiHash,
      },
    });

    userbotProcess.stdout.on("data", (data) => {
      console.log("Userbot stdout:", data.toString());
    });

    userbotProcess.stderr.on("data", (data) => {
      console.log("Userbot stderr:", data.toString());
    });

    userbotProcess.on("close", (code) => {
      console.log(`Userbot process exited with code ${code}`);
      userbotProcess = null;
    });

    userbotProcess.on("error", (error) => {
      console.error("Userbot process error:", error);
      userbotProcess = null;
    });

    return { success: true, message: "Userbot started successfully" };
  } catch (error) {
    console.error("Error starting userbot:", error);
    return { success: false, message: `Startup error: ${error.message}` };
  }
}

async function stopUserbot() {
  if (!isUserbotRunning()) {
    return { success: false, message: "Userbot is not running" };
  }

  try {
    userbotProcess.kill("SIGTERM");

    setTimeout(() => {
      if (userbotProcess && !userbotProcess.killed) {
        userbotProcess.kill("SIGKILL");
      }
    }, 5000);

    return { success: true, message: "Userbot stopped" };
  } catch (error) {
    console.error("Error stopping userbot:", error);
    return { success: false, message: `Stop error: ${error.message}` };
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/send-code", async (req, res) => {
  const { apiId, apiHash, phoneNumber } = req.body;

  if (!apiId || !apiHash || !phoneNumber) {
    return res.json({
      success: false,
      message: "API ID, API Hash and phone number are required",
    });
  }

  const result = await sendTelegramCode(apiId, apiHash, phoneNumber);
  res.json(result);
});

app.post("/auth", async (req, res) => {
  const { apiId, apiHash, phoneNumber, phoneCode, password } = req.body;

  if (!apiId || !apiHash || !phoneNumber || !phoneCode) {
    return res.json({
      success: false,
      message: "API ID, API Hash, phone number and SMS code are required",
    });
  }

  const authInfo = {
    phoneNumber,
    phoneCode,
    password,
  };

  const result = await authenticateUser(apiId, apiHash, authInfo);
  res.json(result);
});

app.post("/start", async (req, res) => {
  const { apiId, apiHash } = req.body;

  if (!apiId || !apiHash) {
    return res.json({
      success: false,
      message: "API ID and API Hash are required",
    });
  }

  const result = await startUserbot(apiId, apiHash);
  res.json(result);
});

app.post("/stop", async (req, res) => {
  const result = await stopUserbot();
  res.json(result);
});

app.get("/status", (req, res) => {
  const status = isUserbotRunning() ? "running" : "stopped";
  res.json({ status });
});

app.get("/config", async (req, res) => {
  try {
    const config = await loadConfig();
    res.json({ success: true, config });
  } catch (error) {
    res.json({ success: false, message: "Configuration load error" });
  }
});

process.on("SIGINT", async () => {
  console.log("Shutting down server...");
  if (isUserbotRunning()) {
    await stopUserbot();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Web server running on http://localhost:${PORT}`);
  console.log(`📁 Config file: ${CONFIG_FILE}`);
});
