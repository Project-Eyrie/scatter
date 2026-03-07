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

- **Pin Management** - Place, search, filter, label, and organize map markers with reverse geocoding and color-coded layers
- **Drawing Tools** - Create lines, arrows, polygons, circles, text notes, and measurement overlays with customizable styles
- **Route Planning** - Build multi-waypoint routes with driving/walking modes, per-segment details, and total distance/time
- **Nearby Search** - Find restaurants, parks, and other places within a configurable radius using Google Places
- **Distance Matrix** - View color-coded distance comparisons between all visible pins
- **Layer System** - Organize pins and drawings into named, color-coded groups with visibility toggles
- **Link Sharing** - Compress full map state into a shareable URL using DeflateRaw with optional AES-GCM encryption
- **Import / Export** - Save and restore map state via JSON files or import location data from CSV

---

## How to Use

### About the App

Scatter opens to a full-screen Google Map. Right-click anywhere to place a pin or search nearby places. Use the sidebar to manage layers, pins, routes, and drawings. The bottom panel provides street view, a distance matrix, property editing, and a travel calculator. Share your map via compressed URL or export it as JSON.

### Interface

| Area | Description |
|------|-------------|
| **Header** | File menu (export, import, CSV), Edit menu (undo, redo, clear), live coordinates, and share button |
| **Sidebar** | Search bar, layer management, and tabbed panels for pins, routes, and drawings |
| **Map** | Google Maps canvas with right-click context menu for pin placement and nearby search |
| **Drawing Toolbar** | Floating toolbar for selecting drawing tools, stroke width, and finishing drawings |
| **Bottom Panel** | Resizable panel with tabs for street view, distance matrix, properties editor, and travel calculator |

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

Map state is serialized to compact JSON with single-letter keys, compressed with DeflateRaw via the browser CompressionStream API, encoded as URL-safe base64, and stored in the URL hash fragment. An optional password adds AES-GCM encryption with PBKDF2 key derivation. The total URL is capped at 32,000 characters for cross-browser compatibility.

### Geographic Calculations

Distance calculations use the Haversine formula. Polygon areas use the spherical excess method. Label placement uses Mercator projection math for overlap resolution.

---

## Notes

- **Browser** - Desktop only (1024px+ screen width), requires CompressionStream API (Chrome 80+, Firefox 113+, Safari 16.4+, Edge 80+)
- **API Key** - Requires a Google Maps JavaScript API key with Places, Geocoding, Directions, and Street View enabled
- **Stack** - SvelteKit, Svelte 5, TypeScript, Tailwind CSS, Vite, deployed on Vercel
- **Coordinates** - Rounded to 6 decimal places (~1m precision) in shared URLs
- **Limits** - Pin labels 80 chars, note text 200 chars, layer names 40 chars, CSV import capped at 100 pins

---

<div align="center">
  Part of Project Eyrie - by <a href="https://notalex.sh">notalex.sh</a>
</div>
