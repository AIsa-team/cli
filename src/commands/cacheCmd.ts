import { cacheDir, clearCache } from "../cache.js";
import { success, hint } from "../utils/display.js";

export function cacheClearAction(): void {
  const removed = clearCache();
  success(removed === 0 ? "Cache already empty." : `Cleared ${removed} cached file(s).`);
  hint(cacheDir());
}

export function cachePathAction(): void {
  console.log(cacheDir());
}
