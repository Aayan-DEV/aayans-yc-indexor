import { typesafeKey } from "../env";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/**
 * One request to Jev. Returns the parsed answer, or null when Jev cannot be reached: the caller then carries on
 * without it and marks the search as degraded. A failure that comes back quickly (a dropped connection, a 429 or a
 * 5xx) is tried once more; a timeout is not, because waiting twice as long is worse than answering without Jev.
 */
export async function systemOne<T>(body: Record<string, unknown>, timeoutMs: number): Promise<T | null> {
  const key = typesafeKey();
  if (!key) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = performance.now();
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "jev-latest", ...body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status !== 429 && res.status < 500) return null; // the request itself is wrong: asking again changes nothing
    } catch {
      if (performance.now() - started > 2000) return null; // it timed out, or hung for a long while
    }
  }
  return null;
}
