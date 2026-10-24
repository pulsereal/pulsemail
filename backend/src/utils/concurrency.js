/**
 * Run `worker` over `items` with at most `limit` in flight. Failures are
 * captured per item so one unreachable mailbox cannot fail the whole batch.
 */
const mapWithConcurrency = async (items, limit, worker) => {
    const results = new Array(items.length);
    let cursor = 0;

    const runners = Array.from(
        { length: Math.min(Math.max(1, limit), items.length || 1) },
        async () => {
            while (cursor < items.length) {
                const index = cursor++;
                try {
                    results[index] = {
                        status: "ok",
                        value: await worker(items[index], index),
                    };
                } catch (error) {
                    results[index] = {
                        status: "error",
                        error: error.message,
                    };
                }
            }
        }
    );

    await Promise.all(runners);
    return results;
};

module.exports = { mapWithConcurrency };
