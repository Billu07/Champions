// Runs `worker` over `items` with at most `limit` tasks in flight at once.
// Each worker pulls the next index until the list is exhausted, so a slow item
// never blocks the others. Workers should handle their own errors; a throw will
// reject the whole run.
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;

  let cursor = 0;
  const size = Math.min(Math.max(1, Math.floor(limit)), items.length);
  const workers = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      await worker(items[current]);
    }
  });
  await Promise.all(workers);
}
