import type { Response } from "node-fetch";

export async function handleSSEStream(
  res: Response,
  onToken: (token: string) => void,
  onDone?: (usage?: { prompt_tokens: number; completion_tokens: number }) => void
): Promise<void> {
  const body = res.body;
  if (!body) throw new Error("No response body");

  let buffer = "";
  let usage: { prompt_tokens: number; completion_tokens: number } | undefined;

  for await (const chunk of body) {
    buffer += chunk.toString();

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;

      if (trimmed === "data: [DONE]") {
        onDone?.(usage);
        return;
      }

      if (trimmed.startsWith("data: ")) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            onToken(delta.content);
          }
          if (json.usage) {
            usage = json.usage;
          }
        } catch {
          // skip malformed JSON chunks
        }
      }
    }
  }

  onDone?.(usage);
}
