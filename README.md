# run.nico.ar

Static Astro site for reading recent training with a lighter interpretation layer.

It is built to stay:

- static-first
- lightweight enough for Pi Zero hosting
- build-friendly on a Raspberry Pi 5
- compatible with local JSON exports from Pacer
- free of client-side secrets and production SSR

## Philosophy

`run.nico.ar` is not a live workout dashboard.

It is the calmer layer that comes after the watch and after Strava: what the session meant, how the week is shaping up, what should carry forward, and how the next race changes the read.

## Stack

- Astro
- TypeScript
- plain CSS
- build-time JSON adapters
- no production backend

## Project structure

```text
run-nico-ar/
  data/
    current/        Generated build snapshots, ignored by Git
    manual/         Editorial and human-maintained JSON
    mocks/          Fallback data for local development
  deploy/
    systemd/        Optional nightly rebuild units
  public/
  scripts/
    prepare-data.ts
    deploy-nightly.sh
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

## Data flow

The source of truth lives in the sibling Pacer repo:

- SQLite session storage
- published CMS snapshots under `../pacer/storage/json/cms/`
- local Strava activity bundle under `../pacer/storage/json/activities.latest.json`

At build time, `run-nico-ar` does this:

1. reads published CMS snapshots from Pacer
2. reads the local Strava activity bundle when it is available
3. optionally reads cached local streams from `../pacer/storage/json/streams/<activityId>.json`
4. optionally reads a TCX file if the published session references one and the file exists in Pacer storage
5. derives technical signal notes into `derived-insights.json`
6. derives race context into `race-context.json`
7. generates the canonical site-facing contract into `site-output.json`
8. derives helper JSON for the site and e-ink endpoints from that canonical output
9. builds a fully static site and e-ink JSON endpoints

There is no runtime database access and no production API dependency from the public site.

## Manual data

These files are source-controlled and intentionally small:

- `data/manual/site-copy.json`
- `data/manual/motivation.json`
- `data/manual/useful-reads-sources.json`
- `data/manual/races.json`

`races.json` is the only race-calendar input for the site.
It is not part of the daily workflow and does not add new per-session form fields.

Example shape:

```json
[
  {
    "slug": "fila-race",
    "title": "FILA Race",
    "date": "2026-04-19",
    "distanceKm": 21,
    "priority": "B"
  },
  {
    "slug": "maratana",
    "title": "MaraTANA",
    "date": "2026-04-26",
    "distanceKm": 15,
    "priority": "B"
  },
  {
    "slug": "carrera-maya",
    "title": "Carrera Maya",
    "date": "2026-05-25",
    "distanceKm": 10,
    "goalTimeMin": 55,
    "priority": "A"
  }
]
```

If `races.json` is empty, the site falls back to a general-build race context.

## Generated data

`scripts/prepare-data.ts` writes these build-time snapshots into `data/current/`:

- `latest-session.json`
- `published-sessions.json`
- `archive-list.json`
- `weekly-summary.json`
- `next-run.json`
- `weather.json`
- `useful-reads.json`
- `coach-feedback.json`
- `derived-insights.json`
- `race-context.json`
- `site-output.json`
- `eink-summary.json`

### Derived insights

`derived-insights.json` is deterministic and built from data already present in the ecosystem:

- manual session type, legs, sleep, restedness, extra notes
- Strava activity summary
- published lap summaries
- route trace
- local stream cache when present
- TCX file when present

It currently infers:

- `sessionIntentDetected`
- `blockStructure`
- `executionQuality`
- `finishPattern`
- `effortCost`
- `cardiacDrift`
- `heatImpact`
- `gpsConfidence`
- `carryForward`
- `nextRunSuggestion`

`derived-insights.json` is the technical engine output.
It can be more diagnostic and does not define the final frontend contract on its own.

### Race context

`race-context.json` combines the latest published session with `data/manual/races.json` and derives:

- `nextRace`
- `daysToRace`
- `targetPaceSecPerKm`
- `targetPaceLabel`
- `currentPhase`
- `focusLabel`
- `sessionRelevance`

### Canonical site output

`site-output.json` is the final site-facing JSON contract.

It is always generated in this exact schema:

```json
{
  "signalTitle": "",
  "signalParagraphs": [],
  "carryForward": "",
  "nextRunTitle": "",
  "nextRunSummary": "",
  "nextRunDurationMin": 0,
  "nextRunDurationMax": 0,
  "nextRunPaceMinSecPerKm": 0,
  "nextRunPaceMaxSecPerKm": 0,
  "weekTitle": "",
  "weekSummary": ""
}
```

The separation is intentional:

- `derived-insights.json`: technical engine output
- `race-context.json`: race-calendar interpretation
- `site-output.json`: final editorial frontend contract
- `coach-feedback.json`, `next-run.json`, `weekly-summary.json`, `eink-summary.json`: helper outputs derived from that contract

## Fallback behavior

The pipeline prefers the richest available local source, in this order:

1. published CMS snapshots from Pacer
2. local Strava bundle for activity context
3. local stream cache, if available
4. local TCX file, if available
5. existing published laps and summary fields
6. mock files in `data/mocks/`

If streams or TCX files are missing, the site still builds cleanly.
The heuristics fall back to lap summaries plus weather/manual notes rather than failing the build.

## Environment

Copy `.env.example` to `.env` only if you need to override local defaults:

```env
PACER_EXPORT_PATH=../pacer/storage/json/activities.latest.json
PACER_CMS_DIR=../pacer/storage/json/cms
PACER_STORAGE_DIR=../pacer/storage
RUN_DATA_SOURCE=auto
```

Available `RUN_DATA_SOURCE` values:

- `auto`: prefer real Pacer data, otherwise use mocks
- `pacer`: require the Pacer snapshots
- `mocks`: always use mock data

## Install

```bash
npm install
```

## Local development

```bash
npm run dev
```

`dev` runs `scripts/prepare-data.ts` first, then starts Astro.

## Data preparation commands

```bash
npm run data:prepare:auto
npm run data:prepare:pacer
npm run data:prepare:mocks
```

## Refresh from Pacer and rebuild

Typical local refresh flow:

```bash
cd /srv/repos/personal/argensonix/labs/pacer
npm run strava:fetch
npm run sessions:publish

