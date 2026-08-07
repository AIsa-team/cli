import { describe, expect, it } from "vitest";
import { buildVideoBody, parseBodyOverride, parseMedia } from "../src/commands/video.js";
import { videoModelSpec } from "../src/constants.js";

/**
 * The gateway rewrites only the top-level `model` and forwards the rest, so each
 * vendor's body shape has to be built correctly here. All three shapes below
 * were confirmed against the live API; a Bailian body sent to Seedance is
 * rejected with a 400, and an i2v request without media is accepted at
 * submission and only fails a minute later, after billing.
 */
describe("buildVideoBody", () => {
  it("builds the Bailian shape for wan/happyhorse models", () => {
    expect(buildVideoBody("wan2.7-t2v", "a cat", [], {})).toEqual({
      model: "wan2.7-t2v",
      input: { prompt: "a cat" },
      parameters: { resolution: "720P", duration: 5 },
    });
  });

  it("builds the Seedance content array, not input/parameters", () => {
    expect(
      buildVideoBody("dreamina-seedance-2-0-fast-260128", "a cat", [], {
        resolution: "1080P",
        duration: "10",
      })
    ).toEqual({
      model: "dreamina-seedance-2-0-fast-260128",
      content: [{ type: "text", text: "a cat" }],
    });
  });

  it("nests media under input for image-driven Bailian models", () => {
    const media = [{ type: "first_frame" as const, url: "https://img/a.png" }];
    expect(buildVideoBody("wan2.7-i2v", "rotate", media, {})).toEqual({
      model: "wan2.7-i2v",
      input: { prompt: "rotate", media },
      parameters: { resolution: "720P", duration: 5 },
    });
  });

  it("honours resolution and duration overrides", () => {
    const body = buildVideoBody("wan2.7-t2v", "a cat", [], {
      resolution: "1080P",
      duration: "10",
    }) as { parameters: { resolution: string; duration: number } };
    expect(body.parameters).toEqual({ resolution: "1080P", duration: 10 });
  });
});

describe("videoModelSpec", () => {
  it("knows which models need source media", () => {
    expect(videoModelSpec("wan2.7-t2v").requiresMedia).toBeUndefined();
    expect(videoModelSpec("wan2.7-i2v").requiresMedia).toBe("first_frame");
    expect(videoModelSpec("wan2.7-r2v").requiresMedia).toBe("first_clip");
    expect(videoModelSpec("happyhorse-1.1-i2v").requiresMedia).toBe("first_frame");
  });

  it("infers the family of unlisted models by prefix so new revisions work", () => {
    expect(videoModelSpec("wan9.9-i2v")).toEqual({
      family: "bailian",
      requiresMedia: "first_frame",
    });
    expect(videoModelSpec("dreamina-seedance-3-0-future").family).toBe("seedance");
  });
});

describe("parseBodyOverride", () => {
  it("keeps the model named in --body when no --model is given", () => {
    // --body means "send this verbatim"; silently retargeting the request at
    // the CLI's default model would be the opposite of that.
    expect(
      parseBodyOverride('{"model":"dreamina-seedance-2-0-260128","content":[{"type":"text","text":"x"}]}')
    ).toEqual({
      model: "dreamina-seedance-2-0-260128",
      content: [{ type: "text", text: "x" }],
    });
  });

  it("lets an explicit --model override the body", () => {
    expect(parseBodyOverride('{"model":"a","foo":1}', "b")).toEqual({ model: "b", foo: 1 });
  });

  it("fills in the default only when the body names no model", () => {
    expect(parseBodyOverride('{"input":{"prompt":"x"}}')).toEqual({
      model: "wan2.7-t2v",
      input: { prompt: "x" },
    });
  });

  it("rejects payloads that are not JSON objects", () => {
    // JSON.parse happily accepts all of these.
    expect(() => parseBodyOverride("{bad")).toThrow(/valid JSON/);
    expect(() => parseBodyOverride("null")).toThrow(/JSON object/);
    expect(() => parseBodyOverride("[]")).toThrow(/JSON object/);
    expect(() => parseBodyOverride("3")).toThrow(/JSON object/);
    expect(() => parseBodyOverride('"str"')).toThrow(/JSON object/);
  });
});

describe("required media", () => {
  it("is satisfied only by the type the model asks for", () => {
    // Supplying a first_clip to an i2v model fails upstream exactly like
    // supplying nothing — after the job is accepted and billed.
    const spec = videoModelSpec("wan2.7-i2v");
    const wrong = parseMedia(["first_clip=https://v/a.mp4"]);
    const right = parseMedia(["first_frame=https://i/a.png"]);

    expect(wrong.some((m) => m.type === spec.requiresMedia)).toBe(false);
    expect(right.some((m) => m.type === spec.requiresMedia)).toBe(true);
  });
});

describe("parseMedia", () => {
  it("treats --image as first_frame", () => {
    expect(parseMedia([], ["https://img/a.png"])).toEqual([
      { type: "first_frame", url: "https://img/a.png" },
    ]);
  });

  it("parses type=url pairs, keeping URLs containing '='", () => {
    expect(parseMedia(["first_clip=https://v/a.mp4?sig=abc=="])).toEqual([
      { type: "first_clip", url: "https://v/a.mp4?sig=abc==" },
    ]);
  });

  it("rejects unknown types and malformed specs", () => {
    expect(() => parseMedia(["img_url=https://x"])).toThrow(/Unknown media type/);
    expect(() => parseMedia(["https://x"])).toThrow(/Use type=url/);
    expect(() => parseMedia(["first_frame="])).toThrow(/Missing URL/);
  });
});
