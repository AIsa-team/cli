import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHAT_MODEL } from "../src/constants.js";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  apiRequest: vi.fn(),
  apiRequestRaw: vi.fn(),
  handleSSEStream: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
  requireAccessToken: async () => "test-token",
  getConfig: mocks.getConfig,
}));
vi.mock("../src/api.js", () => ({
  apiRequest: mocks.apiRequest,
  apiRequestRaw: mocks.apiRequestRaw,
}));
vi.mock("../src/utils/streaming.js", () => ({ handleSSEStream: mocks.handleSSEStream }));
vi.mock("ora", () => ({ default: () => ({ start: () => ({ stop: vi.fn(), fail: vi.fn() }) }) }));

import { chatAction } from "../src/commands/chat.js";

describe("chat model selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockReturnValue(undefined);
    mocks.apiRequest.mockResolvedValue({ success: true, data: { choices: [{ message: { content: "hello" } }] } });
    mocks.apiRequestRaw.mockResolvedValue(new Response("", { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  for (const stream of [true, false]) {
    for (const { name, configured, explicit, expected } of [
      { name: "uses the trial-available default when unset", configured: undefined, explicit: undefined, expected: DEFAULT_CHAT_MODEL },
      { name: "uses the default for an empty configuration", configured: "", explicit: undefined, expected: DEFAULT_CHAT_MODEL },
      { name: "preserves a saved model", configured: "saved-model", explicit: undefined, expected: "saved-model" },
      { name: "prefers --model over the saved model", configured: "saved-model", explicit: "explicit-model", expected: "explicit-model" },
    ]) {
      it(`${name} (${stream ? "streaming" : "non-streaming"})`, async () => {
        mocks.getConfig.mockReturnValue(configured);
        await chatAction("hello", { stream, model: explicit });
        const request = stream ? mocks.apiRequestRaw : mocks.apiRequest;
        expect(request).toHaveBeenCalledWith("test-token", "chat/completions", expect.objectContaining({
          method: "POST", body: { model: expected, messages: [{ role: "user", content: "hello" }], stream },
        }));
        expect(stream ? mocks.apiRequest : mocks.apiRequestRaw).not.toHaveBeenCalled();
        if (stream) expect(mocks.handleSSEStream).toHaveBeenCalledOnce();
      });
    }
  }
});
