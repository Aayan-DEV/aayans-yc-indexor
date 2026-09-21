import { systemOne } from "./call";

export type Candidate = { info: string | null; colors: string };
export type When = { today: string; batches: string };
export type Verdict = { scores: number[]; tokens: number };

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

/**
 * Jev reads everything known about each finalist, its written info and its measured colors, and says how likely it is
 * the one the person means. The description is the state and every finalist is one short question, so it is a single call.
 */
export async function judge(query: string, candidates: Candidate[], when?: When): Promise<Verdict | null> {
  if (!candidates.length) return null;
  const questions: Record<string, unknown> = {};
  candidates.forEach((c, i) => {
    questions[`c${i}`] = {
      type: "noul",
      instructions: { candidate: { written_info: c.info ?? "nothing written", measured_colors: c.colors }, question: "Does `candidate` fit what `looking_for` describes?" },
    };
  });
  // Jev refines the ranking, it is never a dependency: without it the image model's order stands, and the search says it is degraded.
  const data = await systemOne<{ answers: Record<string, { noul: number }>; usage?: { input_tokens?: number } }>({ state: { looking_for: query.slice(0, 300), how_to_judge: HOW, ...(when && { today: when.today, yc_batches_newest_first: when.batches }) }, questions }, 8000);
  return data ? { scores: candidates.map((_, i) => data.answers[`c${i}`]?.noul ?? 0.5), tokens: data.usage?.input_tokens ?? 0 } : null;
}
