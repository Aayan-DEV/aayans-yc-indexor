# Where the YC data comes from

These built `data/companies.json` and `public/icons/`, which are already committed. You only need to run any of this to
add companies YC has published since.

Run them in this order, from this directory:

```bash
python parse.py source.html      # YC directory HTML -> companies.json + companies.csv
python download.py               # fetch each company's logo -> logos/
python placeholders.py           # lettered tiles for the ones YC has no logo for -> placeholders/
python enrich.py                 # merge YC's open data, then write ../../data/companies.json
python install.py                # copy logos + placeholders into ../../public/icons as yc_<slug>.png
```

Then back in the project root, rebuild what the app derives from it:

```bash
node scripts/read-letters.mjs    # OCR the words inside each logo
node scripts/tag-companies.mjs   # Jev re-tags every company (needs TYPE_SAFE_KEY, about $0.80)
node scripts/build-meaning.mjs   # sentence vectors for every company
npm run atlas                    # repack the sprite sheet
```

`source.html` is YC's directory pages, saved by hand, because the listing is rendered client side.
`yc_oss_all.json` is YC's open data from https://yc-oss.github.io/api/companies/all.json, kept here so the merge runs
offline.

`logos/` and `placeholders/` are not committed. They would be 53 MB byte-identical to `public/icons/`, which is already
in the repo. `download.py` refills `logos/` when you need it, and `install.py` skips anything already installed.

`placeholders.py` needs Pillow: `pip install pillow`.
