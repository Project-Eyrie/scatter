<div align="center">

<img src="static/scatter_logo.png" alt="Scatter" width="120" height="120" />

# Scatter

> A browser-based mapping and geospatial analysis tool.

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![In Project Eyrie](https://img.shields.io/badge/IN-PROJECT%20EYRIE-b45309?style=for-the-badge&labelColor=0f172a)](https://github.com/Project-Eyrie)
![WEB](https://img.shields.io/badge/TYPE-WEB-0369a1?style=for-the-badge&labelColor=0f172a)

</div>

---

## Overview

**Scatter** is a web-based geospatial toolkit built for researchers, analysts, and anyone who needs to organize locations visually. It combines pin placement, drawing tools, route planning, and distance analysis into a single map interface with shareable compressed URLs and full JSON export/import.

---

## Features

- **Pin Management** - Place, search, filter, label, and organize map markers with reverse geocoding, custom icons, and color-coded layers
- **Custom Pin Icons** - Choose from 25+ icons (home, airport, restaurant, hospital, school, star, crosshair, shield, etc.) per pin
- **Drawing Tools** - Create paths, arrows, polygons, circles, and text notes with customizable stroke widths and animated/directional paths
- **Measurement** - Measure distances between points with per-segment labels, total distance, and area/perimeter calculations for polygons
- **Route Planning** - Build multi-waypoint routes with driving/walking modes, per-segment details, total distance/time, and save routes as drawing paths
- **Nearby Search** - Find restaurants, parks, and other places within a configurable radius using Google Places
- **Distance Matrix** - View color-coded straight-line distance comparisons between all visible pins
- **Layer System** - Organize pins and drawings into named, color-coded groups with visibility toggles
- **Marker Clustering** - Automatically groups nearby pins at lower zoom levels with cluster stats popup showing layer breakdown and time range
- **Timeline** - Scrub through timestamped pins and drawings chronologically with adjustable playback speed and per-layer filtering
- **Heatmap** - Toggle a heatmap overlay to visualize pin density
- **Street View** - Integrated Google Street View for any selected pin
- **Crowd Estimation** - Estimate crowd capacity for polygon and circle areas at four density levels
- **Travel Calculator** - Estimate walking and driving times for a given distance and speed range
- **Undo History** - Full undo/redo with a visual history panel showing timestamped entries and jump-to navigation
- **Link Sharing** - Compress full map state (including timestamps and view settings) into a shareable URL using DeflateRaw with optional AES-GCM encryption
- **Embed & Readonly Modes** - Generate share links with embed mode (map only, no UI) or readonly mode (browsing only, no editing) via checkboxes or URL params
- **Image Export** - Export the current map view as a PNG screenshot
- **Import / Export** - Save and restore map state via JSON files, or import/export location data as CSV with auto-detected column mapping
- **Pin Search & Filtering** - Filter pins by name, layer, and timestamp status in the sidebar

---

## How to Use

### About the App

Scatter opens to a full-screen Google Map. Right-click anywhere to place a pin or search nearby places. Use the sidebar to manage layers, pins, routes, and drawings. The bottom panel provides street view, a distance matrix, property editing, undo history, and a travel calculator. Share your map via compressed URL or export it as JSON/CSV.

### Interface

| Area | Description |
|------|-------------|
| **Header** | File menu (import/export JSON, CSV, image), Edit menu (undo, redo, clear), live cursor coordinates, and share button |
| **Sidebar** | Google Places search bar, layer management, and tabbed panels for pins, routes, and annotations with search and filtering |
| **Map** | Google Maps canvas with right-click context menu for pin placement and nearby search |
| **Map Controls** | Left-side overlay with satellite toggle, 3D tilt, marker clustering settings, and timeline scrubber |
| **Drawing Toolbar** | Floating toolbar for selecting drawing tools (path, arrow, polygon, circle, note, measure), stroke width, and finishing drawings |
| **Bottom Panel** | Resizable panel with tabs for distance matrix, street view, travel calculator, and undo history, plus a properties editor for selected pins/drawings |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + Z` | Undo |
| `Ctrl + Shift + Z` / `Ctrl + Y` | Redo |
| `Delete` / `Backspace` | Remove selected pin or drawing |
| `Enter` | Finish current drawing |
| `Escape` | Close modal |

---

## Theory and Background

### Link Sharing

Map state is serialized to compact JSON with single-letter keys, compressed with DeflateRaw via the browser CompressionStream API, encoded as URL-safe base64, and stored in the URL hash fragment. Timestamps, view settings, embed/readonly flags, and waypoint references are all encoded. An optional password adds AES-GCM encryption with PBKDF2 key derivation (100,000 iterations). The total URL is capped at 32,000 characters for cross-browser compatibility.

### Geographic Calculations

Distance calculations use the Haversine formula. Polygon areas use the spherical excess method. Label placement uses Mercator projection math for overlap resolution. Crowd estimation multiplies area by configurable density levels (0.5 to 5 people per m²).

---

## Notes

- **Browser** - Desktop only (1024px+ screen width), requires CompressionStream API (Chrome 80+, Firefox 113+, Safari 16.4+, Edge 80+)
- **API Key** - Requires a Google Maps JavaScript API key with Places, Geocoding, Directions, and Street View enabled
- **Stack** - SvelteKit, Svelte 5, TypeScript, Tailwind CSS, Vite, deployed on Vercel
- **Coordinates** - Rounded to 6 decimal places (~1m precision) in shared URLs
- **Limits** - Pin labels 80 chars, note text 200 chars, layer names 40 chars, CSV import capped at 100 pins
- **Image Export** - Map tiles may not render in exported PNGs due to cross-origin restrictions; overlays and markers capture correctly

---

<div align="center">
  Part of Project Eyrie - by <a href="https://notalex.sh">notalex.sh</a>
</div>
