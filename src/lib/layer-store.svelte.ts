// Reactive layer store managing named color-coded groups for pins and drawings
import type { Layer } from './types';
import { MAX_LAYER_NAME_LENGTH } from './constants';

let nextId = 1;

// Creates the singleton reactive layer store
function createLayerStore() {
	let layers = $state<Layer[]>([
		{ id: 'default', name: 'Default', visible: true, color: '#22d3ee' }
	]);
	let activeLayerId = $state('default');

	return {
		get layers() {
			return layers;
		},
		get activeLayerId() {
			return activeLayerId;
		},
		set activeLayerId(id: string) {
			activeLayerId = id;
		},

		// Adds a new layer with the given name and color
		addLayer(name: string, color: string): Layer {
			const layer: Layer = {
				id: `layer-${nextId++}`,
				name: name.slice(0, MAX_LAYER_NAME_LENGTH),
				visible: true,
				color
			};
			layers = [...layers, layer];
			activeLayerId = layer.id;
			return layer;
		},

		// Removes a non-default layer and resets active layer if needed
		removeLayer(id: string) {
			if (id === 'default') return;
			layers = layers.filter((l) => l.id !== id);
			if (activeLayerId === id) activeLayerId = 'default';
		},

		// Toggles a layer's visibility on or off
		toggleVisibility(id: string) {
			layers = layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
		},

		// Updates a layer's name or color
		updateLayer(id: string, updates: Partial<Pick<Layer, 'name' | 'color'>>) {
			const clamped = { ...updates };
			if (clamped.name !== undefined) {
				clamped.name = clamped.name.slice(0, MAX_LAYER_NAME_LENGTH);
			}
			layers = layers.map((l) => (l.id === id ? { ...l, ...clamped } : l));
		},

		// Checks whether a given layer is currently visible
		isVisible(layerId: string): boolean {
			const layer = layers.find((l) => l.id === layerId);
			return layer ? layer.visible : true;
		},

		// Replaces all layers with a pre-built array
		loadLayers(loaded: Layer[]) {
			layers = loaded;
			if (!layers.find((l) => l.id === activeLayerId)) {
				activeLayerId = layers[0]?.id ?? 'default';
			}
		}
	};
}

export const layerStore = createLayerStore();
