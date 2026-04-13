// Reactive pin store managing map markers with add, remove, update, and load operations
import type { Pin } from './types';
import { layerStore } from './layer-store.svelte';
import { COORDINATE_PRECISION, MAX_PIN_LABEL_LENGTH } from './constants';

let nextId = 1;

// Creates the singleton reactive pin store
function createPinStore() {
	let pins = $state<Pin[]>([]);
	let selectedPinId = $state<string | null>(null);

	return {
		get pins() {
			return pins;
		},
		get selectedPinId() {
			return selectedPinId;
		},
		set selectedPinId(id: string | null) {
			selectedPinId = id;
		},

		// Adds a new pin at the given coordinates on the active layer
		addPin(lat: number, lng: number, layerId?: string) {
			const id = `pin-${nextId++}`;
			const pin: Pin = {
				id,
				lat: Math.round(lat * COORDINATE_PRECISION) / COORDINATE_PRECISION,
				lng: Math.round(lng * COORDINATE_PRECISION) / COORDINATE_PRECISION,
				label: `Pin ${pins.length + 1}`,
				layerId: layerId ?? layerStore.activeLayerId
			};
			pins = [...pins, pin];
			selectedPinId = id;
			return pin;
		},

		// Removes a pin by ID and clears selection if it was selected
		removePin(id: string) {
			pins = pins.filter((p) => p.id !== id);
			if (selectedPinId === id) selectedPinId = null;
		},

		// Updates a pin's label or layer assignment with length enforcement
		updatePin(id: string, updates: Partial<Pick<Pin, 'label' | 'layerId' | 'timestamp' | 'icon' | 'azimuth' | 'radius' | 'altitude' | 'speed' | 'notes'>>) {
			const clamped = { ...updates };
			if (clamped.label !== undefined) {
				clamped.label = clamped.label.slice(0, MAX_PIN_LABEL_LENGTH);
			}
			pins = pins.map((p) => (p.id === id ? { ...p, ...clamped } : p));
		},

		// Removes all pins and clears selection
		clearAll() {
			pins = [];
			selectedPinId = null;
		},

		// Replaces all pins with a pre-built array
		loadPins(loaded: Pin[]) {
			pins = loaded;
			selectedPinId = null;
		}
	};
}

export const pinStore = createPinStore();
