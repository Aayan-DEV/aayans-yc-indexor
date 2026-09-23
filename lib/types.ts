export type SearchHit = {
  id: string;
  title: string;
  tagline?: string; // one line about what the company is, for the tooltip
  detail?: string; // batch and place
  batch?: string;
  place?: string;
  link?: string; // the company's own site, or its YC page when there is none
  yc?: string;
  src: string;
  colors: string[];
  probability: number; // shown on a floating hit: Jev's answer when Jev decided, otherwise the share by looks
  score: number; // final 0..1 share of the library: how much of the match belongs to this image
  similarity: number; // raw MobileCLIP cosine similarity between the words and the image
  jev?: number; // Jev's P(match) from the color words, only when Jev was consulted
};

export type SearchResponse = {
  query: string;
  hits: SearchHit[];
  matches: number; // how many of the best hits are good enough to float up
  mode: "one" | "all"; // "one" ranks a shortlist to find the thing you mean; "all" asks every image whether it qualifies
  confident: boolean; // matches > 0
  degraded?: boolean; // Jev was needed and did not answer: looks alone decided, and the answer was not cached
  jevUnavailableReason?: string; // Non-secret gateway status for diagnosing a degraded Worker search
  judged: number;
  ms: number;
  embedMs: number;
  cached: boolean;
  decidedBy: "mobileclip" | "mobileclip + jev" | "name" | "jev" | "text";
  tokens?: number;
  nominated?: Record<string, unknown>;
  deepened?: string[]; // the tags a second, deeper look followed when the first found nothing convincing
  costUsd?: number;
};

export type LibraryEntry = { id: string; src: string; title: string; addedAt: number; indexMs: number };
