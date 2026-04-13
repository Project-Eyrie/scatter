// JSON export and import for saving and loading full map state as downloadable files
import type { Pin, Drawing, Layer, RoutePair, TravelMode } from './types';
import { pinStore } from './stores.svelte';
import { drawingStore } from './drawing-store.svelte';
import { layerStore } from './layer-store.svelte';
import { deflateCompress, deflateDecompress, encryptData, decryptData } from './compression';

interface ScatterExport {
	version: 2;
	exportedAt: string;
	center?: { lat: number; lng: number };
	zoom?: number;
	pins: Pin[];
	drawings: Drawing[];
	layers: Layer[];
	routes: RoutePair[];
	travelMode: TravelMode;
	labelsVisible: boolean;
	notesVisible: boolean;
	heatmapEnabled: boolean;
	isSatellite: boolean;
	tiltEnabled: boolean;
	pinLabelsVisible: boolean;
	poiLabelsVisible: boolean;
	routesVisible: boolean;
}

// Builds a full export object from current store state and map viewport
export function buildExportData(
	center?: { lat: number; lng: number },
	zoom?: number,
	routes: RoutePair[] = [],
	travelMode: TravelMode = 'DRIVING',
	labelsVisible: boolean = true,
	notesVisible: boolean = true,
	heatmapEnabled: boolean = false,
	isSatellite: boolean = false,
	tiltEnabled: boolean = false,
	pinLabelsVisible: boolean = true,
	poiLabelsVisible: boolean = false,
	routesVisible: boolean = true
): ScatterExport {
	return {
		version: 2,
		exportedAt: new Date().toISOString(),
		center,
		zoom,
		pins: pinStore.pins.map((p) => ({ ...p })),
		drawings: drawingStore.drawings.map((d) => ({ ...d, points: [...d.points] })),
		layers: layerStore.layers.map((l) => ({ ...l })),
		routes: routes.map((r) => ({ ...r, waypointIds: [...r.waypointIds] })),
		travelMode,
		labelsVisible,
		notesVisible,
		heatmapEnabled,
		isSatellite,
		tiltEnabled,
		pinLabelsVisible,
		poiLabelsVisible,
		routesVisible
	};
}

// Triggers a JSON file download with the given export data
export function downloadJson(data: ScatterExport): void {
	const json = JSON.stringify(data, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `scatter-export-${Date.now()}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

// Validates and loads a JSON export into all stores, returns viewport and view settings
export function importJson(raw: string): {
	center?: { lat: number; lng: number };
	zoom?: number;
	routes: RoutePair[];
	travelMode: TravelMode;
	labelsVisible: boolean;
	notesVisible: boolean;
	heatmapEnabled: boolean;
	isSatellite: boolean;
	tiltEnabled: boolean;
	pinLabelsVisible: boolean;
	poiLabelsVisible: boolean;
	routesVisible: boolean;
} | null {
	try {
		const data: ScatterExport = JSON.parse(raw);
		if (data.version !== 2) return null;

		if (Array.isArray(data.layers) && data.layers.length > 0) {
			layerStore.loadLayers(data.layers);
		}
		if (Array.isArray(data.pins)) {
			pinStore.loadPins(data.pins);
		}
		if (Array.isArray(data.drawings)) {
			drawingStore.loadDrawings(data.drawings.map((d: any) => ({
				...d,
				type: d.type === 'polyline' ? 'path' : d.type,
				strokeWidth: d.strokeWidth ?? 2
			})));
		}

		return {
			center: data.center,
			zoom: data.zoom,
			routes: Array.isArray(data.routes) ? data.routes : [],
			travelMode: data.travelMode ?? 'DRIVING',
			labelsVisible: data.labelsVisible ?? true,
			notesVisible: data.notesVisible ?? true,
			heatmapEnabled: data.heatmapEnabled ?? false,
			isSatellite: data.isSatellite ?? false,
			tiltEnabled: data.tiltEnabled ?? false,
			pinLabelsVisible: data.pinLabelsVisible ?? true,
			poiLabelsVisible: data.poiLabelsVisible ?? false,
			routesVisible: data.routesVisible ?? true
		};
	} catch {
		return null;
	}
}

// Exports encrypted JSON as a downloadable .scatter file
export async function downloadEncryptedJson(data: ScatterExport, password: string): Promise<void> {
	const json = JSON.stringify(data);
	const compressed = await deflateCompress(json);
	const encrypted = await encryptData(compressed, password);
	const blob = new Blob([encrypted], { type: 'application/octet-stream' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `scatter-export-${Date.now()}.scatter`;
	a.click();
	URL.revokeObjectURL(url);
}

// Imports and decrypts a .scatter file
export async function importEncryptedJson(data: ArrayBuffer, password: string): ReturnType<typeof importJson> {
	try {
		const decrypted = await decryptData(new Uint8Array(data), password);
		const json = await deflateDecompress(decrypted);
		return importJson(json);
	} catch {
		return null;
	}
}

// Opens a file picker dialog, reads the selected JSON or .scatter file, and imports it
export function openImportDialog(): Promise<{ result: ReturnType<typeof importJson>; encrypted?: boolean; fileData?: ArrayBuffer } | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,.scatter';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) {
				resolve(null);
				return;
			}
			if (file.name.endsWith('.scatter')) {
				const data = await file.arrayBuffer();
				resolve({ result: null, encrypted: true, fileData: data });
			} else {
				const text = await file.text();
				resolve({ result: importJson(text) });
			}
		};
		input.click();
	});
}
