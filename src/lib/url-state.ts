// URL-based state encoding and decoding for shareable map links using deflate compression
import type { Pin, Drawing, Layer, RoutePair, TravelMode } from './types';
import { pinStore } from './stores.svelte';
import { drawingStore } from './drawing-store.svelte';
import { layerStore } from './layer-store.svelte';
import { deflateCompress, deflateDecompress, toBase64Url, fromBase64Url, encryptData, decryptData } from './compression';
import {
	MAX_PIN_LABEL_LENGTH,
	MAX_NOTE_TEXT_LENGTH,
	MAX_LAYER_NAME_LENGTH,
	MAX_URL_LENGTH,
	COORDINATE_PRECISION,
	DEFAULT_STROKE_WIDTH
} from './constants';

interface ViewSettings {
	labelsVisible: boolean;
	notesVisible: boolean;
	heatmapEnabled: boolean;
	isSatellite: boolean;
	tiltEnabled: boolean;
	pinLabelsVisible: boolean;
	poiLabelsVisible: boolean;
	routesVisible: boolean;
	embedMode?: boolean;
	readonlyMode?: boolean;
}

// Truncates a string to a maximum length
function truncate(str: string, max: number): string {
	return str.length > max ? str.slice(0, max) : str;
}

// Rounds a coordinate to 6 decimal places for compact storage
function roundCoord(val: number): number {
	return Math.round(val * COORDINATE_PRECISION) / COORDINATE_PRECISION;
}

// Builds a compact JSON state object from current stores
function buildState(
	center?: { lat: number; lng: number },
	zoom?: number,
	routes?: RoutePair[],
	travelMode?: TravelMode,
	viewSettings?: ViewSettings
): Record<string, unknown> {
	const state: Record<string, unknown> = { v: 3 };

	if (center && zoom != null) {
		state.c = [roundCoord(center.lat), roundCoord(center.lng), zoom];
	}

	if (pinStore.pins.length > 0) {
		state.p = pinStore.pins.map((p) => {
			const entry: unknown[] = [roundCoord(p.lat), roundCoord(p.lng), truncate(p.label, MAX_PIN_LABEL_LENGTH), p.layerId];
			if (p.icon || p.timestamp) entry.push(p.icon || null);
			if (p.timestamp) entry.push(p.timestamp);
			const hasExtended = p.azimuth != null || p.radius != null || p.altitude != null || p.speed != null || p.notes;
			if (hasExtended) {
				while (entry.length < 6) entry.push(null);
				entry.push(p.azimuth ?? null, p.radius ?? null, p.altitude ?? null, p.speed ?? null, p.notes ? truncate(p.notes, 200) : null);
			}
			return entry;
		});
	}

	if (drawingStore.drawings.length > 0) {
		state.d = drawingStore.drawings.map((d) => {
			const entry: unknown[] = [
				d.type,
				d.color,
				d.points.map((pt) => [roundCoord(pt.lat), roundCoord(pt.lng)]),
				d.layerId
			];
			if (d.type === 'circle' && d.radius) {
				entry.push(Math.round(d.radius));
			}
			if (d.type === 'note' && d.text) {
				if (entry.length === 4) entry.push(null);
				entry.push(truncate(d.text, MAX_NOTE_TEXT_LENGTH));
			}
			while (entry.length < 6) entry.push(null);
			entry.push(truncate(d.label, MAX_PIN_LABEL_LENGTH));
			const sw = d.strokeWidth ?? DEFAULT_STROKE_WIDTH;
			entry.push(sw !== DEFAULT_STROKE_WIDTH ? sw : null);
			entry.push(d.animated ? true : null);
			entry.push(d.reversed ? true : null);
			if (d.timestamp || d.endTimestamp || d.waypointPinIds) {
				entry.push(d.timestamp || null);
				entry.push(d.endTimestamp || null);
				if (d.waypointPinIds && d.waypointPinIds.length > 0) {
					entry.push(d.waypointPinIds.map(wpId => {
						const idx = pinStore.pins.findIndex(p => p.id === wpId);
						return idx >= 0 ? idx : 0;
					}));
				}
			}
			return entry;
		});
	}

	if (layerStore.layers.length > 0) {
		state.l = layerStore.layers.map((l) => [
			l.id,
			truncate(l.name, MAX_LAYER_NAME_LENGTH),
			l.visible,
			l.color
		]);
	}

	if (routes && routes.length > 0) {
		state.r = routes.map((r) =>
			r.waypointIds.map((wpId) => {
				const idx = pinStore.pins.findIndex((p) => p.id === wpId);
				return idx >= 0 ? idx : 0;
			})
		);
	}

	if (travelMode && travelMode !== 'DRIVING') {
		state.tm = travelMode;
	}

	if (viewSettings) {
		const vs = viewSettings;
		if (!vs.labelsVisible || !vs.notesVisible || vs.heatmapEnabled || vs.isSatellite || vs.tiltEnabled || !vs.pinLabelsVisible || vs.poiLabelsVisible || !vs.routesVisible || vs.embedMode || vs.readonlyMode) {
			const arr: unknown[] = [vs.labelsVisible, vs.notesVisible, vs.heatmapEnabled, vs.isSatellite, vs.tiltEnabled, vs.pinLabelsVisible, vs.poiLabelsVisible, vs.routesVisible];
			if (vs.embedMode || vs.readonlyMode) {
				arr.push(vs.embedMode ?? false, vs.readonlyMode ?? false);
			}
			state.vs = arr;
		}
	}

	return state;
}

