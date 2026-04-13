// CSV import utilities for parsing lat/lng data files
export const MAX_CSV_PINS = 100;

const LAT_NAMES = ['lat', 'latitude'];
const LNG_NAMES = ['lng', 'lon', 'long', 'longitude'];
const LABEL_NAMES = ['name', 'label', 'title', 'description', 'place'];
const COMBINED_TIMESTAMP_NAMES = ['timestamp', 'datetime', 'date_time', 'utc'];
const DATE_ONLY_NAMES = ['date'];
const TIME_ONLY_NAMES = ['time'];
const AZIMUTH_NAMES = ['azimuth', 'bearing', 'heading', 'direction'];
const RADIUS_NAMES = ['radius', 'accuracy', 'hdop'];
const ICON_NAMES = ['icon', 'type', 'category', 'marker'];
const LAYER_COL_NAMES = ['layer', 'group', 'folder'];
const ALTITUDE_NAMES = ['altitude', 'elevation', 'alt', 'height'];
const SPEED_NAMES = ['speed', 'velocity'];
const NOTES_NAMES = ['notes', 'comment', 'remarks', 'note'];

// Auto-detects delimiter from the first line of text
function detectDelimiter(text: string): string {
	const firstLine = text.split(/\r?\n/)[0] || '';
	let commas = 0, semicolons = 0, tabs = 0;
	let inQuotes = false;
	for (const ch of firstLine) {
		if (ch === '"') inQuotes = !inQuotes;
		if (inQuotes) continue;
		if (ch === ',') commas++;
		else if (ch === ';') semicolons++;
		else if (ch === '\t') tabs++;
	}
	if (tabs > commas && tabs >= semicolons) return '\t';
	if (semicolons > commas) return ';';
	return ',';
}

// Parses CSV text into rows of string arrays, handling quoted fields and auto-detecting delimiter
export function parseCsv(text: string): string[][] {
	const cleaned = text.replace(/^\uFEFF/, '');
	const delimiter = detectDelimiter(cleaned);
	const rows: string[][] = [];
	const lines = cleaned.split(/\r?\n/);

	for (const line of lines) {
		if (!line.trim()) continue;
		const fields: string[] = [];
		let current = '';
		let inQuotes = false;

		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (inQuotes) {
				if (ch === '"' && line[i + 1] === '"') {
					current += '"';
					i++;
				} else if (ch === '"') {
					inQuotes = false;
				} else {
					current += ch;
				}
			} else if (ch === '"') {
				inQuotes = true;
			} else if (ch === delimiter) {
				fields.push(current.trim());
				current = '';
			} else {
				current += ch;
			}
		}
		fields.push(current.trim());
		rows.push(fields);
	}

	return rows;
}

export interface DetectedColumns {
	lat: number; lng: number; label: number; timestamp: number; date: number; time: number;
	azimuth: number; radius: number; icon: number; layer: number;
	altitude: number; speed: number; notes: number;
}

// Auto-detects column indices for lat, lng, label, timestamp, and extended fields from header names
export function detectColumns(headers: string[]): DetectedColumns {
	const lower = headers.map((h) => h.toLowerCase().trim());
	const find = (names: string[]) => lower.findIndex((h) => names.includes(h));
	return {
		lat: find(LAT_NAMES),
		lng: find(LNG_NAMES),
		label: find(LABEL_NAMES),
		timestamp: find(COMBINED_TIMESTAMP_NAMES),
		date: find(DATE_ONLY_NAMES),
		time: find(TIME_ONLY_NAMES),
		azimuth: find(AZIMUTH_NAMES),
		radius: find(RADIUS_NAMES),
		icon: find(ICON_NAMES),
		layer: find(LAYER_COL_NAMES),
		altitude: find(ALTITUDE_NAMES),
		speed: find(SPEED_NAMES),
		notes: find(NOTES_NAMES)
	};
}

// Checks if a header row looks like column names (not numeric data)
export function hasHeaderRow(firstRow: string[]): boolean {
	const detected = detectColumns(firstRow);
	if (detected.lat !== -1 && detected.lng !== -1) return true;
	return firstRow.some(val => {
		const trimmed = val.trim();
		if (!trimmed) return false;
		return isNaN(Number(trimmed));
	});
}

// Auto-detects lat/lng columns by scanning data values when no header is present
export function detectColumnsFromData(rows: string[][]): { lat: number; lng: number; timestamp: number } {
	if (rows.length === 0 || rows[0].length === 0) return { lat: -1, lng: -1, timestamp: -1 };
	const colCount = rows[0].length;
	const sample = rows.slice(0, Math.min(10, rows.length));

	const isLat = (v: string) => { const n = Number(v); return !isNaN(n) && n >= -90 && n <= 90; };
	const isLng = (v: string) => { const n = Number(v); return !isNaN(n) && n >= -180 && n <= 180; };
	const isTs = (v: string) => parseTimestamp(v) !== null;

	let bestLat = -1, bestLng = -1, bestTimestamp = -1;
	let bestLatScore = 0, bestLngScore = 0, bestTsScore = 0;

	for (let col = 0; col < colCount; col++) {
		let latHits = 0, tsHits = 0;
		for (const row of sample) {
			const val = row[col]?.trim();
			if (!val) continue;
			if (isLat(val)) latHits++;
			if (isTs(val)) tsHits++;
		}
		if (latHits > bestLatScore) { bestLatScore = latHits; bestLat = col; }
		if (tsHits > bestTsScore && tsHits >= sample.length / 2) { bestTsScore = tsHits; bestTimestamp = col; }
	}

	for (let col = 0; col < colCount; col++) {
		if (col === bestLat || col === bestTimestamp) continue;
		let lngHits = 0;
		for (const row of sample) {
			const val = row[col]?.trim();
			if (val && isLng(val)) lngHits++;
		}
		if (lngHits > bestLngScore) { bestLngScore = lngHits; bestLng = col; }
	}

	return { lat: bestLat, lng: bestLng, timestamp: bestTimestamp };
}

