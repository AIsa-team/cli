// AIsa for VS Code — the one step `aisa connect` cannot do from outside.
//
// VS Code keeps chat-model API keys in its own encrypted secret store and
// only accepts `${input:chat.lm.secret.<id>}` references in
// chatLanguageModels.json. The core command `lm.addLanguageModelsProviderGroup`
// takes a plain group ({vendor, name, apiKey, apiType, models}), stores the
// key itself and writes the reference — but it can only be invoked by an
// extension. So this extension reads the key `aisa login` saved in
// ~/.aisa/key and calls that command once. Everything stays on the official
// extension API: no secret store, no internal database, no Keychain.
//
// Idempotent: a marker in globalState records which key was provisioned;
// a changed key (rotation) or a missing group re-provisions.

const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const GROUP = { vendor: "customendpoint", name: "AIsa" };
const BASE_URL = "https://api.aisa.one/v1";
const MODELS = [
  { id: "claude-sonnet-5", name: "Claude Sonnet 5 (AIsa)" },
  { id: "claude-opus-5", name: "Claude Opus 5 (AIsa)" },
  { id: "gpt-5.5", name: "GPT-5.5 (AIsa)" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (AIsa)" },
  { id: "kimi-k3", name: "Kimi K3 (AIsa)" },
  { id: "glm-5.2", name: "GLM-5.2 (AIsa)" },
  { id: "qwen3.7-max", name: "Qwen3.7 Max (AIsa)" },
].map((m) => ({
  ...m,
  url: BASE_URL,
  toolCalling: true,
  vision: false,
  maxInputTokens: 200000,
  maxOutputTokens: 32000,
}));

function readKey() {
  const env = process.env.AISA_API_KEY;
  if (env && env.trim()) return env.trim();
  try {
    const k = fs.readFileSync(path.join(os.homedir(), ".aisa", "key"), "utf8").trim();
    return k || undefined;
  } catch {
    return undefined;
  }
}

/** The profile's chatLanguageModels.json: globalStorageUri is
 *  <User>/globalStorage/<publisher.name>, two levels below it. */
function modelsFile(context) {
  return path.join(path.dirname(path.dirname(context.globalStorageUri.fsPath)), "chatLanguageModels.json");
}

function readGroups(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const isOurs = (g) => g && g.vendor === GROUP.vendor && g.name === GROUP.name;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function provision(context, { quiet }) {
  const key = readKey();
  if (!key) {
    if (!quiet) vscode.window.showWarningMessage("AIsa: no key found — run `aisa login` in a terminal, then try again.");
    return false;
  }
  const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
  const file = modelsFile(context);
  const groups = readGroups(file);
  const existing = groups.find(isOurs);
  const done = context.globalState.get("aisa.keyHash") === hash;
  if (existing && typeof existing.apiKey === "string" && existing.apiKey.startsWith("${input:") && done) {
    return true; // already provisioned with this very key
  }

  // A group with that name makes the add command throw, so drop ours from
  // the file first (VS Code watches the file and reloads its view of it).
  if (existing) {
    fs.writeFileSync(file, JSON.stringify(groups.filter((g) => !isOurs(g)), null, "\t") + "\n");
    await sleep(800);
  }

  const payload = { ...GROUP, apiKey: key, apiType: "chat-completions", models: MODELS };
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await vscode.commands.executeCommand("lm.addLanguageModelsProviderGroup", payload);
      await context.globalState.update("aisa.keyHash", hash);
      if (!quiet || !done) {
        vscode.window.setStatusBarMessage(`AIsa: ${MODELS.length} models added to the chat model picker`, 6000);
      }
      return true;
    } catch (e) {
      lastErr = e;
      if (/already exists/i.test(String(e && e.message))) {
        await sleep(800);
        continue;
      }
      break;
    }
  }
  const msg = String((lastErr && lastErr.message) || lastErr);
  if (/command .* not found/i.test(msg)) {
    vscode.window.showWarningMessage(
      "AIsa: this VS Code cannot take the key automatically — open Chat → model picker → Manage Models → AIsa and paste your key once."
    );
  } else if (!quiet) {
    vscode.window.showErrorMessage(`AIsa: could not add the models — ${msg}`);
  }
  return false;
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("aisa.setupModels", () => provision(context, { quiet: false }))
  );
  // Quiet on startup: no dialogs unless something is actually wrong.
  provision(context, { quiet: true }).catch(() => {});
}

function deactivate() {}

module.exports = { activate, deactivate };
