# run.nico.ar

Static Astro site for reading recent training with a lighter layer of interpretation.

It is designed for:

- build on Raspberry Pi 5
- static hosting on Raspberry Pi Zero 2 W
- future e-ink summary consumption
- local JSON ingestion from Pacer or similar exports
- no production SSR and no client-side secret exposure

## Philosophy

`run.nico.ar` is not another live training dashboard.  
It is a post-run reading layer: useful context, restrained visuals, and minimal runtime weight.

## Stack

- Astro
- TypeScript
- Astro server-side rendering at build time only
- Plain CSS with global design tokens
- Local JSON adapters and normalizers

## Project structure

```text
run/
  data/
    current/        Generated build snapshots, gitignored
    manual/         Editorial and human-maintained JSON
    mocks/          Fallback data for local development
  public/
  scripts/
    prepare-data.ts
  src/
    components/
    layouts/
    lib/data/
    pages/
    styles/
  .env.example
  astro.config.mjs
  package.json
  README.md
  tsconfig.json
```

## Data model

### Manual data

These files are source-controlled and meant for light editing:

- `data/manual/coach-feedback.json`
- `data/manual/next-run.json`
- `data/manual/motivation.json`
- `data/manual/site-copy.json`
- `data/manual/session-notes.json`

### Mock data

These files keep the site buildable before real integrations are ready:

- `data/mocks/pacer-export.json`
- `data/mocks/latest-session.json`
- `data/mocks/weekly-summary.json`
- `data/mocks/eink-summary.json`

### Generated data

These files are produced by `scripts/prepare-data.ts` and are ignored by Git:

- `data/current/latest-session.json`
- `data/current/weekly-summary.json`
- `data/current/eink-summary.json`

The site reads `data/current` first and falls back to `data/mocks` when generated files are missing.

## Environment

Copy `.env.example` to `.env` only if you need to override defaults:

```env
PACER_EXPORT_PATH=../pacer/storage/json/activities.latest.json
RUN_DATA_SOURCE=auto
```

Available `RUN_DATA_SOURCE` values:

- `auto`: prefer real Pacer export, otherwise use mocks
- `pacer`: require the Pacer export
- `mocks`: always use mock data

## Install

```bash
npm install
```

## Local development

Auto mode is the default for `dev` and `build`.

```bash
npm run dev
```

If `../pacer/storage/json/activities.latest.json` exists, the project imports it first.
If it does not exist or cannot be normalized, the project writes mock snapshots into `data/current/`.

## Data preparation commands

Use these commands to prepare static snapshots explicitly:

```bash
npm run data:prepare:auto
npm run data:prepare:pacer
npm run data:prepare:mocks
```

## Build

```bash
npm run build
```

This generates a fully static `dist/` directory, including:

- homepage HTML
- `/concept`
- `/eink-summary.json`

## Preview

```bash
npm run preview
```

## Checks

```bash
npm run check
```

## Real Pacer integration

Current integration strategy is import-by-file, not runtime API coupling.

1. Keep Pacer running separately in `/srv/repos/personal/argensonix/labs/pacer`.
2. Refresh its export file:

```bash
cd /srv/repos/personal/argensonix/labs/pacer
npm run strava:fetch
```

3. Prepare Run snapshots:

```bash
cd /srv/repos/personal/argensonix/labs/run
npm run data:prepare:pacer
```

4. Build the static site:

```bash
npm run build
```

### Notes about weather

- If the latest chosen session is also the latest activity in the Pacer export, the importer uses Pacer's `latest_activity_temp_stream` average.
- Otherwise it falls back to `data/manual/session-notes.json`.
- No live weather request happens in production.

## How mocks work

If real data is not ready yet:

```bash
npm run data:prepare:mocks
npm run build
```

This keeps the UI, contracts, and static output working while adapters mature.

## Deploy by rsync

Example static deploy to a Pi Zero host:

```bash
rsync -avz --delete dist/ pizero:/srv/www/run.nico.ar/
```

You can add your own SSH config or remote path conventions on top of this, but the site itself only needs plain static file hosting.

## Preview deploy to Pipita

Preview deploy is kept intentionally simple and does not change site logic.

Target directory on Pipita:

```text
/srv/data/www/run-preview.nico.ar
```

Helper script:

```bash
bash scripts/deploy-preview.sh
```

What it does:

- runs `npm install` only if `node_modules/` is missing
- runs `npm run build`
- ensures the preview directory exists on Pipita
- rsyncs `dist/` into `/srv/data/www/run-preview.nico.ar`

If your SSH host alias is different, pass it explicitly:

```bash
bash scripts/deploy-preview.sh pipita
```

Equivalent npm command:

```bash
npm run deploy:preview
```

If you want the raw commands instead of the helper script:

```bash
npm install
npm run build
ssh pipita "mkdir -p /srv/data/www/run-preview.nico.ar"
rsync -avz --delete dist/ pipita:/srv/data/www/run-preview.nico.ar/
```

## Next integration steps

- Extend the importer with richer lap and block analysis once Strava or Garmin exports are normalized further.
- Add optional private upload workflows without changing the static production architecture.
- Feed the generated `dist/eink-summary.json` into a dedicated e-ink view or polling device.
