/**
 * Run tasks with a bounded number in flight.
 *
 * Cold-starting the catalog means ~29 requests and the skills index ~42, both
 * against third parties that rate-limit. Results keep the input order; a task
 * that rejects yields `undefined` rather than failing the whole batch.
 */
export async function pool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void
): Promise<Array<T | undefined>> {
  const results: Array<T | undefined> = new Array(tasks.length);
  let next = 0;
  let done = 0;

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++;
      try {
        results[index] = await tasks[index]();
      } catch {
        results[index] = undefined;
      }
      done++;
      onProgress?.(done, tasks.length);
    }
  });

  await Promise.all(workers);
  return results;
}
