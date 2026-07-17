import { describe, it, expect } from "vitest";
import { handleSSEStream } from "../src/utils/streaming.js";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

describe("handleSSEStream", () => {
  it("emits tokens from a native fetch Response body", async () => {
    const res = sseResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const tokens: string[] = [];
    let done = false;
    await handleSSEStream(
      res,
      (t) => tokens.push(t),
      () => {
        done = true;
      }
    );

    expect(tokens.join("")).toBe("Hello world");
    expect(done).toBe(true);
  });

  it("handles multi-byte characters split across chunks", async () => {
    const encoder = new TextEncoder();
    const line = encoder.encode(
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n'
    );
    // split in the middle of a multi-byte character
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(line.slice(0, 40));
        controller.enqueue(line.slice(40));
        controller.close();
      },
    });
    const res = new Response(stream);

    const tokens: string[] = [];
    await handleSSEStream(res, (t) => tokens.push(t));

    expect(tokens.join("")).toBe("你好");
  });

  it("reports usage to onDone", async () => {
    const res = sseResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n',
      "data: [DONE]\n\n",
    ]);

    let usage: { prompt_tokens: number; completion_tokens: number } | undefined;
    await handleSSEStream(res, () => {}, (u) => {
      usage = u;
    });

    expect(usage).toEqual({ prompt_tokens: 3, completion_tokens: 1 });
  });
});
