// Reactive drawing store managing polylines, polygons, circles, arrows, and notes
import type { Drawing, DrawingType, DrawingMode, DrawingPoint } from './types';
import { layerStore } from './layer-store.svelte';
import { COORDINATE_PRECISION, MAX_NOTE_TEXT_LENGTH, DEFAULT_STROKE_WIDTH } from './constants';

let nextId = 1;

// Creates the singleton reactive drawing store
function createDrawingStore() {
	let drawings = $state<Drawing[]>([]);
	let mode = $state<DrawingMode>('none');
	let activeStrokeWidth = $state(DEFAULT_STROKE_WIDTH);
	let currentPoints = $state<DrawingPoint[]>([]);
	let selectedDrawingId = $state<string | null>(null);

	return {
		get drawings() {
			return drawings;
		},
		get mode() {
			return mode;
		},
		set mode(m: DrawingMode) {
			mode = m;
			currentPoints = [];
		},
		get activeStrokeWidth() {
			return activeStrokeWidth;
		},
		set activeStrokeWidth(w: number) {
			activeStrokeWidth = w;
		},
		get currentPoints() {
			return currentPoints;
		},
		get selectedDrawingId() {
			return selectedDrawingId;
		},
		set selectedDrawingId(id: string | null) {
			selectedDrawingId = id;
		},

		// Adds a coordinate point to the current in-progress drawing
		addPoint(lat: number, lng: number) {
			currentPoints = [
				...currentPoints,
				{
					lat: Math.round(lat * COORDINATE_PRECISION) / COORDINATE_PRECISION,
					lng: Math.round(lng * COORDINATE_PRECISION) / COORDINATE_PRECISION
				}
			];
		},

		// Removes the last added point from the current drawing
		undoLastPoint() {
			if (currentPoints.length > 0) {
				currentPoints = currentPoints.slice(0, -1);
			}
		},

		// Completes the current drawing and adds it to the store
		finishDrawing(radius?: number, text?: string, label?: string): Drawing | null {
			if (mode === 'measure') {
				currentPoints = [];
				mode = 'none';
				return null;
			}

			const minPoints = mode === 'circle' || mode === 'note' ? 1 : 2;
			if (currentPoints.length < minPoints) return null;

			const clampedText = text ? text.slice(0, MAX_NOTE_TEXT_LENGTH) : undefined;
			const defaultLabel = `${(mode as string).charAt(0).toUpperCase() + (mode as string).slice(1)} ${drawings.length + 1}`;

			const activeLayer = layerStore.layers.find((l) => l.id === layerStore.activeLayerId);
			const layerColor = activeLayer?.color ?? '#22d3ee';

			const drawing: Drawing = {
				id: `draw-${nextId++}`,
				type: mode as DrawingType,
				points: [...currentPoints],
				radius: mode === 'circle' ? radius : undefined,
				color: layerColor,
				strokeWidth: activeStrokeWidth,
				label: label || defaultLabel,
				layerId: layerStore.activeLayerId,
				text: mode === 'note' ? (clampedText || 'Note') : undefined
			};

			drawings = [...drawings, drawing];
			currentPoints = [];
			mode = 'none';
			selectedDrawingId = drawing.id;
			return drawing;
		},

		// Cancels the current drawing and resets mode
		cancelDrawing() {
			currentPoints = [];
			mode = 'none';
		},

		// Removes a drawing by ID and clears selection if it was selected
		removeDrawing(id: string) {
			drawings = drawings.filter((d) => d.id !== id);
			if (selectedDrawingId === id) selectedDrawingId = null;
		},

		// Updates a drawing's label, color, strokeWidth, or layer assignment
		updateDrawing(id: string, updates: Partial<Pick<Drawing, 'label' | 'color' | 'strokeWidth' | 'layerId' | 'animated' | 'reversed' | 'timestamp'>>) {
			if (updates.layerId) {
				const newLayer = layerStore.layers.find((l) => l.id === updates.layerId);
				if (newLayer) {
					updates = { ...updates, color: newLayer.color };
				}
			}
			drawings = drawings.map((d) => (d.id === id ? { ...d, ...updates } : d));
		},

		// Moves a drawing to a new position
		moveDrawing(id: string, lat: number, lng: number) {
			const rounded = {
				lat: Math.round(lat * COORDINATE_PRECISION) / COORDINATE_PRECISION,
				lng: Math.round(lng * COORDINATE_PRECISION) / COORDINATE_PRECISION
			};
			drawings = drawings.map((d) =>
				d.id === id ? { ...d, points: [rounded] } : d
			);
		},

		// Updates color for all drawings on a given layer
		syncLayerColor(layerId: string, color: string) {
			drawings = drawings.map((d) => (d.layerId === layerId ? { ...d, color } : d));
		},

		// Removes all drawings and resets state
		clearAll() {
			drawings = [];
			currentPoints = [];
			mode = 'none';
			selectedDrawingId = null;
		},

		// Replaces all drawings with a pre-built array
		loadDrawings(loaded: Drawing[]) {
			drawings = loaded;
			selectedDrawingId = null;
		}
	};
}

export const drawingStore = createDrawingStore();
