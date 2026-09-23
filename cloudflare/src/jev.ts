export type Candidate = { info: string; colors: string };
export type Verdict = { scores: number[]; tokens: number };
export type JevAttempt = { verdict: Verdict | null; reason?: string };

const ENDPOINT = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
const HOW =
  "`looking_for` is a person's loose description of something they want to find: an image they half remember, a particular company, or a kind of company. " +
  "Each question shows one candidate: `written_info` is what is known about it (for a logo: the company, what it does, industry, place, YC batch) " +
  "and `measured_colors` are automatic pixel measurements, not a person's words. Judge what the company does, where it is and when it started as well as the colors. " +
  "A candidate fits when a person with that company or image in mind could plausibly have written `looking_for`, however vaguely. Several candidates may fit. " +
  "When `looking_for` only talks about looks that a candidate's text can neither confirm nor rule out, answer near 0.5. " +
  "Each candidate's `written_info` ends with its Y Combinator batch, a season and a year, which is a real fact about that company. " +
  "`today` and `yc_batches_newest_first` are given so that newest, latest, recent, current, oldest, early, last year or a named year " +
  "can be judged properly. YC announces batches ahead of time and companies are already in them, so a batch dated after `today` is a " +
  "real batch: the newest or latest batch is simply the one furthest ahead in `yc_batches_newest_first`, whether or not it has started.";

/** Same SystemOne candidate judgement, routed through Vercel AI Gateway. */
export async function judgeWithJev(query: string, candidates: Candidate[], batches: string[], key: string | undefined): Promise<JevAttempt> {
  if (!key || !candidates.length) return { verdict: null, reason: !key ? "missing_key" : "no_candidates" };
  const questions = Object.fromEntries(candidates.map((candidate, i) => [`c${i}`, {
    type: "noul",
    instructions: {
      candidate: { written_info: candidate.info || "nothing written", measured_colors: candidate.colors },
      question: "Does `candidate` fit what `looking_for` describes?",
    },
  }]));
  const body = {
    model: "typesafe-ai/jev",
    state: { looking_for: query.slice(0, 300), how_to_judge: HOW, today: new Date().toISOString().slice(0, 10), yc_batches_newest_first: batches.join(", ") },
    questions,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = performance.now();
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const data = await response.json() as { answers?: Record<string, { noul?: number }>; usage?: { input_tokens?: number } };
        if (!data.answers) return { verdict: null, reason: "missing_answers" };
        return { verdict: {
          scores: candidates.map((_, i) => Math.max(0, Math.min(1, data.answers?.[`c${i}`]?.noul ?? 0.5))),
          tokens: data.usage?.input_tokens ?? 0,
        } };
      }
      console.error("Jev gateway HTTP status", response.status);
      if (response.status !== 429 && response.status < 500) return { verdict: null, reason: `gateway_http_${response.status}` };
    } catch {
      if (performance.now() - started > 2000) return { verdict: null, reason: "gateway_timeout" };
    }
  }
  return { verdict: null, reason: "gateway_unavailable" };
}