// Encodes all map state into a compressed, optionally encrypted, URL-safe base64 string
export async function encodeMapState(
	center?: { lat: number; lng: number },
	zoom?: number,
	routes?: RoutePair[],
	travelMode?: TravelMode,
	viewSettings?: ViewSettings,
	password?: string
): Promise<string> {
	const state = buildState(center, zoom, routes, travelMode, viewSettings);
	const json = JSON.stringify(state);
	const compressed = await deflateCompress(json);
	if (password) {
		const encrypted = await encryptData(compressed, password);
		return 'e' + toBase64Url(encrypted);
	}
	return 'z' + toBase64Url(compressed);
}

// Checks if a hash string represents an encrypted share link
export function isEncryptedHash(hash: string): boolean {
	return hash.startsWith('e');
}

// Decodes a compressed (or encrypted) hash string back into map state
export async function decodeMapState(hash: string, password?: string): Promise<{
	center?: { lat: number; lng: number };
	zoom?: number;
	routes?: RoutePair[];
	travelMode?: TravelMode;
	viewSettings?: ViewSettings;
} | null> {
	try {
		let compressed: Uint8Array;
		if (hash.startsWith('e')) {
			if (!password) return null;
			const encrypted = fromBase64Url(hash.slice(1));
			compressed = await decryptData(encrypted, password);
		} else if (hash.startsWith('z')) {
			compressed = fromBase64Url(hash.slice(1));
		} else {
			return null;
		}

		const json = await deflateDecompress(compressed);
		const state = JSON.parse(json);

		if (state.v !== 3) return null;

		if (state.l && Array.isArray(state.l)) {
			const layers: Layer[] = state.l.map(
				(entry: [string, string, boolean, string]) => ({
					id: entry[0],
					name: entry[1],
					visible: entry[2],
					color: entry[3]
				})
			);
			layerStore.loadLayers(layers);
		}

		if (state.p && Array.isArray(state.p)) {
			const pins: Pin[] = state.p.map(
				(entry: (string | number | null)[], i: number) => ({
					id: `shared-pin-${i}`,
					lat: entry[0] as number,
					lng: entry[1] as number,
					label: (entry[2] as string) || `Pin ${i + 1}`,
					layerId: (entry[3] as string) || 'default',
					...(typeof entry[4] === 'string' ? { icon: entry[4] } : {}),
					...(typeof entry[5] === 'string' ? { timestamp: entry[5] } : {}),
					...(entry.length > 6 && entry[6] != null ? { azimuth: entry[6] as number } : {}),
					...(entry.length > 7 && entry[7] != null ? { radius: entry[7] as number } : {}),
					...(entry.length > 8 && entry[8] != null ? { altitude: entry[8] as number } : {}),
					...(entry.length > 9 && entry[9] != null ? { speed: entry[9] as number } : {}),
					...(entry.length > 10 && typeof entry[10] === 'string' ? { notes: entry[10] } : {})
				})
			);
			pinStore.loadPins(pins);
		}

		if (state.d && Array.isArray(state.d)) {
			const pinIds = pinStore.pins.map((p) => p.id);
			const drawings: Drawing[] = state.d.map((entry: unknown[], i: number) => {
				const rawType = entry[0] as string;
				const type = (rawType === 'polyline' ? 'path' : rawType) as Drawing['type'];
				const defaultLabel = `${type.charAt(0).toUpperCase() + type.slice(1)} ${i + 1}`;
				const wpIndices = (entry.length > 12 && Array.isArray(entry[12])) ? entry[12] as number[] : undefined;
				return {
					id: `shared-draw-${i}`,
					type,
					color: entry[1] as string,
					points: (entry[2] as number[][]).map((pt: number[]) => ({
						lat: pt[0],
						lng: pt[1]
					})),
					layerId: (entry[3] as string) || 'default',
					radius: entry[4] != null ? (entry[4] as number) : undefined,
					label: (entry.length > 6 && entry[6]) ? (entry[6] as string) : defaultLabel,
					text: (entry[5] != null) ? (entry[5] as string) : undefined,
					strokeWidth: (entry.length > 7 && entry[7] != null) ? (entry[7] as number) : DEFAULT_STROKE_WIDTH,
					animated: (entry.length > 8 && entry[8]) ? true : undefined,
					reversed: (entry.length > 9 && entry[9]) ? true : undefined,
					timestamp: (entry.length > 10 && typeof entry[10] === 'string') ? entry[10] : undefined,
					endTimestamp: (entry.length > 11 && typeof entry[11] === 'string') ? entry[11] : undefined,
					waypointPinIds: wpIndices ? wpIndices.map(idx => pinIds[idx] ?? pinIds[0]) : undefined
				};
			});
			drawingStore.loadDrawings(drawings);
		}

		let decodedRoutes: RoutePair[] | undefined;
		if (state.r && Array.isArray(state.r)) {
			const pinIds = pinStore.pins.map((p) => p.id);
			decodedRoutes = state.r.map((indices: number[], i: number) => ({
				id: `shared-route-${i}`,
				waypointIds: indices.map((idx: number) => pinIds[idx] ?? pinIds[0])
			}));
		}

		const result: {
			center?: { lat: number; lng: number };
			zoom?: number;
			routes?: RoutePair[];
			travelMode?: TravelMode;
			viewSettings?: ViewSettings;
		} = {};

		if (state.c && Array.isArray(state.c)) {
			result.center = { lat: state.c[0], lng: state.c[1] };
			result.zoom = state.c[2];
		}

		if (decodedRoutes) {
			result.routes = decodedRoutes;
		}

		if (state.tm) {
			result.travelMode = state.tm as TravelMode;
		}

		if (state.vs && Array.isArray(state.vs)) {
			result.viewSettings = {
				labelsVisible: state.vs[0] ?? true,
				notesVisible: state.vs[1] ?? true,
				heatmapEnabled: state.vs[2] ?? false,
				isSatellite: state.vs[3] ?? false,
				tiltEnabled: state.vs[4] ?? false,
				pinLabelsVisible: state.vs[5] ?? true,
				poiLabelsVisible: state.vs[6] ?? false,
				routesVisible: state.vs[7] ?? true,
				embedMode: state.vs[8] ?? false,
				readonlyMode: state.vs[9] ?? false
			};
		}

		return result;
	} catch {
		return null;
	}
}

// Builds a full share URL with compressed state in the hash fragment
export async function getShareUrl(
	center?: { lat: number; lng: number },
	zoom?: number,
	routes?: RoutePair[],
	travelMode?: TravelMode,
	viewSettings?: ViewSettings,
	password?: string
): Promise<string> {
	const encoded = await encodeMapState(center, zoom, routes, travelMode, viewSettings, password);
	const url = `${window.location.origin}${window.location.pathname}#s=${encoded}`;
	if (url.length > MAX_URL_LENGTH) {
		console.warn(`Share URL exceeds ${MAX_URL_LENGTH} characters (${url.length}). Some data may be lost in older browsers.`);
	}
	return url;
}
