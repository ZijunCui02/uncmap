# UNCmap

Interactive map for finding an off-campus rental near **UNC Chapel Hill** — commute
destination, groceries, dining, parks, student neighborhoods, and bus lines on one map.

**Criteria:** 1b1b / studio, or shared 2b2b · in-unit washer & dryer · ≤ $2,000 / person.

## Run locally

```bash
./serve.sh        # → http://127.0.0.1:8765/
./serve.sh 9000   # custom port
```

Asset paths are relative, so `docs/` deploys unchanged to any sub-path.

## Layers

| Layer | Notes |
|:---|:---|
| **Commute destination** | Wilson Hall — the UNC Biology teaching/lab building with the most upper-division class hours (from the BIOL curriculum + class schedules). |
| **Amenities** (41) | groceries, dining, shopping, parks, attractions (OpenStreetMap / official sites) |
| **Neighborhoods** (8) + **listings** (26) | main student-rental areas, by housing type |
| **Bus lines** (17) | Chapel Hill Transit + GoTriangle — real GTFS geometry in official route colors |
| **Campus outline** | real UNC boundary (OpenStreetMap) |

Markers are inline SVG, color-coded per category; bus lines follow real streets (GTFS shapes)
and scale with zoom. Basemap: CARTO Positron (`light_all`) / Dark Matter (`dark_all`), switched
with the theme toggle.

## Layout

```
docs/                  ← published site (GitHub Pages source = /docs)
  index.html           page shell (nav, panels, about)
  map.css  map.js      styling + Leaflet app
  style.css  theme.js  design system
  icons.js             inline SVG glyphs (from assets/icons/*.svg)
  data/                places.json · housing.json · routes.json · campus.json
  vendor/              Leaflet 1.9.4 + markercluster (self-hosted)
  fonts/               CMU Sans
```

## Deploy

GitHub Pages, source = `main` branch `/docs`. Served at **https://zijuncui.com/uncmap/**.
Push to `main` to deploy.

## Data provenance

Layers come from primary sources (UNC catalog + class schedules, official GTFS feeds,
OpenStreetMap / Nominatim). Coordinates marked `approx:true` are area-estimates pending
verification.