// Validates a lat/lng pair: numeric and within range
export function validateCoords(latStr: string, lngStr: string): { lat: number; lng: number } | null {
	const lat = Number(latStr);
	const lng = Number(lngStr);
	if (isNaN(lat) || isNaN(lng)) return null;
	if (lat < -90 || lat > 90) return null;
	if (lng < -180 || lng > 180) return null;
	return { lat, lng };
}

// Returns unique valid row count and duplicate count for the given column mapping
export function getCsvStats(
	rows: string[][],
	latCol: number,
	lngCol: number
): { unique: number; duplicates: number } {
	const seen = new Set<string>();
	let duplicates = 0;

	for (const row of rows) {
		if (latCol >= row.length || lngCol >= row.length) continue;
		const coords = validateCoords(row[latCol], row[lngCol]);
		if (!coords) continue;
		const key = `${coords.lat},${coords.lng}`;
		if (seen.has(key)) {
			duplicates++;
		} else {
			seen.add(key);
		}
	}

	return { unique: seen.size, duplicates };
}

// Returns deduplicated valid rows, keeping first occurrence of each coordinate
export function deduplicateRows(
	rows: string[][],
	latCol: number,
	lngCol: number
): string[][] {
	const seen = new Set<string>();
	const result: string[][] = [];

	for (const row of rows) {
		if (latCol >= row.length || lngCol >= row.length) continue;
		const coords = validateCoords(row[latCol], row[lngCol]);
		if (!coords) continue;
		const key = `${coords.lat},${coords.lng}`;
		if (!seen.has(key)) {
			seen.add(key);
			result.push(row);
		}
	}

	return result;
}

// Parses a timestamp string in dd/mm/yyyy hh:mm:ss or UTC/ISO format, returns ISO string or null
export function parseTimestamp(value: string): string | null {
	if (!value?.trim()) return null;
	const trimmed = value.trim();

	const ddmmMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
	if (ddmmMatch) {
		const [, day, month, year, hours, minutes, seconds] = ddmmMatch;
		const d = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
		if (!isNaN(d.getTime())) return d.toISOString();
	}

	const dateOnly = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (dateOnly) {
		const [, day, month, year] = dateOnly;
		const d = new Date(Number(year), Number(month) - 1, Number(day));
		if (!isNaN(d.getTime())) return d.toISOString();
	}

	const d = new Date(trimmed);
	if (!isNaN(d.getTime())) return d.toISOString();

	return null;
}

// Combines separate date and time strings into an ISO timestamp
export function combineDateAndTime(dateStr: string, timeStr: string): string | null {
	const dateVal = dateStr?.trim();
	const timeVal = timeStr?.trim();
	if (!dateVal) return null;
	const combined = timeVal ? `${dateVal} ${timeVal}` : dateVal;
	return parseTimestamp(combined);
}

// Formats an ISO timestamp for display
export function formatTimestamp(iso: string): string {
	const d = new Date(iso);
	if (isNaN(d.getTime())) return iso;
	return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) +
		' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Opens a file picker for .csv files and returns the raw text
export function openCsvFileDialog(): Promise<string | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.csv,.txt';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) {
				resolve(null);
				return;
			}
			resolve(await file.text());
		};
		input.click();
	});
}

// Escapes a CSV field value (wraps in quotes if needed)
function escapeCsvField(val: string): string {
	if (val.includes(',') || val.includes('"') || val.includes('\n')) {
		return `"${val.replace(/"/g, '""')}"`;
	}
	return val;
}

// Exports pins as a downloadable CSV file
export function exportCsv(pins: Array<{ lat: number; lng: number; label: string; timestamp?: string; azimuth?: number; radius?: number; altitude?: number; speed?: number; notes?: string; icon?: string }>): void {
	const header = 'latitude,longitude,label,timestamp,azimuth,radius,altitude,speed,icon,notes';
	const rows = pins.map(p =>
		`${p.lat},${p.lng},${escapeCsvField(p.label)},${p.timestamp ?? ''},${p.azimuth ?? ''},${p.radius ?? ''},${p.altitude ?? ''},${p.speed ?? ''},${p.icon ?? ''},${escapeCsvField(p.notes ?? '')}`
	);
	const csv = [header, ...rows].join('\n');
	const blob = new Blob([csv], { type: 'text/csv' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `scatter-export-${Date.now()}.csv`;
	a.click();
	URL.revokeObjectURL(url);
}
