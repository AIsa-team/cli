import { describe, expect, it } from "vitest";
import { findVideoUrl } from "../src/commands/video.js";

/**
 * Each vendor buries the finished clip somewhere different, and several also
 * return thumbnails and cover images alongside it.
 */
describe("findVideoUrl", () => {
  it("finds the DashScope shape", () => {
    expect(
      findVideoUrl({ output: { task_status: "SUCCEEDED", video_url: "https://cdn/a.mp4" } })
    ).toBe("https://cdn/a.mp4");
  });

  it("finds the Seedance shape", () => {
    expect(
      findVideoUrl({ data: { content: [{ url: "https://cdn/b.mp4" }] } })
    ).toBe("https://cdn/b.mp4");
  });

  it("prefers a nested video_url over a shallower generic url", () => {
    // The whole tree is searched for an explicitly video-named key before any
    // fallback, so a top-level thumbnail cannot win.
    expect(
      findVideoUrl({
        thumbnail_url: "https://cdn/thumb.jpg",
        cover_url: "https://cdn/cover.jpg",
        output: { video_url: "https://cdn/real.mp4" },
      })
    ).toBe("https://cdn/real.mp4");
  });

  it("falls back to a generic url only when no video-named key exists", () => {
    expect(findVideoUrl({ output: { url: "https://cdn/c.mp4" } })).toBe("https://cdn/c.mp4");
  });

  it("does not mistake a thumbnail for the clip when only a bare url is nested", () => {
    // `thumbnail_url` also ends in "url" and sits closer to the root, so an
    // ends-with-url fallback would download a still image via --output.
    expect(
      findVideoUrl({
        thumbnail_url: "https://cdn/thumb.jpg",
        data: { content: [{ url: "https://cdn/real.mp4" }] },
      })
    ).toBe("https://cdn/real.mp4");
  });

  it("skips still-image keys when falling back to other *_url fields", () => {
    expect(
      findVideoUrl({
        cover_url: "https://cdn/cover.jpg",
        poster_url: "https://cdn/poster.jpg",
        output: { result_url: "https://cdn/real.mp4" },
      })
    ).toBe("https://cdn/real.mp4");
  });

  it("returns nothing rather than a thumbnail when there is no clip", () => {
    expect(findVideoUrl({ thumbnail_url: "https://cdn/thumb.jpg" })).toBeUndefined();
    expect(findVideoUrl({ first_frame_url: "https://cdn/in.png" })).toBeUndefined();
  });

  it("does not let a video-prefixed still-image key beat the real clip", () => {
    // `video_thumbnail_url` matches the video-named pattern too; the exclusion
    // must apply on every pass, not just the fallback.
    expect(
      findVideoUrl({
        video_thumbnail_url: "https://cdn/thumb.jpg",
        video_cover_url: "https://cdn/cover.jpg",
        data: { content: [{ url: "https://cdn/real.mp4" }] },
      })
    ).toBe("https://cdn/real.mp4");
    expect(
      findVideoUrl({
        video_thumbnail_url: "https://cdn/thumb.jpg",
        output: { video_url: "https://cdn/real.mp4" },
      })
    ).toBe("https://cdn/real.mp4");
    expect(findVideoUrl({ video_thumbnail_url: "https://cdn/thumb.jpg" })).toBeUndefined();
  });

  it("ignores non-http values and returns undefined when there is nothing", () => {
    expect(findVideoUrl({ video_url: "pending" })).toBeUndefined();
    expect(findVideoUrl({ status: "queued" })).toBeUndefined();
    expect(findVideoUrl(undefined)).toBeUndefined();
    expect(findVideoUrl(null)).toBeUndefined();
  });
});
