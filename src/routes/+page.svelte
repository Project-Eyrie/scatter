<script lang="ts">
	// Main application page orchestrating map, sidebar, toolbar, and bottom panel
	import { onMount, untrack } from 'svelte';
	import Map from '$lib/components/Map.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Header from '$lib/components/Header.svelte';
	import DrawingToolbar from '$lib/components/DrawingToolbar.svelte';
	import BottomPanel from '$lib/components/BottomPanel.svelte';
	import { pinStore } from '$lib/stores.svelte';
	import { drawingStore } from '$lib/drawing-store.svelte';
	import { layerStore } from '$lib/layer-store.svelte';
	import { historyStore } from '$lib/history-store.svelte';
	import { getShareUrl, decodeMapState, isEncryptedHash } from '$lib/url-state';
	import { buildExportData, downloadJson, openImportDialog } from '$lib/json-export';
	import { openCsvFileDialog, parseCsv, detectColumns, detectColumnsFromData, hasHeaderRow, validateCoords, getCsvStats, deduplicateRows, parseTimestamp, combineDateAndTime, exportCsv, formatTimestamp, MAX_CSV_PINS } from '$lib/csv-import';
	import { LAYER_COLORS, MAX_NOTE_TEXT_LENGTH } from '$lib/constants';
	import type { RouteInfo, RoutePair, TravelMode, NearbyResult, DrawingPoint } from '$lib/types';

	const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

	let mapComponent: Map;
	let bottomPanelComponent: BottomPanel;
	let headerComponent: Header;
	let routes = $state<RoutePair[]>([]);
	let routeResults = $state<(RouteInfo | null)[][]>([]);
	let routePaths = $state<DrawingPoint[][][]>([]);
	let notesVisible = $state(true);
	let travelMode = $state<TravelMode>('DRIVING');
	let heatmapEnabled = $state(false);
	let sidebarOpen = $state(true);
	let cursorLat = $state(0);
	let cursorLng = $state(0);
	let isSatellite = $state(false);
	let tiltEnabled = $state(false);
	let labelsVisible = $state(true);
	let pinLabelsVisible = $state(true);
	let poiLabelsVisible = $state(false);
	let routesVisible = $state(true);
	let labelsDropdownOpen = $state(false);
	let clusterDropdownOpen = $state(false);
	let clusterMaxZoom = $state(14);

	let initialCenter = $state<{ lat: number; lng: number } | undefined>(undefined);
	let initialZoom = $state<number | undefined>(undefined);
	let splashVisible = $state(true);
	let splashFading = $state(false);
	let embedMode = $state(false);
	let readonlyMode = $state(false);

	let showNoteModal = $state(false);
	let noteText = $state('');
	let noteInputEl = $state<HTMLTextAreaElement | null>(null);

	let showDrawingLabelModal = $state(false);
	let drawingLabelText = $state('');
	let pendingDrawingRadius = $state<number | undefined>(undefined);
	let drawingLabelInputEl = $state<HTMLInputElement | null>(null);

	let showShareModal = $state(false);
	let sharePassword = $state('');
	let sharePasswordInputEl = $state<HTMLInputElement | null>(null);
	let shareEmbed = $state(false);
	let shareReadonly = $state(false);

	let showDecryptModal = $state(false);
	let decryptPassword = $state('');
	let decryptError = $state(false);
	let pendingEncryptedHash = $state('');
	let decryptPasswordInputEl = $state<HTMLInputElement | null>(null);

	let showCsvModal = $state(false);
	let csvRows = $state<string[][]>([]);
	let csvHeaders = $state<string[]>([]);
	let csvLatCol = $state(-1);
	let csvLngCol = $state(-1);
	let csvLabelCol = $state(-1);
	let csvTimestampCol = $state(-1);
	let csvTimestampMode = $state<'combined' | 'separate'>('combined');
	let csvDateCol = $state(-1);
	let csvTimeCol = $state(-1);
	let showCsvWalkthrough = $state(false);

	let ctxMenu = $state({ show: false, x: 0, y: 0, lat: 0, lng: 0 });

	let timelineActive = $state(false);
	let timelinePlaying = $state(false);
	let timelineTime = $state(0);
	let timelineSpeed = $state(1);
	let timelineAnimFrame = $state(0);
	let timelineLayers = $state<Set<string>>(new Set());
	let timelineLayerPickerOpen = $state(false);
	let filteredPinIds = $state<Set<string> | null>(null);

	// Collect all timestamps from pins and drawings
	let allTimestamps = $derived.by(() => {
		const ts: number[] = [];
		for (const pin of pinStore.pins) {
			if (pin.timestamp) {
				const t = new Date(pin.timestamp).getTime();
				if (!isNaN(t)) ts.push(t);
			}
		}
		for (const d of drawingStore.drawings) {
			if (d.timestamp) {
				const t = new Date(d.timestamp).getTime();
				if (!isNaN(t)) ts.push(t);
			}
			if (d.endTimestamp) {
				const t = new Date(d.endTimestamp).getTime();
				if (!isNaN(t)) ts.push(t);
			}
		}
		return ts.sort((a, b) => a - b);
	});
	let timelineMin = $derived(allTimestamps.length > 0 ? allTimestamps[0] : 0);
	let timelineMax = $derived(allTimestamps.length > 0 ? allTimestamps[allTimestamps.length - 1] : 0);
	let hasTimestamps = $derived(allTimestamps.length > 0);
	let timeFilter = $derived(timelineActive ? timelineTime : null);
	let timelineHiddenLayers = $derived.by(() => {
		if (!timelineActive || timelineLayers.size === 0) return new Set<string>();
		const hidden = new Set<string>();
		for (const l of layerStore.layers) {
			if (!timelineLayers.has(l.id)) hidden.add(l.id);
		}
		return hidden;
	});

	let nearbyState = $state<{
		phase: 'search' | 'results';
		lat: number;
		lng: number;
		radius: number;
		query: string;
		searching: boolean;
		results: NearbyResult[];
		selected: Set<string>;
		targetLayerId: string;
	} | null>(null);

	let nearbyInputEl = $state<HTMLInputElement | null>(null);

	let searchCircle = $derived(
		nearbyState ? { lat: nearbyState.lat, lng: nearbyState.lng, radius: nearbyState.radius } : null
	);
	let searchResultsForMap = $derived(
		nearbyState?.phase === 'results'
			? nearbyState.results
					.filter((r) => nearbyState!.selected.has(r.id))
					.map((r) => ({ lat: r.lat, lng: r.lng, name: r.name }))
			: []
	);

	const RADIUS_OPTIONS = [
		{ label: '250m', value: 250 },
		{ label: '500m', value: 500 },
		{ label: '1 km', value: 1000 },
		{ label: '2 km', value: 2000 },
		{ label: '5 km', value: 5000 },
		{ label: '10 km', value: 10000 }
	];

	// Removes routes that reference deleted pins
	$effect(() => {
		const pinIds = new Set(pinStore.pins.map((p) => p.id));
		const cleaned = routes.filter((r) => r.waypointIds.every((id) => pinIds.has(id)));
		if (cleaned.length !== routes.length) {
			routes = cleaned;
		}
	});

	$effect(() => {
		if (drawingStore.mode === 'note' && drawingStore.currentPoints.length >= 1 && !showNoteModal) {
			showNoteModal = true;
			noteText = '';
			requestAnimationFrame(() => {
				noteInputEl?.focus();
			});
		}
	});

	// Propagates timestamps from path/arrow drawings to their waypoint pins
	$effect(() => {
		const drawings = drawingStore.drawings;
		for (const drawing of drawings) {
			if (!drawing.waypointPinIds || !drawing.timestamp || !drawing.endTimestamp) continue;
			if (drawing.waypointPinIds.length < 2) continue;

			const tStart = new Date(drawing.timestamp).getTime();
			const tEnd = new Date(drawing.endTimestamp).getTime();
			if (isNaN(tStart) || isNaN(tEnd) || tEnd <= tStart) continue;

			const pins = untrack(() => pinStore.pins);
			const wpPins = drawing.waypointPinIds
				.map(id => pins.find(p => p.id === id))
				.filter((p): p is NonNullable<typeof p> => !!p);
			if (wpPins.length < 2) continue;

			const distances: number[] = [0];
			let totalDist = 0;
			for (let i = 1; i < wpPins.length; i++) {
				const dlat = wpPins[i].lat - wpPins[i - 1].lat;
				const dlng = (wpPins[i].lng - wpPins[i - 1].lng) * Math.cos(((wpPins[i].lat + wpPins[i - 1].lat) / 2) * Math.PI / 180);
				totalDist += Math.sqrt(dlat * dlat + dlng * dlng);
				distances.push(totalDist);
			}

			for (let i = 0; i < wpPins.length; i++) {
				const fraction = totalDist > 0 ? distances[i] / totalDist : i / (wpPins.length - 1);
				const pinTime = new Date(tStart + fraction * (tEnd - tStart)).toISOString();
				if (wpPins[i].timestamp !== pinTime) {
					pinStore.updatePin(wpPins[i].id, { timestamp: pinTime });
				}
			}
		}
	});

	// Confirms the note text and places it on the map
	function confirmNote() {
		historyStore.push('Added note');
		drawingStore.finishDrawing(undefined, noteText || 'Note');
		showNoteModal = false;
		noteText = '';
	}

	// Cancels the note modal and clears drawing state
	function cancelNote() {
		drawingStore.cancelDrawing();
		showNoteModal = false;
		noteText = '';
	}

	let splitRatio = $state(0.65);
	let isDragging = $state(false);
	let splitContainer: HTMLDivElement;

	onMount(async () => {
		const urlParams = new URLSearchParams(window.location.search);
		if (urlParams.get('embed') === 'true') embedMode = true;
		if (urlParams.get('readonly') === 'true') readonlyMode = true;

		const hash = window.location.hash;
		if (hash.startsWith('#s=')) {
			const hashData = hash.slice(3);
			if (isEncryptedHash(hashData)) {
				pendingEncryptedHash = hashData;
				showDecryptModal = true;
				requestAnimationFrame(() => decryptPasswordInputEl?.focus());
			} else {
				const result = await decodeMapState(hashData);
				if (result) {
					if (result.center) initialCenter = result.center;
					if (result.zoom) initialZoom = result.zoom;
					if (result.routes) routes = result.routes;
					if (result.travelMode) travelMode = result.travelMode;
					if (result.viewSettings) {
						labelsVisible = result.viewSettings.labelsVisible;
						notesVisible = result.viewSettings.notesVisible;
						heatmapEnabled = result.viewSettings.heatmapEnabled;
						isSatellite = result.viewSettings.isSatellite;
						tiltEnabled = result.viewSettings.tiltEnabled;
						pinLabelsVisible = result.viewSettings.pinLabelsVisible;
						poiLabelsVisible = result.viewSettings.poiLabelsVisible;
						routesVisible = result.viewSettings.routesVisible;
						if (result.viewSettings.embedMode) embedMode = true;
						if (result.viewSettings.readonlyMode) readonlyMode = true;
					}
				}
			}
		}

		if (embedMode) {
			splashVisible = false;
		} else {
			setTimeout(() => {
				splashFading = true;
				setTimeout(() => { splashVisible = false; }, 500);
			}, 1400);
		}
	});

	// Initiates the vertical panel divider drag
	function startDrag(e: MouseEvent) {
		isDragging = true;
		e.preventDefault();
	}

	// Updates split ratio while dragging the divider
	function onDrag(e: MouseEvent) {
		if (!isDragging || !splitContainer) return;
		const rect = splitContainer.getBoundingClientRect();
		const ratio = (e.clientY - rect.top) / rect.height;
		splitRatio = Math.max(0.2, Math.min(0.85, ratio));
	}

	// Ends divider drag and triggers map resize
	function stopDrag() {
		if (isDragging) {
			isDragging = false;
			mapComponent?.invalidateSize();
			bottomPanelComponent?.invalidateStreetView();
		}
	}

	// Toggles sidebar visibility and resizes the map
	function handleToggleSidebar() {
		sidebarOpen = !sidebarOpen;
		mapComponent?.invalidateSize();
	}

	// Opens the share modal for optional password encryption
	function handleShare() {
		sharePassword = '';
		shareEmbed = false;
		shareReadonly = false;
		showShareModal = true;
		requestAnimationFrame(() => sharePasswordInputEl?.focus());
	}

	// Generates a share URL (optionally encrypted) and copies it to clipboard
	async function confirmShare(withPassword: boolean) {
		const center = mapComponent?.getCenter();
		const zoom = mapComponent?.getZoom();
		const password = withPassword && sharePassword ? sharePassword : undefined;
		const url = await getShareUrl(center, zoom, routes, travelMode, { labelsVisible, notesVisible, heatmapEnabled, isSatellite, tiltEnabled, pinLabelsVisible, poiLabelsVisible, routesVisible, embedMode: shareEmbed, readonlyMode: shareReadonly }, password);
		navigator.clipboard.writeText(url);
		showShareModal = false;
		sharePassword = '';
		headerComponent?.showCopied();
	}

	// Attempts to decrypt and load an encrypted share link
	async function attemptDecrypt() {
		decryptError = false;
		const result = await decodeMapState(pendingEncryptedHash, decryptPassword);
		if (!result) {
			decryptError = true;
			return;
		}
		if (result.center) initialCenter = result.center;
		if (result.zoom) initialZoom = result.zoom;
		if (result.routes) routes = result.routes;
		if (result.travelMode) travelMode = result.travelMode;
		if (result.viewSettings) {
			labelsVisible = result.viewSettings.labelsVisible;
			notesVisible = result.viewSettings.notesVisible;
			heatmapEnabled = result.viewSettings.heatmapEnabled;
			isSatellite = result.viewSettings.isSatellite;
			tiltEnabled = result.viewSettings.tiltEnabled;
			pinLabelsVisible = result.viewSettings.pinLabelsVisible;
			poiLabelsVisible = result.viewSettings.poiLabelsVisible;
			routesVisible = result.viewSettings.routesVisible;
			if (result.viewSettings.embedMode) embedMode = true;
			if (result.viewSettings.readonlyMode) readonlyMode = true;
		}
		if (result.center && result.zoom) {
			mapComponent?.setView(result.center, result.zoom);
		}
		if (result.viewSettings?.isSatellite) {
			mapComponent?.setMapType(true);
		}
		showDecryptModal = false;
		decryptPassword = '';
		pendingEncryptedHash = '';
	}

	// Exports the current map state as a downloadable JSON file
	function handleExport() {
		const center = mapComponent?.getCenter();
		const zoom = mapComponent?.getZoom();
		const data = buildExportData(center, zoom, routes, travelMode, labelsVisible, notesVisible, heatmapEnabled, isSatellite, tiltEnabled, pinLabelsVisible, poiLabelsVisible, routesVisible);
		downloadJson(data);
	}

	function handleExportCsv() {
		exportCsv(pinStore.pins);
	}

	// Opens a file picker to import a previously exported JSON file
	async function handleImport() {
		const result = await openImportDialog();
		if (result) {
			if (result.center) mapComponent?.flyTo(result.center.lat, result.center.lng);
			routes = result.routes;
			travelMode = result.travelMode;
			labelsVisible = result.labelsVisible;
			notesVisible = result.notesVisible;
			heatmapEnabled = result.heatmapEnabled;
			isSatellite = result.isSatellite;
			tiltEnabled = result.tiltEnabled;
			pinLabelsVisible = result.pinLabelsVisible;
			poiLabelsVisible = result.poiLabelsVisible;
			routesVisible = result.routesVisible;
		}
	}

	// Opens a file picker for CSV, parses it, and shows the column mapping modal
	function handleImportCsv() {
		showCsvWalkthrough = true;
	}

	async function handleCsvFilePick() {
		showCsvWalkthrough = false;
		const text = await openCsvFileDialog();
		if (!text) return;
		const allRows = parseCsv(text);
		if (allRows.length === 0) return;

		if (hasHeaderRow(allRows[0])) {
			csvHeaders = allRows[0];
			csvRows = allRows.slice(1);
			const detected = detectColumns(csvHeaders);
			csvLabelCol = detected.label;
			if (detected.lat >= 0 && detected.lng >= 0) {
				csvLatCol = detected.lat;
				csvLngCol = detected.lng;
			} else {
					const fromData = detectColumnsFromData(csvRows);
				csvLatCol = fromData.lat;
				csvLngCol = fromData.lng;
			}
			if (detected.date >= 0 && detected.time >= 0) {
				csvTimestampMode = 'separate';
				csvDateCol = detected.date;
				csvTimeCol = detected.time;
				csvTimestampCol = -1;
			} else {
				csvTimestampMode = 'combined';
				csvTimestampCol = detected.timestamp;
				csvDateCol = -1;
				csvTimeCol = -1;
			}
		} else {
			csvHeaders = allRows[0].map((_, i) => `Column ${i + 1}`);
			csvRows = allRows;
			const detected = detectColumnsFromData(allRows);
			csvLatCol = detected.lat;
			csvLngCol = detected.lng;
			csvLabelCol = -1;
			csvTimestampMode = 'combined';
			csvTimestampCol = detected.timestamp;
			csvDateCol = -1;
			csvTimeCol = -1;
		}
		showCsvModal = true;
	}

	// Imports the mapped CSV rows as pins, deduplicating first
	function confirmCsvImport() {
		if (csvLatCol < 0 || csvLngCol < 0) return;
		historyStore.push('Imported CSV');
		const uniqueRows = deduplicateRows(csvRows, csvLatCol, csvLngCol);
		const addedPoints: { lat: number; lng: number }[] = [];

		for (const row of uniqueRows.slice(0, MAX_CSV_PINS)) {
			const coords = validateCoords(row[csvLatCol], row[csvLngCol])!;
			const label = csvLabelCol >= 0 && row[csvLabelCol]?.trim()
				? row[csvLabelCol].trim()
				: undefined;
			let timestamp: string | null | undefined;
			if (csvTimestampMode === 'combined' && csvTimestampCol >= 0 && row[csvTimestampCol]?.trim()) {
				timestamp = parseTimestamp(row[csvTimestampCol]);
			} else if (csvTimestampMode === 'separate' && csvDateCol >= 0) {
				const dateStr = row[csvDateCol] ?? '';
				const timeStr = csvTimeCol >= 0 ? (row[csvTimeCol] ?? '') : '';
				timestamp = combineDateAndTime(dateStr, timeStr);
			}
			if (!timestamp) timestamp = undefined;
			const pin = pinStore.addPin(coords.lat, coords.lng);
			const updates: Record<string, string> = {};
			if (label) updates.label = label;
			if (timestamp) updates.timestamp = timestamp;
			if (Object.keys(updates).length > 0) pinStore.updatePin(pin.id, updates);
			addedPoints.push(coords);
		}

		showCsvModal = false;
		csvRows = [];
		csvHeaders = [];
		csvLatCol = -1;
		csvLngCol = -1;
		csvLabelCol = -1;
		csvTimestampCol = -1;
		csvTimestampMode = 'combined';
		csvDateCol = -1;
		csvTimeCol = -1;
		if (addedPoints.length > 0) mapComponent?.fitBounds(addedPoints);
	}

	function cancelCsvImport() {
		showCsvModal = false;
		csvRows = [];
		csvHeaders = [];
		csvLatCol = -1;
		csvLngCol = -1;
		csvLabelCol = -1;
		csvTimestampCol = -1;
		csvTimestampMode = 'combined';
		csvDateCol = -1;
		csvTimeCol = -1;
	}

	// Saves a calculated route as a drawing path
	function handleSaveRouteAsPath(routeIndex: number) {
		const route = routes[routeIndex];
		if (!route) return;
		historyStore.push('Saved route as path');

		const routeSegPaths = routePaths[routeIndex];
		let pathPoints: DrawingPoint[] = [];

		if (routeSegPaths && routeSegPaths.some(seg => seg.length > 0)) {
			for (const seg of routeSegPaths) {
				if (seg.length > 0) {
						if (pathPoints.length > 0 && seg.length > 0) {
						const last = pathPoints[pathPoints.length - 1];
						const first = seg[0];
						if (Math.abs(last.lat - first.lat) < 0.00001 && Math.abs(last.lng - first.lng) < 0.00001) {
							pathPoints.push(...seg.slice(1));
						} else {
							pathPoints.push(...seg);
						}
					} else {
						pathPoints.push(...seg);
					}
				}
			}
		}

		if (pathPoints.length < 2) {
			pathPoints = [];
			for (const wpId of route.waypointIds) {
				const pin = pinStore.pins.find(p => p.id === wpId);
				if (pin) pathPoints.push({ lat: pin.lat, lng: pin.lng });
			}
		}

		if (pathPoints.length < 2) return;

		if (pathPoints.length > 200) {
			const step = Math.ceil(pathPoints.length / 200);
			const simplified = [pathPoints[0]];
			for (let i = step; i < pathPoints.length - 1; i += step) {
				simplified.push(pathPoints[i]);
			}
			simplified.push(pathPoints[pathPoints.length - 1]);
			pathPoints = simplified;
		}

		const activeLayer = layerStore.layers.find(l => l.id === layerStore.activeLayerId);
		const color = activeLayer?.color ?? '#22d3ee';

		const drawing = {
			id: `draw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			type: 'path' as const,
			points: pathPoints,
			color,
			strokeWidth: 2,
			label: `Route ${routeIndex + 1}`,
			layerId: layerStore.activeLayerId,
			waypointPinIds: route.waypointIds
		};
		drawingStore.loadDrawings([...drawingStore.drawings, drawing]);

		routes = routes.filter((_, i) => i !== routeIndex);
	}

	// Activates or deactivates the timeline scrubber
	function toggleTimeline() {
		if (!timelineActive) {
			timelineActive = true;
			timelineTime = timelineMin;
			timelinePlaying = false;
		} else {
			timelineActive = false;
			timelinePlaying = false;
			if (timelineAnimFrame) cancelAnimationFrame(timelineAnimFrame);
		}
	}

	// Toggles timeline play/pause state
	function toggleTimelinePlay() {
		if (!timelineActive) return;
		timelinePlaying = !timelinePlaying;
		if (timelinePlaying) {
			if (timelineTime >= timelineMax) timelineTime = timelineMin;
			animateTimeline();
		} else {
			if (timelineAnimFrame) cancelAnimationFrame(timelineAnimFrame);
		}
	}

	// Advances timeline position each animation frame
	function animateTimeline() {
		if (!timelinePlaying || !timelineActive) return;
		const range = timelineMax - timelineMin;
		if (range <= 0) { timelinePlaying = false; return; }
		const step = (range / (10000 / 16)) * timelineSpeed;
		timelineTime = Math.min(timelineTime + step, timelineMax);
		if (timelineTime >= timelineMax) {
			timelinePlaying = false;
		} else {
			timelineAnimFrame = requestAnimationFrame(animateTimeline);
		}
	}

	// Clears all pins and drawings after confirmation
	function handleClearAll() {
		if (pinStore.pins.length === 0 && drawingStore.drawings.length === 0) return;
		if (!confirm('Clear all pins and drawings?')) return;
		historyStore.push('Cleared all');
		pinStore.clearAll();
		drawingStore.clearAll();
	}

	// Toggles between map and satellite view
	function handleToggleSatellite() {
		isSatellite = !isSatellite;
	}

	// Pans the map to the given coordinates
	function handleFlyTo(lat: number, lng: number) {
		mapComponent?.flyTo(lat, lng);
	}

	// Handles Delete/Backspace to remove and Ctrl+Z/Y for undo/redo
	function handleKeydown(e: KeyboardEvent) {
		if (readonlyMode || embedMode) return;
		const tag = (e.target as HTMLElement)?.tagName;
		const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

		if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !isInput) {
			e.preventDefault();
			historyStore.undo();
			return;
		}

		if (((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey) && !isInput)
			|| ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && e.shiftKey && !isInput)) {
			e.preventDefault();
			historyStore.redo();
			return;
		}

		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (isInput) return;

			if (pinStore.selectedPinId) {
				historyStore.push('Removed pin');
				pinStore.removePin(pinStore.selectedPinId);
				pinStore.selectedPinId = null;
			} else if (drawingStore.selectedDrawingId) {
				historyStore.push('Removed drawing');
				drawingStore.removeDrawing(drawingStore.selectedDrawingId);
				drawingStore.selectedDrawingId = null;
			}
		}
	}

	// Opens the right-click context menu at the given coordinates
	function handleContextMenu(lat: number, lng: number, x: number, y: number) {
		ctxMenu = { show: true, x, y, lat, lng };
	}

	// Adds a pin from the context menu
	function handleCtxAddPin() {
		mapComponent?.addPinAt(ctxMenu.lat, ctxMenu.lng);
		ctxMenu.show = false;
	}

	// Opens the nearby search panel from the context menu
	function handleCtxSearchNearby() {
		const { lat, lng } = ctxMenu;
		ctxMenu.show = false;
		nearbyState = {
			phase: 'search',
			lat,
			lng,
			radius: 1000,
			query: '',
			searching: false,
			results: [],
			selected: new Set(),
			targetLayerId: layerStore.activeLayerId
		};
		mapComponent?.flyTo(lat, lng);
		requestAnimationFrame(() => nearbyInputEl?.focus());
	}

	// Executes the nearby search using Places API
	async function doNearbySearch() {
		if (!nearbyState || !nearbyState.query.trim()) return;
		nearbyState.searching = true;
		const results = await mapComponent.searchNearby(
			nearbyState.lat, nearbyState.lng, nearbyState.radius, nearbyState.query
		);
		nearbyState.results = results;
		nearbyState.selected = new Set(results.map((r) => r.id));
		nearbyState.phase = 'results';
		nearbyState.searching = false;
	}

	// Toggles whether a search result is selected for keeping
	function toggleNearbyResult(id: string) {
		if (!nearbyState) return;
		const next = new Set(nearbyState.selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		nearbyState.selected = next;
	}

	// Creates pins from selected search results in the chosen layer
	function keepSelectedResults() {
		if (!nearbyState) return;
		historyStore.push('Added nearby results');
		const layerId = nearbyState.targetLayerId;
		for (const result of nearbyState.results) {
			if (nearbyState.selected.has(result.id)) {
				const pin = pinStore.addPin(result.lat, result.lng, layerId);
				pinStore.updatePin(pin.id, { label: result.name });
			}
		}
		nearbyState = null;
	}

	// Handles layer selection change for nearby results, including creating a new layer
	function handleNearbyLayerChange(value: string) {
		if (!nearbyState) return;
		if (value === '__new__') {
			const colorIdx = layerStore.layers.length % LAYER_COLORS.length;
			const layer = layerStore.addLayer(`Layer ${layerStore.layers.length}`, LAYER_COLORS[colorIdx]);
			nearbyState.targetLayerId = layer.id;
		} else {
			nearbyState.targetLayerId = value;
		}
	}

	// Closes the nearby search panel and clears temp markers
	function closeNearbySearch() {
		nearbyState = null;
	}

	// Intercepts drawing finish to prompt for a label
	function handleDrawingFinish(radius?: number) {
		pendingDrawingRadius = radius;
		drawingLabelText = '';
		showDrawingLabelModal = true;
		requestAnimationFrame(() => drawingLabelInputEl?.focus());
	}

	// Confirms the drawing label and completes the drawing
	function confirmDrawingLabel() {
		historyStore.push('Finished drawing');
		drawingStore.finishDrawing(pendingDrawingRadius, undefined, drawingLabelText.trim() || undefined);
		showDrawingLabelModal = false;
		drawingLabelText = '';
		pendingDrawingRadius = undefined;
	}

	// Cancels drawing label prompt and discards the drawing
	function cancelDrawingLabel() {
		drawingStore.cancelDrawing();
		showDrawingLabelModal = false;
		drawingLabelText = '';
		pendingDrawingRadius = undefined;
	}
</script>

<svelte:window onmousemove={onDrag} onmouseup={stopDrag} onkeydown={handleKeydown} onclick={() => { ctxMenu.show = false; labelsDropdownOpen = false; clusterDropdownOpen = false; timelineLayerPickerOpen = false; }} />

{#if splashVisible}
	<div class="splash" class:splash-fade={splashFading}>
		<div class="splash-grid"></div>
		<div class="splash-particles">
			{#each Array(12) as _, i}
				<div class="particle" style="--i:{i};"></div>
			{/each}
		</div>
		<div class="splash-ring"></div>
		<div class="splash-content">
			<img src="/scatter_logo.png" alt="Scatter" class="splash-logo" />
			<div class="splash-text">SCATTER</div>
			<div class="splash-bar"><div class="splash-bar-fill"></div></div>
		</div>
	</div>
{/if}

<div class="small-screen-warning">
	<div class="ssw-content">
		<svg xmlns="http://www.w3.org/2000/svg" class="ssw-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
			<path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
		</svg>
		<span class="ssw-title">Desktop Required</span>
		<span class="ssw-text">This tool requires a larger screen. Please switch to a desktop or laptop browser.</span>
	</div>
</div>

<div class="app" class:embed={embedMode}>
	{#if !embedMode}
		<Header
			bind:this={headerComponent}
			onToggleSidebar={handleToggleSidebar}
			{sidebarOpen}
			onShare={handleShare}
			onExport={handleExport}
			onImport={handleImport}
			onImportCsv={handleImportCsv}
			onExportCsv={handleExportCsv}
			onExportImage={() => mapComponent?.exportImage()}
			onClearAll={handleClearAll}
			onUndo={() => historyStore.undo()}
			onRedo={() => historyStore.redo()}
			canUndo={historyStore.canUndo}
			canRedo={historyStore.canRedo}
			{cursorLat}
			{cursorLng}
		/>
	{/if}

	<div class="body">
		{#if sidebarOpen && !embedMode}
			<Sidebar
				{routes}
				{routeResults}
				{notesVisible}
				{labelsVisible}
				{travelMode}
				onRoutesChange={(r) => (routes = r)}
				onNotesVisibleChange={(v) => (notesVisible = v)}
				onLabelsVisibleChange={(v) => (labelsVisible = v)}
				onTravelModeChange={(m) => (travelMode = m)}
				onFlyTo={handleFlyTo}
				onSaveRouteAsPath={handleSaveRouteAsPath}
				onFilteredPinIds={(ids) => filteredPinIds = ids}
			/>
		{/if}

		<div class="main-col" bind:this={splitContainer}>
			<div class="map-section" style="flex: {embedMode ? 1 : splitRatio};">
				<Map
					bind:this={mapComponent}
					{apiKey}
					{routes}
					{notesVisible}
					{labelsVisible}
					{pinLabelsVisible}
					{poiLabelsVisible}
					{isSatellite}
					{tiltEnabled}
					{travelMode}
					{heatmapEnabled}
					{initialCenter}
					{initialZoom}
					onRoutesCalculated={(r) => (routeResults = r)}
					onRoutePathsUpdated={(p) => (routePaths = p)}
					onCursorMove={(lat, lng) => {
						cursorLat = lat;
						cursorLng = lng;
					}}
					onContextMenu={readonlyMode || embedMode ? undefined : handleContextMenu}
					{searchCircle}
					searchResults={searchResultsForMap}
					onDrawingFinish={handleDrawingFinish}
					{clusterMaxZoom}
					{routesVisible}
					{timeFilter}
					{timelineHiddenLayers}
					hiddenPinIds={filteredPinIds}
				/>

				{#if !embedMode}
				<div class="controls-top">
					<div class="controls-left">
						<button
							class="ctrl-btn"
							class:active={isSatellite}
							onclick={handleToggleSatellite}
							title={isSatellite ? 'Map' : 'Satellite'}
						>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
								{#if isSatellite}
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
								{:else}
									<path stroke-linecap="round" stroke-linejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								{/if}
							</svg>
						</button>
						<button
							class="ctrl-btn"
							class:active={heatmapEnabled}
							onclick={() => (heatmapEnabled = !heatmapEnabled)}
							title={heatmapEnabled ? 'Hide heatmap' : 'Show heatmap'}
						>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
							</svg>
						</button>
						<div class="ctrl-dropdown-wrap">
							<button
								class="ctrl-btn"
								class:active={labelsDropdownOpen}
								onclick={(e) => { e.stopPropagation(); labelsDropdownOpen = !labelsDropdownOpen; }}
								title="Labels"
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
								</svg>
							</button>
							{#if labelsDropdownOpen}
								<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
								<div class="ctrl-dropdown" onclick={(e) => e.stopPropagation()}>
									<span class="ctrl-dropdown-title">LABELS</span>
									<label class="ctrl-toggle-row">
										<input type="checkbox" bind:checked={pinLabelsVisible} />
										<span>Pin names</span>
									</label>
									<label class="ctrl-toggle-row">
										<input type="checkbox" bind:checked={labelsVisible} />
										<span>Annotation labels</span>
									</label>
									<label class="ctrl-toggle-row">
										<input type="checkbox" bind:checked={poiLabelsVisible} />
										<span>Businesses / POI</span>
									</label>
									<label class="ctrl-toggle-row">
										<input type="checkbox" bind:checked={routesVisible} />
										<span>Routes</span>
									</label>
								</div>
							{/if}
						</div>
						<div class="ctrl-dropdown-wrap">
							<button
								class="ctrl-btn"
								class:active={clusterDropdownOpen}
								onclick={(e) => { e.stopPropagation(); clusterDropdownOpen = !clusterDropdownOpen; }}
								title="Clustering"
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
									<circle cx="8" cy="8" r="3" /><circle cx="16" cy="16" r="3" /><circle cx="16" cy="8" r="2" /><circle cx="8" cy="16" r="2" />
								</svg>
							</button>
							{#if clusterDropdownOpen}
								<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
								<div class="ctrl-dropdown" onclick={(e) => e.stopPropagation()}>
									<span class="ctrl-dropdown-title">CLUSTER UNTIL ZOOM</span>
									<div class="ctrl-slider-row">
										<input type="range" class="ctrl-range" min="0" max="22" step="1" bind:value={clusterMaxZoom} />
										<span class="ctrl-slider-val">{clusterMaxZoom}</span>
									</div>
									<div class="ctrl-slider-hints">
										<span>Always separate</span>
										<span>Always group</span>
									</div>
								</div>
							{/if}
						</div>
						{#if isSatellite}
							<button
								class="ctrl-btn"
								class:active={tiltEnabled}
								onclick={() => (tiltEnabled = !tiltEnabled)}
								title={tiltEnabled ? 'Flat view' : '3D tilt'}
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
								</svg>
							</button>
						{/if}
						{#if hasTimestamps}
							<button
								class="ctrl-btn"
								class:active={timelineActive}
								onclick={toggleTimeline}
								title={timelineActive ? 'Close timeline' : 'Open timeline'}
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							</button>
							{#if timelineActive}
								<div class="timeline-panel">
									<div class="timeline-row">
										<button class="timeline-play" onclick={toggleTimelinePlay} title={timelinePlaying ? 'Pause' : 'Play'}>
											{#if timelinePlaying}
												<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
													<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
												</svg>
											{:else}
												<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
													<path d="M8 5v14l11-7z" />
												</svg>
											{/if}
										</button>
										<select class="timeline-speed" bind:value={timelineSpeed} title="Playback speed">
											<option value={0.25}>0.25x</option>
											<option value={0.5}>0.5x</option>
											<option value={1}>1x</option>
											<option value={2}>2x</option>
											<option value={5}>5x</option>
											<option value={10}>10x</option>
										</select>
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div class="tl-layer-picker" onclick={(e) => e.stopPropagation()}>
											<button
												class="tl-layer-btn"
												class:active={timelineLayers.size > 0}
												onclick={() => timelineLayerPickerOpen = !timelineLayerPickerOpen}
												title="Filter layers"
											>
												<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
													<path stroke-linecap="round" stroke-linejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-9.75 5.25m7.321-2.25l4.179 2.25-4.179 2.25m0 0L12 17.25l-5.571-3m11.142 0l4.179 2.25L12 21.75l-9.75-5.25 4.179-2.25" />
												</svg>
											</button>
											{#if timelineLayerPickerOpen}
												<div class="tl-layer-dropdown">
													{#each layerStore.layers as layer}
														<label class="tl-layer-option">
															<input
																type="checkbox"
																checked={timelineLayers.has(layer.id)}
																onchange={() => {
																	const next = new Set(timelineLayers);
																	if (next.has(layer.id)) next.delete(layer.id);
																	else next.add(layer.id);
																	timelineLayers = next;
																}}
															/>
															<span class="tl-layer-dot" style="background: {layer.color};"></span>
															<span class="tl-layer-name">{layer.name}</span>
														</label>
													{/each}
													{#if timelineLayers.size > 0}
														<button class="tl-layer-clear" onclick={() => timelineLayers = new Set()}>Show all</button>
													{/if}
												</div>
											{/if}
										</div>
									</div>
									<input
										type="range"
										class="timeline-scrubber"
										min={timelineMin}
										max={timelineMax}
										step={1000}
										bind:value={timelineTime}
										oninput={() => { timelinePlaying = false; if (timelineAnimFrame) cancelAnimationFrame(timelineAnimFrame); }}
									/>
									<span class="timeline-time">{timelineTime ? formatTimestamp(new Date(timelineTime).toISOString()) : ''}</span>
								</div>
							{/if}
						{/if}
					</div>

					{#if !readonlyMode}
						<DrawingToolbar onFinish={handleDrawingFinish} />
					{/if}
				</div>
			{/if}

				{#if drawingStore.mode !== 'none'}
					<div class="mode-badge">
						{drawingStore.mode.toUpperCase()}
					</div>
				{/if}

				{#if pinStore.pins.length === 0 && drawingStore.mode === 'none' && !nearbyState && !embedMode && !readonlyMode}
					<div class="map-hint">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
						</svg>
						<span>Right-click to add pins</span>
					</div>
				{/if}

	
				{#if nearbyState}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="nearby-panel" onkeydown={(e) => { if (e.key === 'Escape') closeNearbySearch(); }}>
						<div class="nearby-header">
							<span class="modal-title">
								{#if nearbyState.phase === 'search'}SEARCH NEARBY{:else}{nearbyState.results.length} RESULTS{/if}
							</span>
							<button class="modal-close" onclick={closeNearbySearch} title="Close">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>

						{#if nearbyState.phase === 'search'}
							<div class="nearby-body">
								<input
									bind:this={nearbyInputEl}
									type="text"
									class="nearby-input"
									placeholder="e.g. restaurant, park, hotel..."
									bind:value={nearbyState.query}
									onkeydown={(e) => { if (e.key === 'Enter') doNearbySearch(); }}
								/>
								<div class="nearby-section-label">RADIUS</div>
								<div class="radius-grid">
									{#each RADIUS_OPTIONS as opt}
										<button
											class="radius-btn"
											class:active={nearbyState.radius === opt.value}
											onclick={() => { if (nearbyState) nearbyState.radius = opt.value; }}
										>{opt.label}</button>
									{/each}
								</div>
								<button
									class="nearby-search-btn"
									onclick={doNearbySearch}
									disabled={!nearbyState.query.trim() || nearbyState.searching}
								>
									{#if nearbyState.searching}Searching...{:else}Search{/if}
								</button>
							</div>
						{:else}
							<div class="nearby-results">
								{#if nearbyState.results.length === 0}
									<div class="nearby-empty">No results found</div>
								{:else}
									<div class="nearby-results-actions">
										<button class="nearby-text-btn" onclick={() => { if (nearbyState) nearbyState.selected = new Set(nearbyState.results.map(r => r.id)); }}>Select All</button>
										<button class="nearby-text-btn" onclick={() => { if (nearbyState) nearbyState.selected = new Set(); }}>Deselect</button>
									</div>
									<div class="nearby-results-list">
										{#each nearbyState.results as result}
											<button
												class="nearby-result"
												class:selected={nearbyState.selected.has(result.id)}
												onclick={() => toggleNearbyResult(result.id)}
											>
												<div class="nearby-check" class:checked={nearbyState.selected.has(result.id)}>
													{#if nearbyState.selected.has(result.id)}
														<svg xmlns="http://www.w3.org/2000/svg" class="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
															<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
														</svg>
													{/if}
												</div>
												<div class="nearby-result-info">
													<span class="nearby-result-name">{result.name}</span>
													{#if result.address}
														<span class="nearby-result-addr">{result.address}</span>
													{/if}
												</div>
												{#if result.isOpen != null}
													<span class="nearby-result-open" class:open={result.isOpen}>{result.isOpen ? 'Open' : 'Closed'}</span>
												{/if}
												{#if result.rating}
													<span class="nearby-result-rating">{result.rating.toFixed(1)}</span>
												{/if}
											</button>
										{/each}
									</div>
								{/if}
							</div>
							<div class="nearby-layer-row">
								<span class="nearby-layer-label">ADD TO</span>
								<select
									class="nearby-layer-select"
									value={nearbyState.targetLayerId}
									onchange={(e) => handleNearbyLayerChange(e.currentTarget.value)}
								>
									{#each layerStore.layers as layer}
										<option value={layer.id}>{layer.name}</option>
									{/each}
									<option value="__new__">+ New Layer</option>
								</select>
							</div>
							<div class="nearby-footer">
								<button class="modal-btn cancel" onclick={closeNearbySearch}>Cancel</button>
								<button
									class="modal-btn confirm"
									onclick={keepSelectedResults}
									disabled={!nearbyState.selected.size}
								>Keep {nearbyState.selected.size} Pin{nearbyState.selected.size !== 1 ? 's' : ''}</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			{#if !embedMode}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="divider"
					class:dragging={isDragging}
					onmousedown={startDrag}
					role="separator"
					aria-label="Resize panels"
				>
					<div class="divider-grip"></div>
				</div>

				<div class="bottom-section" style="flex: {1 - splitRatio};">
					<BottomPanel bind:this={bottomPanelComponent} onFlyTo={handleFlyTo} />
				</div>
			{/if}
		</div>
	</div>

	{#if ctxMenu.show}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="ctx-menu" style="left: {ctxMenu.x}px; top: {ctxMenu.y}px;" onclick={(e) => e.stopPropagation()}>
			<div class="ctx-coords">{ctxMenu.lat.toFixed(6)}, {ctxMenu.lng.toFixed(6)}</div>
			<div class="ctx-sep"></div>
			<button class="ctx-item" onclick={handleCtxAddPin}>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
				<span>Add Pin</span>
			</button>
			<button class="ctx-item" onclick={handleCtxSearchNearby}>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
				<span>Search Nearby</span>
			</button>
			<button class="ctx-item" onclick={() => { navigator.clipboard.writeText(`${ctxMenu.lat.toFixed(6)}, ${ctxMenu.lng.toFixed(6)}`); ctxMenu.show = false; }}>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
				</svg>
				<span>Copy Coordinates</span>
			</button>
		</div>
	{/if}

	{#if showNoteModal}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={cancelNote} role="dialog" aria-modal="true" aria-label="Add note" onkeydown={(e) => { if (e.key === 'Escape') cancelNote(); }}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal" onclick={(e) => e.stopPropagation()} role="document">
				<div class="modal-header">
					<span class="modal-title">ADD NOTE</span>
					<button class="modal-close" onclick={cancelNote} title="Cancel">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="modal-body">
					<textarea
						bind:this={noteInputEl}
						bind:value={noteText}
						class="modal-textarea"
						placeholder="Type your note..."
						rows="3"
						maxlength={MAX_NOTE_TEXT_LENGTH}
						onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmNote(); } if (e.key === 'Escape') cancelNote(); }}
					></textarea>
				</div>
				<div class="modal-footer">
					<button class="modal-btn cancel" onclick={cancelNote}>Cancel</button>
					<button class="modal-btn confirm" onclick={confirmNote}>Place Note</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showDrawingLabelModal}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={cancelDrawingLabel} role="dialog" aria-modal="true" aria-label="Label drawing" onkeydown={(e) => { if (e.key === 'Escape') cancelDrawingLabel(); }}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal" onclick={(e) => e.stopPropagation()} role="document">
				<div class="modal-header">
					<span class="modal-title">LABEL DRAWING</span>
					<button class="modal-close" onclick={cancelDrawingLabel} title="Cancel">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="modal-body">
					<input
						bind:this={drawingLabelInputEl}
						type="text"
						class="nearby-input"
						placeholder="e.g. Danger Zone, Route A..."
						bind:value={drawingLabelText}
						onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmDrawingLabel(); } if (e.key === 'Escape') cancelDrawingLabel(); }}
					/>
				</div>
				<div class="modal-footer">
					<button class="modal-btn cancel" onclick={cancelDrawingLabel}>Cancel</button>
					<button class="modal-btn confirm" onclick={confirmDrawingLabel}>Save</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showShareModal}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={() => { showShareModal = false; }} role="dialog" aria-modal="true" aria-label="Share map" onkeydown={(e) => { if (e.key === 'Escape') { showShareModal = false; } }}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal" onclick={(e) => e.stopPropagation()} role="document">
				<div class="modal-header">
					<span class="modal-title">SHARE MAP</span>
					<button class="modal-close" onclick={() => { showShareModal = false; }} title="Cancel">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="modal-body">
					<div class="share-hint">Set a password to encrypt the share link, or share without encryption.</div>
					<input
						bind:this={sharePasswordInputEl}
						type="password"
						class="nearby-input"
						placeholder="Password (optional)"
						bind:value={sharePassword}
						onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmShare(!!sharePassword); } }}
					/>
					<div class="share-options">
						<label class="share-check">
							<input type="checkbox" bind:checked={shareReadonly} />
							<span>Read-only</span>
						</label>
						<label class="share-check">
							<input type="checkbox" bind:checked={shareEmbed} />
							<span>Embed mode</span>
						</label>
					</div>
				</div>
				<div class="modal-footer">
					<button class="modal-btn cancel" onclick={() => confirmShare(false)}>Share without password</button>
					<button class="modal-btn confirm" onclick={() => confirmShare(true)} disabled={!sharePassword}>Encrypt & Share</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showDecryptModal}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Enter password" onkeydown={(e) => { if (e.key === 'Escape') { showDecryptModal = false; } }}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal" onclick={(e) => e.stopPropagation()} role="document">
				<div class="modal-header">
					<span class="modal-title">ENCRYPTED MAP</span>
				</div>
				<div class="modal-body">
					<div class="share-hint">This map is password-protected. Enter the password to view it.</div>
					<input
						bind:this={decryptPasswordInputEl}
						type="password"
						class="nearby-input"
						class:decrypt-error={decryptError}
						placeholder="Enter password"
						bind:value={decryptPassword}
						onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); attemptDecrypt(); } }}
						oninput={() => { decryptError = false; }}
					/>
					{#if decryptError}
						<div class="decrypt-error-msg">Incorrect password</div>
					{/if}
				</div>
				<div class="modal-footer">
					<button class="modal-btn cancel" onclick={() => { showDecryptModal = false; }}>Cancel</button>
					<button class="modal-btn confirm" onclick={attemptDecrypt} disabled={!decryptPassword}>Decrypt</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showCsvWalkthrough}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={() => showCsvWalkthrough = false} role="dialog" aria-modal="true" aria-label="CSV Import Guide" onkeydown={(e) => { if (e.key === 'Escape') showCsvWalkthrough = false; }}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal csv-walkthrough-modal" onclick={(e) => e.stopPropagation()} role="document">
				<div class="modal-header">
					<span class="modal-title">CSV IMPORT</span>
					<button class="modal-close" onclick={() => showCsvWalkthrough = false} title="Cancel">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="modal-body">
					<div class="walkthrough-desc">Your CSV needs at minimum <strong>latitude</strong> and <strong>longitude</strong> columns. You can also include optional columns:</div>
					<div class="walkthrough-columns">
						<div class="walkthrough-col required">
							<span class="walkthrough-col-name">latitude</span>
							<span class="walkthrough-col-info">required</span>
						</div>
						<div class="walkthrough-col required">
							<span class="walkthrough-col-name">longitude</span>
							<span class="walkthrough-col-info">required</span>
						</div>
						<div class="walkthrough-col">
							<span class="walkthrough-col-name">label</span>
							<span class="walkthrough-col-info">name, title, description...</span>
						</div>
						<div class="walkthrough-col">
							<span class="walkthrough-col-name">timestamp</span>
							<span class="walkthrough-col-info">single column, or separate date + time</span>
						</div>
					</div>
					<div class="walkthrough-example">
						<div class="walkthrough-example-label">Example</div>
						<code class="walkthrough-example-code">lat,lng,name,date,time<br/>51.5074,-0.1278,London,25/12/2024,14:30:00<br/>48.8566,2.3522,Paris,26/12/2024,09:15:00</code>
					</div>
					<div class="walkthrough-note">Column names are auto-detected. Up to {MAX_CSV_PINS} rows will be imported.</div>
				</div>
				<div class="modal-footer">
					<button class="modal-btn cancel" onclick={() => showCsvWalkthrough = false}>Cancel</button>
					<button class="modal-btn confirm" onclick={handleCsvFilePick}>Pick CSV File</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showCsvModal}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={cancelCsvImport} role="dialog" aria-modal="true" aria-label="Import CSV" onkeydown={(e) => { if (e.key === 'Escape') cancelCsvImport(); }}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal csv-modal" onclick={(e) => e.stopPropagation()} role="document">
				<div class="modal-header">
					<span class="modal-title">IMPORT CSV</span>
					<button class="modal-close" onclick={cancelCsvImport} title="Cancel">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="modal-body">
					<div class="csv-mapping">
						<div class="csv-section-label">Column Mapping</div>
						<div class="csv-field">
							<label class="csv-label">Latitude</label>
							<select class="csv-select" bind:value={csvLatCol}>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						<div class="csv-field">
							<label class="csv-label">Longitude</label>
							<select class="csv-select" bind:value={csvLngCol}>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						<div class="csv-field">
							<label class="csv-label">Label <span class="csv-optional">optional</span></label>
							<select class="csv-select" bind:value={csvLabelCol}>
								<option value={-1}>None</option>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						<div class="csv-divider"></div>
						<div class="csv-field">
							<label class="csv-label">Timestamp <span class="csv-optional">optional</span></label>
							<div class="csv-timestamp-toggle">
								<button class="csv-toggle-btn" class:active={csvTimestampMode === 'combined'} onclick={() => { csvTimestampMode = 'combined'; csvDateCol = -1; csvTimeCol = -1; }}>Combined</button>
								<button class="csv-toggle-btn" class:active={csvTimestampMode === 'separate'} onclick={() => { csvTimestampMode = 'separate'; csvTimestampCol = -1; }}>Date + Time</button>
							</div>
						</div>
						{#if csvTimestampMode === 'combined'}
						<div class="csv-field csv-sub-field">
							<label class="csv-label csv-label-indent">Column</label>
							<select class="csv-select" bind:value={csvTimestampCol}>
								<option value={-1}>None</option>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						{:else}
						<div class="csv-field csv-sub-field">
							<label class="csv-label csv-label-indent">Date</label>
							<select class="csv-select" bind:value={csvDateCol}>
								<option value={-1}>None</option>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						<div class="csv-field csv-sub-field">
							<label class="csv-label csv-label-indent">Time</label>
							<select class="csv-select" bind:value={csvTimeCol}>
								<option value={-1}>None</option>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						{/if}
					</div>

					{#if csvLatCol >= 0 && csvLngCol >= 0}
						{@const stats = getCsvStats(csvRows, csvLatCol, csvLngCol)}
						<div class="csv-preview">
							<table class="csv-table">
								<thead>
									<tr>
										<th>Lat</th>
										<th>Lng</th>
										{#if csvLabelCol >= 0}<th>Label</th>{/if}
									</tr>
								</thead>
								<tbody>
									{#each csvRows.slice(0, 5) as row}
										{@const coords = validateCoords(row[csvLatCol], row[csvLngCol])}
										<tr class:csv-row-invalid={!coords}>
											<td>{row[csvLatCol] ?? ''}</td>
											<td>{row[csvLngCol] ?? ''}</td>
											{#if csvLabelCol >= 0}<td>{row[csvLabelCol] ?? ''}</td>{/if}
										</tr>
									{/each}
								</tbody>
							</table>
							{#if csvRows.length > 5}
								<div class="csv-more">... and {csvRows.length - 5} more rows</div>
							{/if}
						</div>
						<div class="csv-status">
							{#if stats.unique === 0}
								<span class="csv-error">No valid rows found. Check column mapping.</span>
							{:else if stats.unique > MAX_CSV_PINS}
								<span class="csv-warn">{stats.unique} unique rows{stats.duplicates > 0 ? ` (${stats.duplicates} duplicates removed)` : ''} — first {MAX_CSV_PINS} will be imported</span>
							{:else}
								<span class="csv-ok">{stats.unique} unique row{stats.unique === 1 ? '' : 's'} will be imported{stats.duplicates > 0 ? ` (${stats.duplicates} duplicate${stats.duplicates === 1 ? '' : 's'} removed)` : ''}</span>
							{/if}
						</div>
					{/if}
				</div>
				<div class="modal-footer">
					<button class="modal-btn cancel" onclick={cancelCsvImport}>Cancel</button>
					<button class="modal-btn confirm" onclick={confirmCsvImport} disabled={csvLatCol < 0 || csvLngCol < 0 || getCsvStats(csvRows, csvLatCol, csvLngCol).unique === 0}>Import</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.splash {
		position: fixed;
		inset: 0;
		background: #060a14;
		z-index: 99999;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		transition: opacity 0.5s ease, visibility 0.5s ease;
	}

	.splash-fade {
		opacity: 0;
		visibility: hidden;
	}

	.splash-grid {
		position: absolute;
		inset: -50%;
		background-image:
			linear-gradient(rgba(34, 211, 238, 0.04) 1px, transparent 1px),
			linear-gradient(90deg, rgba(34, 211, 238, 0.04) 1px, transparent 1px);
		background-size: 60px 60px;
		animation: gridDrift 20s linear infinite;
	}

	@keyframes gridDrift {
		0% { transform: translate(0, 0) rotate(0deg); }
		100% { transform: translate(60px, 60px) rotate(1deg); }
	}

	.splash-particles {
		position: absolute;
		inset: 0;
	}

	.particle {
		position: absolute;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: #f59e0b;
		opacity: 0;
		animation: particleFloat 3s ease-in-out infinite;
		animation-delay: calc(var(--i) * 0.25s);
		left: calc(20% + var(--i) * 5%);
		top: calc(30% + sin(var(--i)) * 20%);
	}

	.particle:nth-child(odd) {
		background: #22d3ee;
		width: 3px;
		height: 3px;
	}

	.particle:nth-child(3n) {
		width: 2px;
		height: 2px;
		background: rgba(245, 158, 11, 0.6);
	}

	@keyframes particleFloat {
		0% { opacity: 0; transform: translateY(20px) scale(0); }
		20% { opacity: 0.8; }
		80% { opacity: 0.6; }
		100% { opacity: 0; transform: translateY(-80px) scale(1.5); }
	}

	.splash-ring {
		position: absolute;
		width: 300px;
		height: 300px;
		border-radius: 50%;
		border: 1px solid rgba(34, 211, 238, 0.08);
		animation: ringPulse 2s ease-out infinite;
	}

	@keyframes ringPulse {
		0% { transform: scale(0.5); opacity: 0.4; border-color: rgba(245, 158, 11, 0.15); }
		50% { border-color: rgba(34, 211, 238, 0.1); }
		100% { transform: scale(1.8); opacity: 0; border-color: rgba(34, 211, 238, 0.02); }
	}

	.splash-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
		z-index: 1;
		animation: splashEntry 0.6s ease-out;
	}

	@keyframes splashEntry {
		0% { opacity: 0; transform: scale(0.85) translateY(12px); }
		100% { opacity: 1; transform: scale(1) translateY(0); }
	}

	.splash-logo {
		width: 120px;
		height: 120px;
		border-radius: 24px;
		object-fit: contain;
		filter: drop-shadow(0 0 40px rgba(245, 158, 11, 0.25)) drop-shadow(0 0 80px rgba(34, 211, 238, 0.15));
		animation: splashPulse 2s ease-in-out infinite alternate;
	}

	@keyframes splashPulse {
		0% { filter: drop-shadow(0 0 30px rgba(245, 158, 11, 0.2)) drop-shadow(0 0 60px rgba(34, 211, 238, 0.1)); }
		100% { filter: drop-shadow(0 0 50px rgba(245, 158, 11, 0.35)) drop-shadow(0 0 100px rgba(34, 211, 238, 0.25)); }
	}

	.splash-text {
		font-family: var(--font-mono);
		font-size: 32px;
		font-weight: 700;
		letter-spacing: 8px;
		color: #e2e8f0;
	}

	.splash-bar {
		width: 160px;
		height: 2px;
		background: #1e293b;
		border-radius: 2px;
		overflow: hidden;
		margin-top: 4px;
	}

	.splash-bar-fill {
		width: 0%;
		height: 100%;
		background: linear-gradient(90deg, #f59e0b, #22d3ee);
		border-radius: 2px;
		animation: splashLoad 1.2s ease-in-out forwards;
	}

	@keyframes splashLoad {
		0% { width: 0%; }
		60% { width: 70%; }
		100% { width: 100%; }
	}

	.small-screen-warning {
		display: none;
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: #060a14;
		align-items: center;
		justify-content: center;
	}

	@media (max-width: 1024px) {
		.small-screen-warning {
			display: flex;
		}
		.app {
			display: none !important;
		}
	}

	.ssw-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 40px;
		max-width: 360px;
		gap: 12px;
	}

	.ssw-icon {
		width: 48px;
		height: 48px;
		color: #334155;
		margin-bottom: 4px;
	}

	.ssw-title {
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 700;
		color: #e2e8f0;
		letter-spacing: 0.05em;
	}

	.ssw-text {
		font-family: var(--font-mono);
		font-size: 11px;
		color: #475569;
		line-height: 1.6;
	}

	.app {
		display: flex;
		flex-direction: column;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		background: #060a14;
		font-family: var(--font-mono);
	}

	.body {
		display: flex;
		flex: 1;
		overflow: hidden;
	}

	.main-col {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.map-section {
		position: relative;
		min-height: 0;
		overflow: hidden;
	}

	.controls-top {
		position: absolute;
		top: 10px;
		left: 10px;
		right: 10px;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		pointer-events: none;
		z-index: 10;
	}

	.controls-top > :global(*) {
		pointer-events: auto;
	}

	.controls-left {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.ctrl-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 6px;
		background: rgba(15, 23, 42, 0.92);
		backdrop-filter: blur(8px);
		border: 1px solid #1e293b;
		color: #64748b;
		cursor: pointer;
		transition: all 0.12s;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	.ctrl-btn:hover {
		color: #e2e8f0;
		border-color: #334155;
	}

	.ctrl-btn.active {
		color: #f59e0b;
		border-color: rgba(245, 158, 11, 0.25);
	}

	.ctrl-dropdown-wrap {
		position: relative;
	}

	.ctrl-dropdown {
		position: absolute;
		top: 0;
		left: calc(100% + 6px);
		background: rgba(15, 23, 42, 0.95);
		backdrop-filter: blur(8px);
		border: 1px solid #1e293b;
		border-radius: 6px;
		padding: 6px 10px;
		min-width: 150px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 20;
	}

	.ctrl-dropdown-title {
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #475569;
		padding-bottom: 2px;
		border-bottom: 1px solid #1e293b;
	}

	.ctrl-toggle-row {
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: #94a3b8;
		cursor: pointer;
		padding: 3px 0;
	}

	.ctrl-toggle-row input[type='checkbox'] {
		appearance: none;
		width: 14px;
		height: 14px;
		border: 1px solid #334155;
		border-radius: 3px;
		background: #111827;
		cursor: pointer;
		flex-shrink: 0;
		position: relative;
	}

	.ctrl-toggle-row input[type='checkbox']:checked {
		background: #f59e0b;
		border-color: #f59e0b;
	}

	.ctrl-toggle-row input[type='checkbox']:checked::after {
		content: '';
		position: absolute;
		left: 3.5px;
		top: 1px;
		width: 4px;
		height: 7px;
		border: solid #0a0f1a;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}

	.ctrl-slider-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
	}

	.ctrl-range {
		flex: 1;
		-webkit-appearance: none;
		appearance: none;
		height: 4px;
		border-radius: 2px;
		background: #1e293b;
		outline: none;
		cursor: pointer;
	}

	.ctrl-range::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #f59e0b;
		border: 2px solid #0a0f1a;
		cursor: pointer;
	}

	.ctrl-range::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #f59e0b;
		border: 2px solid #0a0f1a;
		cursor: pointer;
	}

	.ctrl-slider-val {
		font-family: var(--font-mono);
		font-size: 10px;
		color: #94a3b8;
		min-width: 32px;
		text-align: right;
	}

	.ctrl-slider-hints {
		display: flex;
		justify-content: space-between;
		font-family: var(--font-mono);
		font-size: 8px;
		color: #475569;
		padding: 0 2px;
	}

	.mode-badge {
		position: absolute;
		bottom: 12px;
		left: 50%;
		transform: translateX(-50%);
		padding: 4px 14px;
		border-radius: 4px;
		background: rgba(15, 23, 42, 0.92);
		backdrop-filter: blur(8px);
		border: 1px solid #1e293b;
		color: #94a3b8;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		z-index: 10;
		pointer-events: none;
		white-space: nowrap;
	}

	.map-hint {
		position: absolute;
		bottom: 12px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border-radius: 6px;
		background: rgba(15, 23, 42, 0.85);
		backdrop-filter: blur(8px);
		border: 1px solid #1e293b;
		color: #64748b;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 500;
		z-index: 10;
		pointer-events: none;
		white-space: nowrap;
		animation: hint-fade 0.5s ease-out;
	}

	@keyframes hint-fade {
		from { opacity: 0; transform: translateX(-50%) translateY(8px); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	.timeline-panel {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px;
		border-radius: 8px;
		background: rgba(10, 15, 26, 0.92);
		backdrop-filter: blur(12px);
		border: 1px solid #1e293b;
		font-family: var(--font-mono);
		width: 180px;
	}

	.timeline-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.timeline-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 1px solid #334155;
		background: transparent;
		color: #94a3b8;
		cursor: pointer;
		flex-shrink: 0;
	}

	.timeline-toggle:hover {
		color: #f59e0b;
		border-color: #f59e0b;
	}

	.timeline-play {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 1px solid #f59e0b;
		background: rgba(245, 158, 11, 0.1);
		color: #f59e0b;
		cursor: pointer;
		flex-shrink: 0;
	}

	.timeline-play:hover {
		background: rgba(245, 158, 11, 0.2);
	}

	.timeline-scrubber {
		width: 100%;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: #1e293b;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.timeline-scrubber::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #f59e0b;
		border: 2px solid #0a0f1a;
		cursor: pointer;
	}

	.timeline-scrubber::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #f59e0b;
		border: 2px solid #0a0f1a;
		cursor: pointer;
	}

	.timeline-time {
		font-size: 9px;
		color: #94a3b8;
		white-space: nowrap;
		text-align: left;
	}

	.timeline-speed {
		padding: 2px 4px;
		border-radius: 4px;
		border: 1px solid #1e293b;
		background: #111827;
		color: #94a3b8;
		font-size: 9px;
		font-family: var(--font-mono);
		cursor: pointer;
		outline: none;
	}

	.tl-layer-picker {
		position: relative;
	}

	.tl-layer-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 1px solid #334155;
		background: transparent;
		color: #94a3b8;
		cursor: pointer;
		flex-shrink: 0;
	}

	.tl-layer-btn:hover {
		color: #22d3ee;
		border-color: #22d3ee;
	}

	.tl-layer-btn.active {
		color: #22d3ee;
		border-color: #22d3ee;
		background: rgba(34, 211, 238, 0.1);
	}

	.tl-layer-dropdown {
		position: absolute;
		bottom: 100%;
		right: 0;
		margin-bottom: 6px;
		padding: 6px;
		border-radius: 6px;
		background: rgba(10, 15, 26, 0.95);
		backdrop-filter: blur(12px);
		border: 1px solid #1e293b;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 130px;
		z-index: 30;
	}

	.tl-layer-option {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 4px;
		border-radius: 3px;
		cursor: pointer;
		font-size: 10px;
		color: #cbd5e1;
		white-space: nowrap;
	}

	.tl-layer-option:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.tl-layer-option input[type="checkbox"] {
		width: 12px;
		height: 12px;
		accent-color: #22d3ee;
		cursor: pointer;
	}

	.tl-layer-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.tl-layer-name {
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100px;
	}

	.tl-layer-clear {
		padding: 3px 6px;
		border-radius: 3px;
		border: 1px solid #1e293b;
		background: transparent;
		color: #64748b;
		font-size: 9px;
		font-family: var(--font-mono);
		cursor: pointer;
		text-align: center;
		margin-top: 2px;
	}

	.tl-layer-clear:hover {
		color: #e2e8f0;
		border-color: #334155;
	}

	.divider {
		flex-shrink: 0;
		height: 6px;
		background: #0f172a;
		border-top: 1px solid #1e293b;
		border-bottom: 1px solid #1e293b;
		cursor: row-resize;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.1s;
	}

	.divider:hover,
	.divider.dragging {
		background: #1e293b;
	}

	.divider-grip {
		width: 32px;
		height: 2px;
		border-radius: 1px;
		background: #334155;
	}

	.divider:hover .divider-grip,
	.divider.dragging .divider-grip {
		background: #475569;
	}

	.bottom-section {
		min-height: 0;
		overflow: hidden;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
	}

	.modal {
		width: 360px;
		background: #0f172a;
		border: 1px solid #1e293b;
		border-radius: 12px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.03);
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 18px;
		border-bottom: 1px solid #1e293b;
		background: rgba(255, 255, 255, 0.01);
	}

	.modal-title {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #64748b;
	}

	.modal-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: #475569;
		cursor: pointer;
		transition: all 0.12s;
	}

	.modal-close:hover {
		color: #e2e8f0;
		background: rgba(255, 255, 255, 0.06);
	}

	.modal-body {
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.modal-textarea {
		width: 100%;
		padding: 10px 12px;
		border-radius: 8px;
		border: 1px solid #1e293b;
		background: #0a0f1a;
		color: #e2e8f0;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.5;
		resize: vertical;
		outline: none;
		transition: border-color 0.12s;
	}

	.modal-textarea:focus {
		border-color: #475569;
	}

	.modal-textarea::placeholder {
		color: #334155;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 14px 18px;
		border-top: 1px solid #1e293b;
		background: rgba(255, 255, 255, 0.01);
	}

	.modal-btn {
		padding: 8px 18px;
		border-radius: 6px;
		border: none;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		transition: all 0.12s;
	}

	.modal-btn.cancel {
		background: transparent;
		color: #64748b;
		border: 1px solid #1e293b;
	}

	.modal-btn.cancel:hover {
		color: #e2e8f0;
		border-color: #334155;
		background: rgba(255, 255, 255, 0.03);
	}

	.modal-btn.confirm {
		background: linear-gradient(135deg, #f59e0b, #22d3ee);
		color: #060a14;
	}

	.modal-btn.confirm:hover {
		background: linear-gradient(135deg, #fbbf24, #06b6d4);
	}

	.modal-btn.confirm:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.csv-modal {
		width: 440px;
	}

	.csv-mapping {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.csv-field {
		display: grid;
		grid-template-columns: 90px 1fr;
		align-items: center;
		gap: 12px;
	}

	.csv-label {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: #94a3b8;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.csv-optional {
		color: #475569;
		font-weight: 400;
		text-transform: none;
		font-size: 9px;
	}

	.csv-select {
		flex: 1;
		padding: 7px 10px;
		border-radius: 6px;
		border: 1px solid #1e293b;
		background: #0a0f1a;
		color: #e2e8f0;
		font-family: var(--font-mono);
		font-size: 11px;
		outline: none;
		transition: border-color 0.12s;
	}

	.csv-select:focus {
		border-color: #475569;
	}

	.csv-preview {
		border: 1px solid #1e293b;
		border-radius: 8px;
		overflow: hidden;
	}

	.csv-table {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-mono);
		font-size: 10px;
	}

	.csv-table th {
		padding: 6px 10px;
		text-align: left;
		color: #475569;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		background: rgba(255, 255, 255, 0.02);
		border-bottom: 1px solid #1e293b;
	}

	.csv-table td {
		padding: 5px 10px;
		color: #94a3b8;
		border-bottom: 1px solid rgba(30, 41, 59, 0.5);
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.csv-row-invalid td {
		color: #ef4444;
		opacity: 0.6;
	}

	.csv-more {
		padding: 5px 10px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: #475569;
		text-align: center;
	}

	.csv-status {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 2px 0;
	}

	.csv-ok {
		color: #22c55e;
	}

	.csv-warn {
		color: #f59e0b;
	}

	.csv-error {
		color: #ef4444;
	}

	.csv-timestamp-toggle {
		display: flex;
		gap: 0;
		flex: 1;
	}

	.csv-toggle-btn {
		flex: 1;
		padding: 6px 10px;
		border: 1px solid #1e293b;
		background: transparent;
		color: #64748b;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.12s;
	}

	.csv-toggle-btn:first-child {
		border-radius: 6px 0 0 6px;
		border-right: none;
	}

	.csv-toggle-btn:last-child {
		border-radius: 0 6px 6px 0;
	}

	.csv-toggle-btn.active {
		background: rgba(245, 158, 11, 0.12);
		color: #f59e0b;
		border-color: rgba(245, 158, 11, 0.3);
	}

	.csv-toggle-btn:hover:not(.active) {
		color: #e2e8f0;
		background: rgba(255, 255, 255, 0.03);
	}

	.csv-section-label {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #475569;
		margin-bottom: 2px;
	}

	.csv-divider {
		height: 1px;
		background: #1e293b;
		margin: 4px 0;
	}

	.csv-sub-field {
		padding-left: 12px;
		border-left: 2px solid #1e293b;
		margin-left: 4px;
	}

	.csv-label-indent {
		padding-left: 0;
		color: #64748b;
	}

	.csv-walkthrough-modal {
		width: 420px;
	}

	.walkthrough-desc {
		font-family: var(--font-mono);
		font-size: 11px;
		color: #94a3b8;
		line-height: 1.7;
	}

	.walkthrough-desc strong {
		color: #e2e8f0;
		font-weight: 600;
	}

	.walkthrough-columns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.walkthrough-col {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 12px;
		border-radius: 6px;
		border: 1px solid #1e293b;
		background: rgba(255, 255, 255, 0.02);
	}

	.walkthrough-col.required {
		border-color: rgba(34, 211, 238, 0.2);
		background: rgba(34, 211, 238, 0.04);
	}

	.walkthrough-col-name {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		color: #e2e8f0;
	}

	.walkthrough-col-info {
		font-family: var(--font-mono);
		font-size: 9px;
		color: #475569;
		line-height: 1.3;
	}

	.walkthrough-col.required .walkthrough-col-info {
		color: #22d3ee;
		opacity: 0.7;
	}

	.walkthrough-example {
		border: 1px solid #1e293b;
		border-radius: 6px;
		overflow: hidden;
	}

	.walkthrough-example-label {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: #475569;
		padding: 4px 10px;
		background: rgba(255, 255, 255, 0.02);
		border-bottom: 1px solid #1e293b;
	}

	.walkthrough-example-code {
		display: block;
		font-family: var(--font-mono);
		font-size: 10px;
		color: #94a3b8;
		padding: 8px 10px;
		line-height: 1.6;
		overflow-x: auto;
	}

	.walkthrough-note {
		font-family: var(--font-mono);
		font-size: 10px;
		color: #475569;
		text-align: center;
	}

	.ctx-menu {
		position: fixed;
		z-index: 200;
		background: rgba(15, 23, 42, 0.95);
		backdrop-filter: blur(12px);
		border: 1px solid #1e293b;
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		padding: 4px;
		min-width: 160px;
	}

	.ctx-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 12px;
		background: transparent;
		border: none;
		border-radius: 5px;
		color: #e2e8f0;
		font-family: var(--font-mono);
		font-size: 11px;
		cursor: pointer;
		transition: background 0.1s;
	}

	.ctx-item:hover {
		background: rgba(245, 158, 11, 0.1);
		color: #f59e0b;
	}

	.ctx-coords {
		padding: 6px 12px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		color: #64748b;
		user-select: text;
	}

	.ctx-sep {
		height: 1px;
		background: #1e293b;
		margin: 2px 4px;
	}

	.nearby-panel {
		position: absolute;
		top: 50px;
		left: 10px;
		z-index: 20;
		width: 280px;
		background: rgba(15, 23, 42, 0.95);
		backdrop-filter: blur(12px);
		border: 1px solid #1e293b;
		border-radius: 10px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		overflow: hidden;
		max-height: calc(100% - 60px);
		display: flex;
		flex-direction: column;
	}

	.nearby-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		border-bottom: 1px solid #1e293b;
		flex-shrink: 0;
	}

	.nearby-body {
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.nearby-input {
		width: 100%;
		padding: 8px 10px;
		border-radius: 6px;
		border: 1px solid #1e293b;
		background: #0a0f1a;
		color: #e2e8f0;
		font-family: var(--font-mono);
		font-size: 11px;
		outline: none;
		transition: border-color 0.12s;
	}

	.nearby-input:focus {
		border-color: #475569;
	}

	.nearby-input::placeholder {
		color: #334155;
	}

	.nearby-section-label {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: #334155;
	}

	.radius-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
	}

	.radius-btn {
		padding: 5px 4px;
		border-radius: 4px;
		border: 1px solid #1e293b;
		background: transparent;
		color: #64748b;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.12s;
	}

	.radius-btn:hover {
		border-color: #334155;
		color: #94a3b8;
	}

	.radius-btn.active {
		border-color: rgba(34, 211, 238, 0.4);
		color: #22d3ee;
		background: rgba(34, 211, 238, 0.08);
	}

	.nearby-search-btn {
		padding: 8px;
		border-radius: 6px;
		border: none;
		background: linear-gradient(135deg, #f59e0b, #22d3ee);
		color: #060a14;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		cursor: pointer;
		transition: opacity 0.12s;
	}

	.nearby-search-btn:hover {
		opacity: 0.9;
	}

	.nearby-search-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.nearby-results {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}

	.nearby-results-actions {
		display: flex;
		gap: 8px;
		padding: 8px 12px;
		border-bottom: 1px solid #111827;
		flex-shrink: 0;
	}

	.nearby-text-btn {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: #475569;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 3px;
	}

	.nearby-text-btn:hover {
		color: #94a3b8;
		background: rgba(255, 255, 255, 0.05);
	}

	.nearby-results-list {
		display: flex;
		flex-direction: column;
	}

	.nearby-result {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 8px 12px;
		background: transparent;
		border: none;
		border-bottom: 1px solid #111827;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
		width: 100%;
		font-family: var(--font-mono);
	}

	.nearby-result:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.nearby-result.selected {
		background: rgba(34, 211, 238, 0.04);
	}

	.nearby-check {
		width: 16px;
		height: 16px;
		border-radius: 3px;
		border: 1.5px solid #334155;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-top: 1px;
		color: #22d3ee;
	}

	.nearby-check.checked {
		border-color: #22d3ee;
		background: rgba(34, 211, 238, 0.15);
	}

	.nearby-result-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.nearby-result-name {
		font-size: 11px;
		color: #e2e8f0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.nearby-result-addr {
		font-size: 9px;
		color: #475569;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.nearby-result-open {
		font-size: 9px;
		font-weight: 600;
		color: #ef4444;
		flex-shrink: 0;
	}

	.nearby-result-open.open {
		color: #10b981;
	}

	.nearby-result-rating {
		font-size: 10px;
		color: #f59e0b;
		flex-shrink: 0;
	}

	.nearby-empty {
		padding: 20px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: 11px;
		color: #475569;
	}

	.nearby-layer-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-top: 1px solid #1e293b;
		flex-shrink: 0;
	}

	.nearby-layer-label {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		color: #64748b;
		letter-spacing: 0.05em;
	}

	.nearby-layer-select {
		flex: 1;
		background: #0f172a;
		border: 1px solid #334155;
		border-radius: 4px;
		color: #e2e8f0;
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 4px 6px;
		outline: none;
	}

	.nearby-layer-select:focus {
		border-color: #22d3ee;
	}

	.nearby-footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 10px 12px;
		border-top: 1px solid #1e293b;
		flex-shrink: 0;
	}

	.share-hint {
		font-family: var(--font-mono);
		font-size: 11px;
		color: #64748b;
		line-height: 1.6;
	}

	.share-options {
		display: flex;
		gap: 18px;
		padding: 8px 10px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid #1e293b;
		border-radius: 6px;
	}

	.share-check {
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: #94a3b8;
		cursor: pointer;
		user-select: none;
	}

	.share-check:hover {
		color: #e2e8f0;
	}

	.share-check input[type="checkbox"] {
		accent-color: #22d3ee;
	}

	.decrypt-error {
		border-color: #ef4444 !important;
	}

	.decrypt-error-msg {
		font-family: var(--font-mono);
		font-size: 10px;
		color: #ef4444;
		font-weight: 600;
	}
</style>
