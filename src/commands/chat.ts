import ora from "ora";
import chalk from "chalk";
import { requireApiKey, getConfig } from "../config.js";
import { apiRequest, apiRequestRaw } from "../api.js";
import { error } from "../utils/display.js";
import { handleSSEStream } from "../utils/streaming.js";
import type { ChatResponse } from "../types.js";

export async function chatAction(
  message: string | undefined,
  options: {
    model?: string;
    system?: string;
    stream?: boolean;
    json?: boolean;
    maxTokens?: string;
    temperature?: string;
  }
): Promise<void> {
  const key = requireApiKey();

  // Read from stdin if no message provided
  let text = message;
  if (!text) {
    if (process.stdin.isTTY) {
      error("Provide a message or pipe input: echo 'hello' | aisa chat");
      process.exit(1);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    text = Buffer.concat(chunks).toString("utf-8").trim();
  }

  if (!text) {
    error("Empty message");
    process.exit(1);
  }

  const model = options.model || (getConfig("defaultModel") as string) || "gpt-4.1";
  const stream = options.stream !== false; // default true

  const messages: Array<{ role: string; content: string }> = [];
  if (options.system) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push({ role: "user", content: text });

  const body: Record<string, unknown> = { model, messages, stream };
  if (options.maxTokens) body.max_tokens = parseInt(options.maxTokens);
  if (options.temperature) body.temperature = parseFloat(options.temperature);

  if (stream) {
    const res = await apiRequestRaw(key, "chat/completions", {
      method: "POST",
      body,
      headers: { Accept: "text/event-stream" },
    });

    if (!res.ok) {
      const text = await res.text();
      error(`${res.status}: ${text}`);
      return;
    }

    await handleSSEStream(
      res,
      (token) => process.stdout.write(token),
      (usage) => {
        console.log();
        if (usage) {
          console.log(
            chalk.gray(
              `  ${model} · ${usage.prompt_tokens} in / ${usage.completion_tokens} out`
            )
          );
        }
      }
    );
  } else {
    const spinner = ora(`${model}...`).start();

    const res = await apiRequest<ChatResponse>(key, "chat/completions", {
      method: "POST",
      body,
    });

    if (!res.success || !res.data) {
      spinner.fail("Chat failed");
      error(res.error || "Unknown error");
      return;
    }

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(res.data, null, 2));
    } else {
      console.log(res.data.choices[0].message.content);
      if (res.data.usage) {
        console.log(
          chalk.gray(
            `\n  ${model} · ${res.data.usage.prompt_tokens} in / ${res.data.usage.completion_tokens} out`
          )
        );
      }
    }
  }
}
