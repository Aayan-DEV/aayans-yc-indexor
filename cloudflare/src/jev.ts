export type Candidate = { info: string; colors: string };
export type Verdict = { scores: number[]; tokens: number };
export type JevAttempt = { verdict: Verdict | null; reason?: string };
type JevResponse = { answers?: Record<string, { noul?: number }>; usage?: { input_tokens?: number } };
export type JevAi = {
  run(model: "typesafe/jev", input: { state: Record<string, string>; questions: Record<string, unknown> }): Promise<JevResponse>;
};

const ENDPOINT = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
const EVALUATE_ENDPOINT = "https://ai-gateway.vercel.sh/v1/evaluate";
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

function readVerdict(data: JevResponse, count: number): Verdict | null {
  const scores = Array.from({ length: count }, (_, i) => data.answers?.[`c${i}`]?.noul);
  if (scores.some((score) => typeof score !== "number" || !Number.isFinite(score))) return null;
  return { scores: scores.map((score) => Math.max(0, Math.min(1, score!))), tokens: data.usage?.input_tokens ?? 0 };
}

function readEvaluationVerdict(data: { answers?: Record<string, { probability?: number }>; usage?: { inputTokens?: number } }, count: number): Verdict | null {
  const scores = Array.from({ length: count }, (_, i) => data.answers?.[`c${i}`]?.probability);
  if (scores.some((score) => typeof score !== "number" || !Number.isFinite(score))) return null;
  return { scores: scores.map((score) => Math.max(0, Math.min(1, score!))), tokens: data.usage?.inputTokens ?? 0 };
}

/** Judge candidates through Vercel, then use the Worker's AI binding if the gateway fails. */
export async function judgeWithJev(query: string, candidates: Candidate[], batches: string[], key: string | undefined, ai: JevAi): Promise<JevAttempt> {
  if (!key || !candidates.length) return { verdict: null, reason: !key ? "missing_key" : "no_candidates" };
  const questions = Object.fromEntries(candidates.map((candidate, i) => [`c${i}`, {
    type: "noul",
    instructions: {
      candidate: { written_info: candidate.info || "nothing written", measured_colors: candidate.colors },
      question: "Does `candidate` fit what `looking_for` describes?",
    },
  }]));
  const state = { looking_for: query.slice(0, 300), how_to_judge: HOW, today: new Date().toISOString().slice(0, 10), yc_batches_newest_first: batches.join(", ") };
  const body = { model: "typesafe-ai/jev", state, questions };
  let reason = "gateway_unavailable";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const verdict = readVerdict(await response.json() as JevResponse, candidates.length);
        if (verdict) return { verdict };
        reason = "missing_answers";
        break;
      }
      reason = `gateway_http_${response.status}`;
      const detail = await response.json().catch(() => null) as { message?: unknown; error_type?: unknown; error?: { code?: unknown; message?: unknown } } | null;
      console.error(JSON.stringify({
        message: "Jev gateway request failed", status: response.status,
        errorType: typeof detail?.error_type === "string" ? detail.error_type : undefined,
        errorCode: typeof detail?.error?.code === "string" ? detail.error.code : undefined,
        detail: typeof detail?.message === "string" ? detail.message.slice(0, 240) : typeof detail?.error?.message === "string" ? detail.error.message.slice(0, 240) : undefined,
      }));
      if (response.status !== 429 && response.status < 500) return { verdict: null, reason };
      if (response.status === 429) break;
    } catch (error) {
      reason = error instanceof Error && error.name === "TimeoutError" ? "gateway_timeout" : "gateway_network_error";
      console.error(JSON.stringify({ message: "Jev gateway request failed", reason }));
      if (reason === "gateway_timeout") break;
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (reason === "gateway_http_503" || reason === "missing_answers") {
    try {
      const evaluationQuestions = Object.fromEntries(candidates.map((candidate, i) => [`c${i}`, {
        type: "boolean",
        instructions: `Does this candidate fit what looking_for describes? Candidate: ${candidate.info || "nothing written"}. Measured colors: ${candidate.colors}.`,
      }]));
      const response = await fetch(EVALUATE_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "typesafe-ai/jev", state, questions: evaluationQuestions }),
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const verdict = readEvaluationVerdict(await response.json(), candidates.length);
        if (verdict) return { verdict };
      } else {
        const detail = await response.json().catch(() => null) as { message?: unknown; error?: { message?: unknown } } | null;
        console.error(JSON.stringify({ message: "Jev evaluation request failed", status: response.status, detail: typeof detail?.message === "string" ? detail.message.slice(0, 240) : typeof detail?.error?.message === "string" ? detail.error.message.slice(0, 240) : undefined }));
      }
    } catch (error) {
      console.error(JSON.stringify({ message: "Jev evaluation request failed", error: error instanceof Error ? error.name : String(error) }));
    }
  }
  try {
    const verdict = readVerdict(await ai.run("typesafe/jev", { state, questions }), candidates.length);
    if (verdict) {
      console.log(JSON.stringify({ message: "Cloudflare Jev fallback succeeded", gatewayReason: reason }));
      return { verdict };
    }
    console.error(JSON.stringify({ message: "Cloudflare Jev returned incomplete answers" }));
  } catch (error) {
    console.error(JSON.stringify({ message: "Cloudflare Jev request failed", error: error instanceof Error ? error.message : String(error) }));
  }
  return { verdict: null, reason };
}
