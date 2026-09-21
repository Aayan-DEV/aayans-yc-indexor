import { systemOne } from "./call";

/**
 * Before anything is shortlisted, Jev reads the person's words once and answers three things at the same time (one
 * request, so they cost no extra wait): what kind of company it is about, whether they want one thing or every thing
 * that matches, and whether it is about writing inside the picture.
 */
export const ONLY_LOOKS =
  "Only says how a picture looks (colors, shapes, letters, objects in it), nothing about what a company does. " +
  "A year, a date or a Y Combinator batch such as Winter 2019 is a fact about a company, not something you can see in a picture, " +
  "so a request naming one is never this.";

// YC's industry list has no home for "image generation" or "photo editing". Without this option Jev filed them under
// ONLY_LOOKS (0.86, because of the word "image"); with it they land here (0.62) and real look descriptions stay at 0.89+.
export const OTHER = "Some other kind of product, technology or service (for example AI tools, software for a task)";

const TIME_SURE = 0.75; // every company has a date, so only say the date matters when the words actually mention it
const EVERY_SURE = 0.7; // a plain description must not be read as a request for the whole set, so Jev has to be clear about it

export type Understanding = {
  categories: Record<string, number> | null;
  tags: Record<string, number>; // how likely the request is about each of YC's own tags
  every: boolean; // they want all of them, not the one they have in mind
  aboutText: boolean; // they are asking about letters or words written inside the picture
  wantsText: boolean; // and they want the ones that DO have writing, rather than the ones that do not
  aboutTime: boolean; // they care when the company joined Y Combinator
};

const EVERY = {
  question: "Is the person asking for EVERY image or company that has some property, rather than for one particular thing they already have in mind?",
  yes: "The words themselves ask for the whole set, usually with a word like all, every, any, each, or a plural 'the ones': 'companies with red logos', 'all corgi startups', 'every fintech in nigeria', 'logos with letters in them', 'show me the food delivery ones', 'logos with no text in them', 'icons without any words'. A superlative over a group counts too, because it asks for a set rather than for one remembered thing: 'the biggest companies', 'the most famous ones', 'the oldest startups', 'trillion dollar companies'.",
  no: "They are describing one thing they are trying to find, even when they do not say so. A plain description of what a company does or of how a picture looks is this kind: 'economic infrastructure for the internet', 'full stack financial solutions for businesses in india', 'make the world happier with funny posts', 'the book app I saw, it was beige', 'a zebra', 'payments app'.",
  note: "A description on its own is not a request for the whole set. Answer yes only when the words really do ask for all of them.",
};

const WANTS = {
  question: "The person is asking about writing inside the picture. Do they want the pictures that HAVE writing in them, rather than the ones with none?",
  yes: "'logos with letters in them', 'icons with the name written out', 'logos that say pay'.",
  no: "'logos with no text', 'icons without any words', 'just the symbol, no writing'.",
};

const TIME = {
  question: "Do the person's own words say anything about WHEN the company joined Y Combinator: a batch, a year, or a word like newest, latest, recent or oldest?",
  yes: "The timing is part of what they asked for: 'the newest startup', 'the latest batch', 'companies from winter 2019', 'the oldest yc startups', 'recent fintechs', 'who joined last year'.",
  no: "The words say nothing about when, even though every company has a date: 'buy and sell crypto', 'quantum supercomputing', 'self driving cars', 'payments app', 'a red logo', 'startups that deliver food'. Answer no unless timing is actually mentioned.",
};

const TEXT = {
  question: "Is the person asking about letters, words or writing that appear inside the picture itself?",
  yes: "'logos with letters in them', 'icons with no text', 'the one with the company name written out', 'a logo that says hello'.",
  no: "Anything about colour, shape, subject, or what the company does, even when the person's own words mention a name.",
};

const NAME_IT =
  "The state is a person's loose description of something they want to find. Which of these words does what they are asking for " +
  "belong under? They will often not know the term themselves, so judge by what the thing IS, not by the words they happened to use: " +
  "someone who wants their software to work in Chinese is asking about International, whatever they called it.";

export async function understand(query: string, categories: string[], tagGroups: string[][] = []): Promise<Understanding> {
  type Answers = { category?: { probabilities?: Record<string, number> }; every?: { noul: number }; text?: { noul: number }; wants?: { noul: number }; time?: { noul: number } } & Record<
    string,
    { probabilities?: Record<string, number> } | { noul: number } | undefined
  >;
  const data = await systemOne<{ answers: Answers }>(
    {
      state: query.slice(0, 300),
      questions: {
        category: {
          type: "choice",
          instructions: "The state is a person's loose description of something they are trying to find: a startup, or just an image. Which category of company is it most likely about?",
          criteria: Object.fromEntries([...categories, OTHER, ONLY_LOOKS].map((c) => [c, null])),
        },
        every: { type: "noul", instructions: EVERY },
        text: { type: "noul", instructions: TEXT },
        wants: { type: "noul", instructions: WANTS },
        time: { type: "noul", instructions: TIME },
        // The vocabulary is split across questions because one `choice` takes at most 255 options.
        ...Object.fromEntries(tagGroups.map((group, n) => [`tag${n}`, { type: "choice", instructions: NAME_IT, criteria: Object.fromEntries(group.map((t) => [t, null])) }])),
      },
    },
    6000,
  );
  // Each tag question picks one word out of its own half of the vocabulary, so the two answers are read side by side.
  const tags: Record<string, number> = {};
  tagGroups.forEach((_, n) => {
    const answer = data?.answers[`tag${n}`] as { probabilities?: Record<string, number> } | undefined;
    for (const [tag, p] of Object.entries(answer?.probabilities ?? {})) tags[tag] = p;
  });

  return {
    categories: data?.answers.category?.probabilities ?? null,
    tags,
    every: (data?.answers.every?.noul ?? 0) >= EVERY_SURE,
    aboutText: (data?.answers.text?.noul ?? 0) >= 0.5,
    wantsText: (data?.answers.wants?.noul ?? 1) >= 0.5,
    aboutTime: (data?.answers.time?.noul ?? 0) >= TIME_SURE,
  };
}
