# Icon Recall

Describe a YC startup in any words you like and the logos that match float up out of a physics pile, each with how likely it is.
All 6,241 companies are searchable by what they do, what their logo looks like, and what they say inside it.

```bash
git clone https://github.com/Aayan-DEV/icon-recall && cd icon-recall && npm install && cp .env.example .env.local && npm run dev
```

Put a TypeSafe key in `.env.local`. Without one, search falls back to a local scorer and the answers get much worse.

Needs an Apple Silicon Mac, because the image model is Core ML. How it all works is in [NOTES.md](NOTES.md).