cd /srv/repos/personal/argensonix/labs/run-nico-ar
npm run data:prepare:pacer
npm run build
```

High-level flow:

```text
Pacer CMS snapshots
  + local Strava bundle
  + optional streams / TCX
    -> scripts/prepare-data.ts
      -> derived-insights.json
      -> race-context.json
      -> site-output.json
      -> coach-feedback.json / next-run.json / weekly-summary.json / eink-summary.json
        -> Astro build
          -> dist/
```

If you use the existing `Save and publish` flow in Pacer, the publish hook already rebuilds and deploys the public site separately.

## Build

```bash
npm run build
```

This produces a fully static `dist/` directory, including:

- `/`
- `/runs/`
- `/about/`
- static session pages under `/sessions/<slug>/`
- `/eink-summary.json`
- `/eink-summary-v2.json`

## Checks

```bash
npm run check
```

## Deploy by rsync

Production deploy remains a plain static sync:

```bash
rsync -avz --delete dist/ pipita:/srv/data/www/run.nico.ar/
```

## Nightly refresh

This repo also includes a simple nightly rebuild/deploy path for forecast freshness:

- script: `scripts/deploy-nightly.sh`
- user service: `deploy/systemd/run-nico-ar-nightly.service`
- user timer: `deploy/systemd/run-nico-ar-nightly.timer`

That nightly path rebuilds from the latest already-exported local data and rsyncs the result to Pipita.

## Static deployment compatibility

The full flow stays compatible with static hosting because:

- Pacer exports JSON locally
- `run-nico-ar` derives interpretation at build time
- Astro renders static HTML and JSON
- deployment is just `rsync` of `dist/`

No part of the public site needs live secrets, runtime DB access, or server-side session processing in production.
