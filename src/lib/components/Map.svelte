<script lang="ts">
	// Google Maps component handling pins, drawings, routes, measurement, and user interactions
	import { onMount, onDestroy, untrack } from 'svelte';
	import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
	import { CustomMarker } from '$lib/custom-marker';
	import { SimpleClusterer } from '$lib/marker-cluster';
	import { pinStore } from '$lib/stores.svelte';
	import { drawingStore } from '$lib/drawing-store.svelte';
	import { layerStore } from '$lib/layer-store.svelte';
	import { historyStore } from '$lib/history-store.svelte';
	import { createMarkerContent, createSearchMarkerContent, createNoteContent, createDrawingLabelContent, getDrawingLabelPosition, resolveOverlaps, computePinLabelOffsets } from '$lib/map-utils';
	import { ROUTE_COLORS, LABEL_MIN_ZOOM, LABEL_BLOCK_ZOOM } from '$lib/constants';
	import { formatTimestamp } from '$lib/csv-import';
	import type { RouteInfo, Drawing, RoutePair, TravelMode, NearbyResult } from '$lib/types';

	let mapEl: HTMLDivElement;
	let map: google.maps.Map;
	let geocoder: google.maps.Geocoder;
	let markers: Map<string, CustomMarker> = new Map();
	let clusterer: SimpleClusterer;
	let routePolylines: google.maps.Polyline[] = [];
	let straightLines: google.maps.Polyline[] = [];
	let ready = $state(false);

	let drawingShapes: Map<string, google.maps.Polyline | google.maps.Polygon | google.maps.Circle> =
		new Map();
	let noteMarkers: Map<string, CustomMarker> = new Map();
	let previewLine: google.maps.Polyline | null = null;
	let previewCircle: google.maps.Circle | null = null;
	let circlePreviewRadius = $state(0);

	let measureMarkers: CustomMarker[] = [];

	let heatmapLayer: google.maps.visualization.HeatmapLayer | null = null;
	let lastDrawFinishTime = 0;
	let lastMarkerClickTime = 0;

	let searchMarkerElements: CustomMarker[] = [];
	let searchCircleShape: google.maps.Circle | null = null;
	let drawingLabelMarkers: Map<string, CustomMarker> = new Map();
	let pathAnimations: Map<string, number> = new Map();
	let visiblePinIds: Set<string> = new Set();
	let routeGeneration = 0;

	let cursorLat = $state(0);
	let cursorLng = $state(0);
	let mapZoom = $state(3);

	import type { DrawingPoint } from '$lib/types';

	interface Props {
		apiKey: string;
		onRoutesCalculated?: (results: (RouteInfo | null)[][]) => void;
		onRoutePathsUpdated?: (paths: DrawingPoint[][][]) => void;
		routes?: RoutePair[];
		notesVisible?: boolean;
		labelsVisible?: boolean;
		pinLabelsVisible?: boolean;
		isSatellite?: boolean;
		tiltEnabled?: boolean;
		travelMode?: TravelMode;
		heatmapEnabled?: boolean;
		poiLabelsVisible?: boolean;
		onCursorMove?: (lat: number, lng: number) => void;
		initialCenter?: { lat: number; lng: number };
		initialZoom?: number;
		onContextMenu?: (lat: number, lng: number, x: number, y: number) => void;
		searchCircle?: { lat: number; lng: number; radius: number } | null;
		searchResults?: Array<{ lat: number; lng: number; name: string }>;
		onDrawingFinish?: (radius?: number) => void;
		clusterMaxZoom?: number;
		routesVisible?: boolean;
		timeFilter?: number | null;
		timelineHiddenLayers?: Set<string>;
		hiddenPinIds?: Set<string> | null;
	}

	let {
		apiKey,
		onRoutesCalculated,
		onRoutePathsUpdated,
		routes = [],
		notesVisible = true,
		labelsVisible = true,
		pinLabelsVisible = true,
		isSatellite = false,
		tiltEnabled = false,
		travelMode = 'DRIVING',
		heatmapEnabled = false,
		poiLabelsVisible = false,
		onCursorMove,
		initialCenter,
		initialZoom,
		onContextMenu,
		searchCircle = null,
		searchResults = [],
		onDrawingFinish,
		clusterMaxZoom = 14,
		routesVisible = true,
		timeFilter = null,
		timelineHiddenLayers = new Set<string>(),
		hiddenPinIds = null as Set<string> | null
	}: Props = $props();

	// Initializes the Google Maps instance, clusterer, and all event listeners
	onMount(async () => {
		setOptions({ key: apiKey, v: 'weekly' });

		await Promise.all([
			importLibrary('maps'),
			importLibrary('places'),
			importLibrary('geometry'),
			importLibrary('routes'),
			importLibrary('streetView'),
			importLibrary('visualization')
		]);

		const center = initialCenter ?? { lat: 30, lng: 0 };
		const zoom = initialZoom ?? 3;

		const initialStyles: google.maps.MapTypeStyle[] = poiLabelsVisible
			? []
			: [
				{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
				{ featureType: 'poi.business', elementType: 'all', stylers: [{ visibility: 'off' }] }
			];

		map = new google.maps.Map(mapEl, {
			center,
			zoom,
			disableDefaultUI: true,
			disableDoubleClickZoom: true,
			zoomControl: true,
			zoomControlOptions: {
				position: google.maps.ControlPosition.RIGHT_BOTTOM
			},
			mapTypeControl: false,
			streetViewControl: false,
			fullscreenControl: false,
			backgroundColor: '#0a0f1a',
			styles: initialStyles
		});

		geocoder = new google.maps.Geocoder();

		clusterer = new SimpleClusterer(map);

		map.addListener('click', (e: google.maps.MapMouseEvent) => {
			if (!e.latLng) return;
			if (Date.now() - lastDrawFinishTime < 300) return;
			if (Date.now() - lastMarkerClickTime < 300) return;

			const lat = e.latLng.lat();
			const lng = e.latLng.lng();
			const mode = drawingStore.mode;

			if (mode === 'none') {
				pinStore.selectedPinId = null;
				drawingStore.selectedDrawingId = null;
			} else if (mode === 'note') {
				drawingStore.addPoint(lat, lng);
			} else if (mode === 'circle') {
				if (drawingStore.currentPoints.length === 0) {
					drawingStore.addPoint(lat, lng);
				} else {
					const c = drawingStore.currentPoints[0];
					const radius = google.maps.geometry.spherical.computeDistanceBetween(
						new google.maps.LatLng(c.lat, c.lng),
						new google.maps.LatLng(lat, lng)
					);
					if (onDrawingFinish) {
						onDrawingFinish(radius);
					} else {
						historyStore.push('Finished drawing');
						drawingStore.finishDrawing(radius);
					}
					lastDrawFinishTime = Date.now();
				}
			} else {
				drawingStore.addPoint(lat, lng);
			}
		});

		const overlay = new google.maps.OverlayView();
		overlay.draw = () => {};
		overlay.setMap(map);

		mapEl.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			if (drawingStore.mode !== 'none') return;
			const projection = overlay.getProjection();
			if (!projection) return;
			const rect = mapEl.getBoundingClientRect();
			const point = new google.maps.Point(
				e.clientX - rect.left,
				e.clientY - rect.top
			);
			const latLng = projection.fromContainerPixelToLatLng(point);
			if (!latLng) return;
			const lat = latLng.lat();
			const lng = latLng.lng();
			if (onContextMenu) {
				onContextMenu(lat, lng, e.clientX, e.clientY);
			} else {
				historyStore.push('Added pin');
				const pin = pinStore.addPin(lat, lng);
				reverseGeocode(pin.id, lat, lng);
			}
		});

		map.addListener('dblclick', (e: google.maps.MapMouseEvent) => {
			const mode = drawingStore.mode;
			if (mode === 'path' || mode === 'polygon' || mode === 'measure' || mode === 'arrow') {
				e.stop();
				drawingStore.undoLastPoint();
				if (mode === 'measure') {
					historyStore.push('Finished measurement');
					drawingStore.finishDrawing();
				} else if (onDrawingFinish) {
					onDrawingFinish();
				} else {
					historyStore.push('Finished drawing');
					drawingStore.finishDrawing();
				}
				lastDrawFinishTime = Date.now();
			}
		});

		map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
			if (!e.latLng) return;
			cursorLat = e.latLng.lat();
			cursorLng = e.latLng.lng();
			onCursorMove?.(cursorLat, cursorLng);

			if (drawingStore.mode === 'circle' && drawingStore.currentPoints.length === 1) {
				const c = drawingStore.currentPoints[0];
				circlePreviewRadius = google.maps.geometry.spherical.computeDistanceBetween(
					new google.maps.LatLng(c.lat, c.lng),
					e.latLng
				);
			}
		});

		map.addListener('zoom_changed', () => {
			mapZoom = map.getZoom() ?? 3;
		});

		ready = true;
	});

	// Cleans up all map markers, shapes, and note markers on component destroy
	onDestroy(() => {
		clusterer.destroy();
		markers.clear();
		for (const [, shape] of drawingShapes) {
			shape.setMap(null);
		}
		drawingShapes.clear();
		for (const [, marker] of noteMarkers) {
			marker.map = null;
		}
		noteMarkers.clear();
		for (const [, frameId] of pathAnimations) cancelAnimationFrame(frameId);
		pathAnimations.clear();
		clearMeasureMarkers();
		if (heatmapLayer) {
			heatmapLayer.setMap(null);
			heatmapLayer = null;
		}
		for (const m of searchMarkerElements) { m.map = null; }
		searchMarkerElements = [];
		if (searchCircleShape) { searchCircleShape.setMap(null); }
		for (const [, marker] of drawingLabelMarkers) { marker.map = null; }
		drawingLabelMarkers.clear();
	});

	// Reverse geocodes a coordinate and updates the pin label with the best available name
	async function reverseGeocode(pinId: string, lat: number, lng: number) {
		try {
			const { results } = await geocoder.geocode({ location: { lat, lng } });
			if (results?.[0]) {
				const addr = results[0];
				const poi =
					addr.address_components?.find((c) =>
						c.types.includes('establishment') || c.types.includes('point_of_interest')
					)?.long_name;
				const streetNumber = addr.address_components?.find((c) =>
					c.types.includes('street_number')
				)?.long_name;
				const route = addr.address_components?.find((c) =>
					c.types.includes('route')
				)?.long_name;
				const streetAddr = route
					? (streetNumber ? `${streetNumber} ${route}` : route)
					: null;
				const name = poi ?? streetAddr ?? addr.formatted_address?.split(',')[0];
				if (name) {
					pinStore.updatePin(pinId, { label: name });
				}
			}
		} catch {
		}
	}

	// Updates the clusterer's max zoom threshold when the setting changes
	$effect(() => {
		const maxZ = clusterMaxZoom;
		if (!clusterer) return;
		clusterer.setMaxZoom(maxZ);
	});

	// Checks if an item is visible given the current timeline filter
	function isTimeVisible(timestamp?: string, endTimestamp?: string): boolean {
		if (timeFilter === null || timeFilter === undefined) return true;
		if (!timestamp) return true;
		const t = new Date(timestamp).getTime();
		if (isNaN(t)) return true;
		return t <= timeFilter;
	}

	// Computes the highlight window for timeline glow effect
	let timeHighlightWindow = $derived.by(() => {
		if (timeFilter === null || timeFilter === undefined) return 0;
		const timestamps: number[] = [];
		for (const p of pinStore.pins) {
			if (p.timestamp) { const t = new Date(p.timestamp).getTime(); if (!isNaN(t)) timestamps.push(t); }
		}
		for (const d of drawingStore.drawings) {
			if (d.timestamp) { const t = new Date(d.timestamp).getTime(); if (!isNaN(t)) timestamps.push(t); }
			if (d.endTimestamp) { const t = new Date(d.endTimestamp).getTime(); if (!isNaN(t)) timestamps.push(t); }
		}
		if (timestamps.length < 2) return 0;
		const range = Math.max(...timestamps) - Math.min(...timestamps);
		return range > 0 ? range * 0.05 : 0;
	});

	// Computes a partial path for progressive reveal based on timeline position
	function getProgressivePath(points: { lat: number; lng: number }[], timestamp?: string, endTimestamp?: string): { lat: number; lng: number }[] {
		if (timeFilter === null || timeFilter === undefined) return points;
		if (!timestamp || !endTimestamp || points.length < 2) return points;
		const tStart = new Date(timestamp).getTime();
		const tEnd = new Date(endTimestamp).getTime();
		if (isNaN(tStart) || isNaN(tEnd) || tEnd <= tStart) return points;
		if (timeFilter >= tEnd) return points;
		if (timeFilter <= tStart) return [points[0]];

		const progress = (timeFilter - tStart) / (tEnd - tStart);

		const segLengths: number[] = [];
		let totalLength = 0;
		for (let i = 1; i < points.length; i++) {
			const dlat = points[i].lat - points[i - 1].lat;
			const dlng = (points[i].lng - points[i - 1].lng) * Math.cos(((points[i].lat + points[i - 1].lat) / 2) * Math.PI / 180);
			const len = Math.sqrt(dlat * dlat + dlng * dlng);
			segLengths.push(len);
			totalLength += len;
		}

		const targetLength = totalLength * progress;
		const result: { lat: number; lng: number }[] = [points[0]];
		let accumulated = 0;

		for (let i = 0; i < segLengths.length; i++) {
			if (accumulated + segLengths[i] >= targetLength) {
				const remaining = targetLength - accumulated;
				const t = segLengths[i] > 0 ? remaining / segLengths[i] : 0;
				result.push({
					lat: points[i].lat + t * (points[i + 1].lat - points[i].lat),
					lng: points[i].lng + t * (points[i + 1].lng - points[i].lng)
				});
				break;
			}
			accumulated += segLengths[i];
			result.push(points[i + 1]);
		}

		return result;
	}

	// Checks if a pin's timestamp is near the current timeline position (for glow highlight)
	function isTimeHighlighted(timestamp?: string): boolean {
		if (timeFilter === null || timeFilter === undefined || !timeHighlightWindow) return false;
		if (!timestamp) return false;
		const t = new Date(timestamp).getTime();
		if (isNaN(t)) return false;
		return t <= timeFilter && t > timeFilter - timeHighlightWindow;
	}

	// Syncs map markers with pin store, layer visibility, and timeline state
	$effect(() => {
		if (!ready || !map) return;

		const currentPins = pinStore.pins;
		const selected = pinStore.selectedPinId;
		const showPinLabels = pinLabelsVisible;
		const pinIds = new Set(currentPins.map((p) => p.id));
		const layerMap = new Map(layerStore.layers.map((l) => [l.id, l]));
		const tf = timeFilter;

		for (const [id, marker] of markers) {
			if (!pinIds.has(id)) {
				clusterer.removeMarker(marker);
				marker.map = null;
				markers.delete(id);
			}
		}

		const zoom = mapZoom;
		const hideLabel = zoom < LABEL_BLOCK_ZOOM;
		const labelOffsets = showPinLabels
			? computePinLabelOffsets(
				currentPins.map((pin) => {
					const layer = layerMap.get(pin.layerId);
					const visible = layer ? layer.visible : true;
					return { lat: pin.lat, lng: pin.lng, hasLabel: visible && !!pin.label };
				}),
				zoom
			)
			: currentPins.map(() => ({ x: 0, y: 0 }));

		const newVisiblePinIds = new Set<string>();

		currentPins.forEach((pin, i) => {
			const layer = layerMap.get(pin.layerId);
			const layerVisible = layer ? layer.visible : true;
			const visible = layerVisible && isTimeVisible(pin.timestamp) && !timelineHiddenLayers.has(pin.layerId) && (!hiddenPinIds || hiddenPinIds.has(pin.id));
			const layerColor = layer?.color ?? '#22d3ee';
			const existing = markers.get(pin.id);
			const offset = labelOffsets[i];

			const formattedTimestamp = pin.timestamp ? formatTimestamp(pin.timestamp) : undefined;
			const highlighted = isTimeHighlighted(pin.timestamp);
			const fadeIn = visible && tf !== null && tf !== undefined && !visiblePinIds.has(pin.id);

			if (visible) newVisiblePinIds.add(pin.id);

			if (existing) {
				existing.position = { lat: pin.lat, lng: pin.lng };
				existing.content = createMarkerContent(i, pin.id === selected, layerColor, pin.label, showPinLabels, offset, hideLabel, formattedTimestamp, highlighted, fadeIn, pin.icon);
				if (!visible && clusterer.hasMarker(existing)) {
					clusterer.removeMarker(existing);
				} else if (visible && !clusterer.hasMarker(existing)) {
					clusterer.addMarker(existing);
					clusterer.setMarkerMeta(existing, { layerColor, layerName: layer?.name ?? 'Default', timestamp: pin.timestamp });
				}
			} else {
				const marker = new CustomMarker({
					position: { lat: pin.lat, lng: pin.lng },
					content: createMarkerContent(i, pin.id === selected, layerColor, pin.label, showPinLabels, offset, hideLabel, formattedTimestamp, highlighted, fadeIn, pin.icon),
					clickable: true
				});
				marker.addEventListener('click', () => {
					lastMarkerClickTime = Date.now();
					pinStore.selectedPinId = pin.id;
				});
				markers.set(pin.id, marker);
				if (visible) {
					clusterer.addMarker(marker);
					clusterer.setMarkerMeta(marker, { layerColor, layerName: layer?.name ?? 'Default', timestamp: pin.timestamp });
				}
			}
		});

		visiblePinIds = newVisiblePinIds;
	});

	// Syncs drawing shapes and note markers with drawing store state
	$effect(() => {
		if (!ready || !map) return;

		const currentDrawings = drawingStore.drawings;
		const drawingIds = new Set(currentDrawings.map((d) => d.id));
		const selectedId = drawingStore.selectedDrawingId;
		const zoom = mapZoom;
		const showNotes = notesVisible && zoom >= LABEL_MIN_ZOOM;
		const layerMap = new Map(layerStore.layers.map((l) => [l.id, l]));

		for (const [id, shape] of drawingShapes) {
			if (!drawingIds.has(id)) {
				shape.setMap(null);
				drawingShapes.delete(id);
			}
		}

		for (const [id, marker] of noteMarkers) {
			if (!drawingIds.has(id)) {
				marker.map = null;
				noteMarkers.delete(id);
			}
		}

		for (const drawing of currentDrawings) {
			const layer = layerMap.get(drawing.layerId);
			const layerVisible = layer ? layer.visible : true;
			const timeVis = isTimeVisible(drawing.timestamp, drawing.endTimestamp);
			const visible = layerVisible && timeVis && !timelineHiddenLayers.has(drawing.layerId);
			const drawColor = layer?.color ?? drawing.color;
			const isSelected = drawing.id === selectedId;
			const drawHighlighted = isTimeHighlighted(drawing.timestamp);

			if (drawing.type === 'note') {
				const noteVisible = visible && showNotes;
				const existingNote = noteMarkers.get(drawing.id);
				if (existingNote) {
					existingNote.position = { lat: drawing.points[0].lat, lng: drawing.points[0].lng };
					existingNote.content = createNoteContent(drawing.text ?? 'Note', drawColor, isSelected);
					existingNote.map = noteVisible ? map : null;
				} else if (drawing.points.length > 0) {
					const noteEl = createNoteContent(drawing.text ?? 'Note', drawColor, isSelected);
					const noteMarker = new CustomMarker({
						position: { lat: drawing.points[0].lat, lng: drawing.points[0].lng },
						content: noteEl,
						map: noteVisible ? map : null,
						clickable: true,
						draggable: true
					});
					noteMarker.addEventListener('click', () => {
						lastMarkerClickTime = Date.now();
						drawingStore.selectedDrawingId = drawing.id;
					});
					noteMarker.addEventListener('dragend', () => {
						const pos = noteMarker.position;
						if (pos) {
							drawingStore.moveDrawing(drawing.id, pos.lat, pos.lng);
						}
					});
					noteMarkers.set(drawing.id, noteMarker);
				}
				continue;
			}

			const existing = drawingShapes.get(drawing.id);

			if (existing) {
				existing.setMap(visible ? map : null);
				applyDrawingStyle(existing, drawing, isSelected, drawColor, drawHighlighted);
					if ((drawing.type === 'path' || drawing.type === 'arrow') && drawing.endTimestamp && existing instanceof google.maps.Polyline) {
					const fullPath = drawing.points.map((p) => ({ lat: p.lat, lng: p.lng }));
					const partialPath = getProgressivePath(
						drawing.reversed && drawing.type === 'path' ? [...fullPath].reverse() : fullPath,
						drawing.timestamp, drawing.endTimestamp
					);
					existing.setPath(partialPath);
				}
			} else {
				const shape = createDrawingShape(drawing, isSelected, drawColor, drawHighlighted);
				if (shape) {
						if ((drawing.type === 'path' || drawing.type === 'arrow') && drawing.endTimestamp && shape instanceof google.maps.Polyline) {
						const fullPath = drawing.points.map((p) => ({ lat: p.lat, lng: p.lng }));
						const partialPath = getProgressivePath(
							drawing.reversed && drawing.type === 'path' ? [...fullPath].reverse() : fullPath,
							drawing.timestamp, drawing.endTimestamp
						);
						shape.setPath(partialPath);
					}
					shape.setMap(visible ? map : null);
					shape.addListener('click', () => {
						lastMarkerClickTime = Date.now();
						drawingStore.selectedDrawingId = drawing.id;
					});
					drawingShapes.set(drawing.id, shape);
				}
			}
		}
	});

	// Updates stroke, fill, and icon styles on an existing drawing shape
	function applyDrawingStyle(
		shape: google.maps.Polyline | google.maps.Polygon | google.maps.Circle,
		drawing: Drawing,
		selected: boolean,
		color: string,
		highlighted = false
	) {
		const sw = drawing.strokeWidth ?? 2;
		const hlBonus = highlighted ? 2 : 0;
		const selBonus = (selected ? 1.5 : 0) + hlBonus;
		if (shape instanceof google.maps.Circle) {
			shape.setOptions({
				strokeColor: color,
				fillColor: color,
				strokeWeight: sw + selBonus,
				fillOpacity: highlighted ? 0.2 : selected ? 0.12 : 0.06
			});
		} else if (drawing.type === 'arrow' && shape instanceof google.maps.Polyline) {
			shape.setOptions({
				strokeColor: color,
				strokeWeight: sw + selBonus,
				strokeOpacity: highlighted ? 1 : selected ? 1 : 0.85,
				icons: [
					{
						icon: {
							path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
							scale: 2 + sw * 0.5,
							fillColor: color,
							fillOpacity: 1,
							strokeColor: color,
							strokeWeight: 1
						},
						offset: '100%'
					}
				]
			});
		} else if (drawing.type === 'path' && shape instanceof google.maps.Polyline) {
				if (!drawing.endTimestamp || timeFilter === null || timeFilter === undefined) {
				const drawPath = drawing.points.map((p) => ({ lat: p.lat, lng: p.lng }));
				shape.setPath(drawing.reversed ? drawPath.reverse() : drawPath);
			}
			shape.setOptions({
				strokeColor: color,
				strokeWeight: 0,
				strokeOpacity: 0,
				icons: [
					{
						icon: {
							path: 'M 0,-1 0,1',
							strokeOpacity: selected ? 1 : 0.85,
							strokeColor: color,
							scale: sw + selBonus
						},
						offset: '0',
						repeat: `${8 + sw * 2}px`
					}
				]
			});
		} else {
			shape.setOptions({
				strokeColor: color,
				strokeWeight: sw + selBonus,
				strokeOpacity: selected ? 1 : 0.75
			});
			if (shape instanceof google.maps.Polygon) {
				shape.setOptions({
					fillColor: color,
					fillOpacity: selected ? 0.12 : 0.06
				});
			}
		}
	}

	// Creates a new Google Maps shape (polyline, polygon, circle, or arrow) from a drawing
	function createDrawingShape(
		drawing: Drawing,
		selected: boolean,
		color: string,
		highlighted = false
	): google.maps.Polyline | google.maps.Polygon | google.maps.Circle | null {
		const path = drawing.points.map((p) => ({ lat: p.lat, lng: p.lng }));
		const sw = drawing.strokeWidth ?? 2;
		const hlBonus = highlighted ? 2 : 0;
		const selBonus = (selected ? 1.5 : 0) + hlBonus;

		if (drawing.type === 'arrow') {
			return new google.maps.Polyline({
				path,
				strokeColor: color,
				strokeWeight: sw + selBonus,
				strokeOpacity: selected ? 1 : 0.85,
				geodesic: true,
				icons: [
					{
						icon: {
							path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
							scale: 2 + sw * 0.5,
							fillColor: color,
							fillOpacity: 1,
							strokeColor: color,
							strokeWeight: 1
						},
						offset: '100%'
					}
				]
			});
		} else if (drawing.type === 'path') {
			const drawPath = drawing.reversed ? [...path].reverse() : path;
			return new google.maps.Polyline({
				path: drawPath,
				strokeColor: color,
				strokeWeight: 0,
				strokeOpacity: 0,
				geodesic: true,
				icons: [
					{
						icon: {
							path: 'M 0,-1 0,1',
							strokeOpacity: selected ? 1 : 0.85,
							strokeColor: color,
							scale: sw + selBonus
						},
						offset: '0',
						repeat: `${8 + sw * 2}px`
					}
				]
			});
		} else if (drawing.type === 'polygon') {
			return new google.maps.Polygon({
				paths: path,
				strokeColor: color,
				strokeWeight: sw + selBonus,
				strokeOpacity: selected ? 1 : 0.75,
				fillColor: color,
				fillOpacity: selected ? 0.12 : 0.06,
				geodesic: true
			});
		} else if (drawing.type === 'circle' && drawing.points.length > 0 && drawing.radius) {
			return new google.maps.Circle({
				center: { lat: drawing.points[0].lat, lng: drawing.points[0].lng },
				radius: drawing.radius,
				strokeColor: color,
				strokeWeight: sw + selBonus,
				strokeOpacity: selected ? 1 : 0.75,
				fillColor: color,
				fillOpacity: selected ? 0.12 : 0.06
			});
		}
		return null;
	}

	// Animates a moving dot along path/arrow drawings with animated=true
	$effect(() => {
		if (!ready || !map) return;

		const currentDrawings = drawingStore.drawings;
		const animatedIds = new Set(
			currentDrawings
				.filter((d) => (d.type === 'path' || d.type === 'arrow') && d.animated)
				.map((d) => d.id)
		);

		for (const [id, frameId] of pathAnimations) {
			if (!animatedIds.has(id)) {
				cancelAnimationFrame(frameId);
				pathAnimations.delete(id);
				const shape = drawingShapes.get(id);
				if (shape instanceof google.maps.Polyline) {
					const drawing = currentDrawings.find((d) => d.id === id);
					if (drawing) {
						const layerMap = new Map(layerStore.layers.map((l) => [l.id, l]));
						const layer = layerMap.get(drawing.layerId);
						const color = layer?.color ?? drawing.color;
						applyDrawingStyle(shape, drawing, drawing.id === drawingStore.selectedDrawingId, color);
					}
				}
			}
		}

		for (const id of animatedIds) {
			if (pathAnimations.has(id)) continue;
			const shape = drawingShapes.get(id);
			if (!(shape instanceof google.maps.Polyline)) continue;

			const drawing = currentDrawings.find((d) => d.id === id);
			if (!drawing) continue;

			const drawingId = drawing.id;
			const drawingLayerId = drawing.layerId;

			let offset = 0;
			function animate() {
				const layer = layerStore.layers.find((l) => l.id === drawingLayerId);
				const currentColor = layer?.color ?? '#22d3ee';

				offset = (offset + 0.15) % 100;
				const icons = shape!.get('icons') as google.maps.IconSequence[] | undefined;
				const baseIcons = icons ? icons.filter((_, i) => i === 0) : [];
				shape!.set('icons', [
					...baseIcons,
					{
						icon: {
							path: google.maps.SymbolPath.CIRCLE,
							scale: 5,
							fillColor: currentColor,
							fillOpacity: 1,
							strokeColor: '#0f172a',
							strokeWeight: 1.5
						},
						offset: `${offset}%`
					}
				]);
				const frameId = requestAnimationFrame(animate);
				pathAnimations.set(drawingId, frameId);
			}
			const frameId = requestAnimationFrame(animate);
			pathAnimations.set(id, frameId);
		}
	});

	// Shows a live preview line or circle while the user is drawing
	$effect(() => {
		if (!ready || !map) return;

		const mode = drawingStore.mode;
		const pts = drawingStore.currentPoints;

		if (previewLine) {
			previewLine.setMap(null);
			previewLine = null;
		}
		if (previewCircle) {
			previewCircle.setMap(null);
			previewCircle = null;
		}

		if (mode === 'none' || mode === 'note' || pts.length === 0) return;

		const activeLayer = layerStore.layers.find((l) => l.id === layerStore.activeLayerId);
		const color =
			mode === 'measure' ? '#22d3ee' : (activeLayer?.color ?? '#22d3ee');

		if (mode === 'circle' && pts.length === 1) {
			previewCircle = new google.maps.Circle({
				center: { lat: pts[0].lat, lng: pts[0].lng },
				radius: circlePreviewRadius,
				strokeColor: color,
				strokeWeight: 2,
				strokeOpacity: 0.5,
				fillColor: color,
				fillOpacity: 0.08,
				map,
				clickable: false
			});
		} else if (pts.length >= 1) {
			const path = pts.map((p) => ({ lat: p.lat, lng: p.lng }));
			path.push({ lat: cursorLat, lng: cursorLng });

			const isMeasure = mode === 'measure';
			const isArrow = mode === 'arrow';
			previewLine = new google.maps.Polyline({
				path,
				strokeColor: color,
				strokeWeight: isMeasure ? 3 : 2.5,
				strokeOpacity: isMeasure ? 0.85 : 0.6,
				geodesic: true,
				map,
				clickable: false,
				...(isArrow
					? {
							icons: [
								{
									icon: {
										path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
										scale: 3,
										fillColor: color,
										fillOpacity: 0.6,
										strokeColor: color,
										strokeWeight: 1
									},
									offset: '100%'
									}
								]
							}
						: {})
			});
		}
	});

	$effect(() => {
		if (!ready || !previewCircle) return;
		previewCircle.setRadius(circlePreviewRadius);
	});

	// Removes all measurement label markers from the map
	function clearMeasureMarkers() {
		for (const m of measureMarkers) {
			m.map = null;
		}
		measureMarkers = [];
	}

	// Places distance labels at segment midpoints during measurement mode
	$effect(() => {
		if (!ready || !map) return;

		clearMeasureMarkers();

		if (drawingStore.mode !== 'measure' || drawingStore.currentPoints.length < 2) return;

		const pts = drawingStore.currentPoints;
		let totalDist = 0;
		for (let i = 1; i < pts.length; i++) {
			const a = pts[i - 1];
			const b = pts[i];
			const midLat = (a.lat + b.lat) / 2;
			const midLng = (a.lng + b.lng) / 2;
			const dist = google.maps.geometry.spherical.computeDistanceBetween(
				new google.maps.LatLng(a.lat, a.lng),
				new google.maps.LatLng(b.lat, b.lng)
			);
			totalDist += dist;

			const label = dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(2)} km`;

			const el = document.createElement('div');
			el.style.cssText = `
				padding: 3px 8px; border-radius: 4px;
				background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(34, 211, 238, 0.3);
				color: #22d3ee; font-family: 'JetBrains Mono', monospace;
				font-size: 11px; font-weight: 700; white-space: nowrap;
				pointer-events: none;
			`;
			el.textContent = label;

			const marker = new CustomMarker({
				position: { lat: midLat, lng: midLng },
				content: el,
				map,
				anchor: 'center'
			});
			measureMarkers.push(marker);
		}

		const totalEl = document.createElement('div');
		totalEl.style.cssText = `
			padding: 3px 8px; border-radius: 4px;
			background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(245, 158, 11, 0.4);
			color: #f59e0b; font-family: 'JetBrains Mono', monospace;
			font-size: 12px; font-weight: 700; white-space: nowrap;
			pointer-events: none;
		`;
		totalEl.textContent = totalDist < 1000 ? `Total: ${Math.round(totalDist)} m` : `Total: ${(totalDist / 1000).toFixed(2)} km`;
		const totalMarker = new CustomMarker({
			position: { lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lng },
			content: totalEl,
			map,
			anchor: 'center'
		});
		measureMarkers.push(totalMarker);
	});

	// Removes all route polylines and straight-line overlays from the map
	function clearRoutePolylines() {
		for (const p of routePolylines) {
			p.setMap(null);
		}
		routePolylines = [];
		for (const s of straightLines) {
			s.setMap(null);
		}
		straightLines = [];
	}

	// Calculates and renders driving routes for all route pairs
	$effect(() => {
		if (!ready || !map) return;

		clearRoutePolylines();
		const currentGen = ++routeGeneration;

		const routeList = routes;
		const mode = travelMode;
		if (!routeList || routeList.length === 0) {
			onRoutesCalculated?.([]);
			return;
		}

		const currentPins = untrack(() => pinStore.pins);

		type Segment = { from: typeof currentPins[0]; to: typeof currentPins[0]; routeIdx: number; segIdx: number };
		const allSegments: Segment[] = [];

		for (let ri = 0; ri < routeList.length; ri++) {
			const wp = routeList[ri].waypointIds;
			for (let si = 0; si < wp.length - 1; si++) {
				const fromPin = currentPins.find((p) => p.id === wp[si]);
				const toPin = currentPins.find((p) => p.id === wp[si + 1]);
				if (fromPin && toPin && layerStore.isVisible(fromPin.layerId) && layerStore.isVisible(toPin.layerId)) {
					allSegments.push({ from: fromPin, to: toPin, routeIdx: ri, segIdx: si });
				}
			}
		}

		if (allSegments.length === 0) {
			onRoutesCalculated?.(routeList.map((r) => new Array(Math.max(0, r.waypointIds.length - 1)).fill(null)));
			return;
		}

		for (const seg of allSegments) {
			const color = ROUTE_COLORS[seg.routeIdx % ROUTE_COLORS.length];
			const sl = new google.maps.Polyline({
				path: [
					{ lat: seg.from.lat, lng: seg.from.lng },
					{ lat: seg.to.lat, lng: seg.to.lng }
				],
				strokeColor: color,
				strokeWeight: 1.5,
				strokeOpacity: 0,
				geodesic: true,
				icons: [
					{
						icon: {
							path: 'M 0,-1 0,1',
							strokeOpacity: 0.25,
							strokeColor: color,
							scale: 2
						},
						offset: '0',
						repeat: '14px'
					}
				],
				map
			});
			straightLines.push(sl);
		}

		const results: (RouteInfo | null)[][] = routeList.map((r) =>
			new Array(Math.max(0, r.waypointIds.length - 1)).fill(null)
		);
		const pathData: DrawingPoint[][][] = routeList.map((r) =>
			new Array(Math.max(0, r.waypointIds.length - 1)).fill([])
		);
		let completed = 0;

		for (const seg of allSegments) {
			const color = ROUTE_COLORS[seg.routeIdx % ROUTE_COLORS.length];

			(async () => {
				try {
					const Route = (google.maps as any).routes.Route;
					const { routes: routeResults } = await Route.computeRoutes({
						origin: { lat: seg.from.lat, lng: seg.from.lng },
						destination: { lat: seg.to.lat, lng: seg.to.lng },
						travelMode: mode,
						fields: ['path', 'legs', 'localizedValues', 'distanceMeters', 'durationMillis']
					});
						if (routeGeneration !== currentGen) return;
					if (routeResults?.length > 0) {
						const route = routeResults[0];
						const polylines = route.createPolylines();
						const segPath: DrawingPoint[] = [];
						for (const polyline of polylines) {
							polyline.setOptions({
								strokeColor: color,
								strokeWeight: 3,
								strokeOpacity: 0.8,
								icons: []
							});
							polyline.setMap(map);
							const path = polyline.getPath();
							path.forEach((latLng: google.maps.LatLng) => {
								segPath.push({ lat: latLng.lat(), lng: latLng.lng() });
							});
						}
						routePolylines.push(...polylines);
						pathData[seg.routeIdx][seg.segIdx] = segPath;

						const leg = route.legs?.[0];
						results[seg.routeIdx][seg.segIdx] = {
							distance: leg?.distanceMeters ?? route.distanceMeters ?? 0,
							duration: Math.round((leg?.durationMillis ?? route.durationMillis ?? 0) / 1000),
							distanceText:
								leg?.localizedValues?.distance?.text ??
								route.localizedValues?.distance?.text ??
								'',
							durationText:
								leg?.localizedValues?.duration?.text ??
								route.localizedValues?.duration?.text ??
								''
						};
					}
				} catch {
				}

				completed++;
				if (completed === allSegments.length) {
					onRoutesCalculated?.(results);
					onRoutePathsUpdated?.(pathData);
				}
			})();
		}
	});

	// Toggles route polyline visibility without recalculating routes
	$effect(() => {
		if (!ready || !map) return;
		const vis = routesVisible;
		for (const p of routePolylines) p.setMap(vis ? map : null);
		for (const s of straightLines) s.setMap(vis ? map : null);
	});

	// Toggles the heatmap layer visibility and updates its data from visible pins
	$effect(() => {
		if (!ready || !map) return;

		if (!heatmapEnabled) {
			if (heatmapLayer) {
				heatmapLayer.setMap(null);
			}
			return;
		}

		const data = pinStore.pins
			.filter((p) => layerStore.isVisible(p.layerId))
			.map((p) => new google.maps.LatLng(p.lat, p.lng));

		if (!heatmapLayer) {
			heatmapLayer = new google.maps.visualization.HeatmapLayer({
				data,
				map,
				radius: 30,
				opacity: 0.6
			});
		} else {
			heatmapLayer.setData(data);
			heatmapLayer.setMap(map);
		}
	});

	// Renders a search area circle on the map for nearby search
	$effect(() => {
		if (!ready || !map) return;

		if (searchCircleShape) {
			searchCircleShape.setMap(null);
			searchCircleShape = null;
		}

		const sc = searchCircle;
		if (sc) {
			searchCircleShape = new google.maps.Circle({
				center: { lat: sc.lat, lng: sc.lng },
				radius: sc.radius,
				strokeColor: '#22d3ee',
				strokeWeight: 2,
				strokeOpacity: 0.6,
				fillColor: '#22d3ee',
				fillOpacity: 0.08,
				map,
				clickable: false
			});
		}
	});

	// Renders temporary markers for nearby search results
	$effect(() => {
		if (!ready || !map) return;

		for (const m of searchMarkerElements) { m.map = null; }
		searchMarkerElements = [];

		const results = searchResults ?? [];
		for (const result of results) {
			const el = createSearchMarkerContent(result.name);
			const marker = new CustomMarker({
				position: { lat: result.lat, lng: result.lng },
				content: el,
				map
			});
			searchMarkerElements.push(marker);
		}
	});

	// Syncs the map type and tilt when satellite or tilt props change
	$effect(() => {
		if (!ready || !map) return;
		map.setMapTypeId(isSatellite ? 'hybrid' : 'roadmap');
		map.setTilt(tiltEnabled ? 45 : 0);
	});

	// Hides or shows Google Maps POI/business labels
	$effect(() => {
		if (!ready || !map) return;
		const vis = poiLabelsVisible ? 'on' : 'off';
		map.setOptions({
			styles: [
				{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: vis }] },
				{ featureType: 'poi.business', elementType: 'all', stylers: [{ visibility: vis }] }
			]
		});
	});

	// Renders drawing labels at their geometric center and resolves overlaps with note markers
	$effect(() => {
		if (!ready || !map) return;

		const currentDrawings = drawingStore.drawings;
		const drawingIds = new Set(currentDrawings.map((d) => d.id));
		const zoom = mapZoom;
		const showLabels = labelsVisible && zoom >= LABEL_MIN_ZOOM;
		const showNotes = notesVisible && zoom >= LABEL_MIN_ZOOM;
		const layerMap = new Map(layerStore.layers.map((l) => [l.id, l]));

		for (const [id, marker] of drawingLabelMarkers) {
			if (!drawingIds.has(id)) {
				marker.map = null;
				drawingLabelMarkers.delete(id);
			}
		}

		type OverlapItem = { id: string; lat: number; lng: number; width: number; height: number; isNote: boolean; isAnchored: boolean; visible: boolean };
		const overlapItems: OverlapItem[] = [];

		for (const drawing of currentDrawings) {
			if (drawing.type === 'note' && drawing.points.length > 0) {
				const layer = layerMap.get(drawing.layerId);
				const visible = (layer ? layer.visible : true) && showNotes;
				if (visible) {
					overlapItems.push({
						id: drawing.id,
						lat: drawing.points[0].lat,
						lng: drawing.points[0].lng,
						width: 28,
						height: 28,
						isNote: true,
						isAnchored: true,
						visible
					});
				}
			}
		}

		for (const drawing of currentDrawings) {
			if (drawing.type === 'note') continue;
			const layer = layerMap.get(drawing.layerId);
			const visible = (layer ? layer.visible : true) && showLabels;
			const pos = getDrawingLabelPosition(drawing);
			if (!pos) continue;
			overlapItems.push({
				id: drawing.id,
				lat: pos.lat,
				lng: pos.lng,
				width: 80,
				height: 20,
				isNote: false,
				isAnchored: false,
				visible
			});
		}

		const visibleItems = overlapItems.filter((item) => item.visible);
		const resolvedPositions = resolveOverlaps(
			visibleItems.map((item) => ({
				lat: item.lat,
				lng: item.lng,
				width: item.width,
				height: item.height,
				isAnchored: item.isAnchored
			})),
			zoom
		);
		const resolvedMap = new Map<string, { lat: number; lng: number }>();
		visibleItems.forEach((item, i) => {
			resolvedMap.set(item.id, resolvedPositions[i]);
		});

		for (const item of overlapItems) {
			if (!item.isNote) continue;
			const noteMarker = noteMarkers.get(item.id);
			if (noteMarker && item.visible) {
				const resolved = resolvedMap.get(item.id);
				if (resolved) {
					noteMarker.position = resolved;
				}
			}
		}

		const hideDrawingLabels = zoom < LABEL_BLOCK_ZOOM;
		for (const drawing of currentDrawings) {
			if (drawing.type === 'note') continue;

			const layer = layerMap.get(drawing.layerId);
			const visible = (layer ? layer.visible : true) && showLabels && !hideDrawingLabels;
			const labelColor = layer?.color ?? drawing.color;
			const resolved = resolvedMap.get(drawing.id);
			const pos = resolved ?? getDrawingLabelPosition(drawing);
			if (!pos) continue;

			const drawDisplayLabel = drawing.timestamp ? `${drawing.label} · ${formatTimestamp(drawing.timestamp)}` : drawing.label;
			const existing = drawingLabelMarkers.get(drawing.id);
			if (existing) {
				existing.position = pos;
				existing.content = createDrawingLabelContent(drawDisplayLabel, labelColor);
				existing.map = visible ? map : null;
			} else {
				const marker = new CustomMarker({
					position: pos,
					content: createDrawingLabelContent(drawDisplayLabel, labelColor),
					map: visible ? map : null,
					clickable: true
				});
				marker.addEventListener('click', () => {
					drawingStore.selectedDrawingId = drawing.id;
				});
				drawingLabelMarkers.set(drawing.id, marker);
			}
		}
	});

	// Adds a pin at given coordinates with reverse geocoding
	export function addPinAt(lat: number, lng: number) {
		historyStore.push('Added pin');
		const pin = pinStore.addPin(lat, lng);
		reverseGeocode(pin.id, lat, lng);
	}

	// Searches for places near a location using Google Places API
	export async function searchNearby(
		lat: number, lng: number, radius: number, query: string
	): Promise<NearbyResult[]> {
		return new Promise((resolve) => {
			const service = new google.maps.places.PlacesService(map);
			service.textSearch(
				{
					query,
					location: new google.maps.LatLng(lat, lng),
					radius
				},
				(results, status) => {
					if (status === google.maps.places.PlacesServiceStatus.OK && results) {
						const center = new google.maps.LatLng(lat, lng);
						const filtered = results.filter((r) => {
							const pos = r.geometry?.location;
							if (!pos) return false;
							return google.maps.geometry.spherical.computeDistanceBetween(center, pos) <= radius;
						});
						resolve(filtered.slice(0, 20).map((r, i) => ({
							id: `search-${i}-${Date.now()}`,
							name: r.name ?? 'Unknown',
							lat: r.geometry?.location?.lat() ?? lat,
							lng: r.geometry?.location?.lng() ?? lng,
							address: r.formatted_address ?? '',
							rating: r.rating,
							isOpen: r.opening_hours?.open_now
						})));
					} else {
						resolve([]);
					}
				}
			);
		});
	}

	// Pans and zooms the map to the specified coordinates
	export function flyTo(lat: number, lng: number) {
		if (map) {
			map.panTo({ lat, lng });
			map.setZoom(14);
		}
	}

	// Fits the map viewport to contain all given points
	export function fitBounds(points: { lat: number; lng: number }[]) {
		if (!map || points.length === 0) return;
		const bounds = new google.maps.LatLngBounds();
		for (const p of points) bounds.extend(p);
		map.fitBounds(bounds);
	}

	// Triggers a map resize to fix layout after container size changes
	export function invalidateSize() {
		if (map) google.maps.event.trigger(map, 'resize');
	}

	// Returns the current map center coordinates
	export function getCenter(): { lat: number; lng: number } | undefined {
		const c = map?.getCenter();
		if (!c) return;
		return { lat: c.lat(), lng: c.lng() };
	}

	// Returns the current map zoom level
	export function getZoom(): number | undefined {
		return map?.getZoom();
	}

	// Sets map center and zoom (used when loading encrypted share links after mount)
	export function setView(center: { lat: number; lng: number }, zoom: number) {
		if (map) {
			map.setCenter(center);
			map.setZoom(zoom);
		}
	}

	// Captures the map container as a PNG image and triggers a download
	export async function exportImage() {
		if (!mapEl) return;
		const html2canvas = (await import('html2canvas')).default;
		const canvas = await html2canvas(mapEl, { useCORS: true, allowTaint: true });
		const link = document.createElement('a');
		link.download = `scatter-export-${Date.now()}.png`;
		link.href = canvas.toDataURL('image/png');
		link.click();
	}

	// Sets the map type (roadmap or satellite)
	export function setMapType(satellite: boolean) {
		if (map) {
			map.setMapTypeId(satellite ? 'satellite' : 'roadmap');
		}
	}
</script>

<div class="relative h-full w-full" style="isolation: isolate;">
	<div
		bind:this={mapEl}
		class="h-full w-full"
		style="cursor: {drawingStore.mode !== 'none' ? 'crosshair' : 'default'};"
	></div>
</div>

<style>
</style>
