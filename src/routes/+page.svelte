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
	import { buildExportData, downloadJson, downloadEncryptedJson, importEncryptedJson, importJson, openImportDialog } from '$lib/json-export';
	import { openCsvFileDialog, parseCsv, detectColumns, detectColumnsFromData, hasHeaderRow, validateCoords, getCsvStats, deduplicateRows, parseTimestamp, combineDateAndTime, exportCsv, formatTimestamp, MAX_CSV_PINS } from '$lib/csv-import';
	import { LAYER_COLORS, MAX_NOTE_TEXT_LENGTH, MAX_PIN_LABEL_LENGTH, STROKE_WIDTH_OPTIONS, PIN_ICONS } from '$lib/constants';
	import { formatDistance, polygonArea, formatArea, polylineLength } from '$lib/geo';
	import type { RouteInfo, RoutePair, TravelMode, NearbyResult, DrawingPoint } from '$lib/types';
	import { getSunPosition, getSunTimes } from '$lib/sun-calc';

	const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
	const mapIdEnv = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string) || undefined;

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
	let bottomPanelOpen = $state(false);
	let propsOpen = $state(true);
	let propsExtendedOpen = $state(false);
	let fpSelectedPin = $derived(pinStore.pins.find(p => p.id === pinStore.selectedPinId));
	let fpSelectedDrawing = $derived(drawingStore.drawings.find(d => d.id === drawingStore.selectedDrawingId));
	let cursorLat = $state(0);
	let cursorLng = $state(0);
	let isSatellite = $state(false);
	let tiltEnabled = $state(false);
	let labelsVisible = $state(true);
	let labelMinZoom = $state(14);
	let pinLabelsVisible = $state(true);
	let poiLabelsVisible = $state(false);
	let routesVisible = $state(true);
	let labelsDropdownOpen = $state(false);
	let clusterDropdownOpen = $state(false);
	let clusterMaxZoom = $state(14);
	let is3dView = $state(false);

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

	interface SavedView {
		id: string;
		name: string;
		lat: number;
		lng: number;
		zoom: number;
		satellite: boolean;
		layers: string[];
	}
	let savedViews = $state<SavedView[]>([]);

	let showSaveViewModal = $state(false);
	let saveViewName = $state('');

	// Opens the save view modal with an empty name
	function saveCurrentView() {
		saveViewName = '';
		showSaveViewModal = true;
	}

	// Saves the current map center, zoom, and layer state as a named view
	function confirmSaveView() {
		if (!saveViewName.trim()) return;
		const center = mapComponent?.getCenter();
		const zoom = mapComponent?.getZoom();
		if (!center || zoom == null) return;
		savedViews = [...savedViews, {
			id: `view-${Date.now()}`,
			name: saveViewName.trim(),
			lat: center.lat,
			lng: center.lng,
			zoom,
			satellite: isSatellite,
			layers: layerStore.layers.filter(l => l.visible).map(l => l.id)
		}];
		showSaveViewModal = false;
		saveViewName = '';
	}

	// Restores map position, type, and layer visibility from a saved view
	function loadSavedView(id: string) {
		const view = savedViews.find(v => v.id === id);
		if (!view) return;
		mapComponent?.setView({ lat: view.lat, lng: view.lng }, view.zoom);
		isSatellite = view.satellite;
		for (const layer of layerStore.layers) {
			const shouldBeVisible = view.layers.includes(layer.id);
			if (layer.visible !== shouldBeVisible) layerStore.toggleVisibility(layer.id);
		}
	}

	// Removes a saved view by its ID
	function deleteSavedView(id: string) {
		savedViews = savedViews.filter(v => v.id !== id);
	}

	let activeTool = $state<'distance' | 'crowd' | 'sun' | 'matrix' | 'timezone' | 'weather' | null>(null);
	const owmApiKey = (import.meta.env.VITE_OPENWEATHERMAP_API_KEY as string) || '';
	const WEATHER_LAYERS = [
		{ id: 'temp_new', label: 'Temperature' },
		{ id: 'wind_new', label: 'Wind Speed' },
		{ id: 'precipitation_new', label: 'Precipitation' },
		{ id: 'clouds_new', label: 'Cloud Cover' },
		{ id: 'pressure_new', label: 'Pressure' }
	];
	let activeWeatherLayer = $state<string | null>(null);
	let weatherData = $state<any>(null);
	let weatherLoading = $state(false);

	// Fetches current weather data from OpenWeatherMap for the map center
	async function fetchWeather() {
		const center = mapComponent?.getCenter();
		if (!center || !owmApiKey) return;
		weatherLoading = true;
		weatherData = null;
		try {
			const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${center.lat}&lon=${center.lng}&appid=${owmApiKey}&units=metric`);
			if (res.ok) weatherData = await res.json();
		} catch {}
		weatherLoading = false;
	}
	let toolCircles = $state<Array<{ id: string; lat: number; lng: number; radius: number; label: string; color: string }>>([]);
	let toolCircleRadius = $state(1000);
	let toolCircleSearchEl = $state<HTMLInputElement | null>(null);
	let toolCirclePendingLocation = $state<{ lat: number; lng: number; name: string } | null>(null);
	let crowdManualArea = $state(0);
	let crowdDensityIdx = $state(1);
	let crowdSelectedDrawing = $derived(drawingStore.drawings.find(d => d.id === drawingStore.selectedDrawingId));
	let crowdAutoArea = $derived.by(() => {
		const d = crowdSelectedDrawing;
		if (!d) return 0;
		if (d.type === 'polygon' && d.points.length >= 3) return polygonArea(d.points) * 1_000_000;
		if (d.type === 'circle' && d.radius) return Math.PI * d.radius * d.radius;
		return 0;
	});
	let crowdArea = $derived(crowdAutoArea > 0 ? crowdAutoArea : crowdManualArea);
	let sunDate = $state(new Date().toISOString().slice(0, 10));
	let sunHour = $state(new Date().getHours() + new Date().getMinutes() / 60);
	let sunPosition = $derived.by(() => {
		const center = mapComponent?.getCenter();
		if (!center || !activeTool || activeTool !== 'sun') return null;
		const d = new Date(sunDate + 'T00:00:00');
		d.setHours(Math.floor(sunHour), Math.round((sunHour % 1) * 60));
		return getSunPosition(d, center.lat, center.lng);
	});
	let sunTimes = $derived.by(() => {
		const center = mapComponent?.getCenter();
		if (!center || !activeTool || activeTool !== 'sun') return null;
		const d = new Date(sunDate + 'T12:00:00');
		return getSunTimes(d, center.lat, center.lng);
	});

	// Maps approximate UTC offset to common timezone names
	function getTimezoneName(lat: number, lng: number): string {
		const offset = Math.round(lng / 15);
		const regions: Record<number, string[]> = {
			'-12': ['Baker Island'],
			'-11': ['American Samoa', 'SST'],
			'-10': ['Hawaii', 'HST'],
			'-9': ['Alaska', 'AKST'],
			'-8': ['Pacific', 'PST'],
			'-7': ['Mountain', 'MST'],
			'-6': ['Central', 'CST'],
			'-5': ['Eastern', 'EST'],
			'-4': ['Atlantic', 'AST'],
			'-3': ['Argentina', 'ART', 'Brazil', 'BRT'],
			'-2': ['South Georgia', 'GST'],
			'-1': ['Azores', 'AZOT', 'Cape Verde'],
			'0': ['GMT', 'UTC', 'London', 'WET'],
			'1': ['CET', 'West Africa', 'WAT'],
			'2': ['EET', 'South Africa', 'SAST', 'Cairo'],
			'3': ['Moscow', 'MSK', 'East Africa', 'EAT', 'Arabia', 'AST'],
			'4': ['Gulf', 'GST', 'Samara'],
			'5': ['Pakistan', 'PKT', 'Yekaterinburg'],
			'6': ['Bangladesh', 'BST', 'Omsk'],
			'7': ['Indochina', 'ICT', 'Krasnoyarsk'],
			'8': ['China', 'CST', 'AWST', 'Singapore', 'SGT'],
			'9': ['Japan', 'JST', 'Korea', 'KST'],
			'10': ['AEST', 'Vladivostok', 'Papua New Guinea'],
			'11': ['Solomon Islands', 'Magadan'],
			'12': ['NZST', 'Fiji', 'Kamchatka']
		};
		const names = regions[String(offset) as any] || [];
		if (offset === 8 && lat < 0) return 'AWST (Perth)';
		if (offset === 8 && lat > 20) return 'CST (China/HK)';
		if (offset === 8 && lat > 0 && lat <= 20) return 'SGT (Singapore)';
		if (offset === 10 && lat < -10) return 'AEST (Australia)';
		if (offset === 9 && lat > 30) return 'JST (Japan)';
		if (offset === 5 && lat > 20 && lat < 40) return 'PKT (Pakistan)';
		if (offset === 5 && lat >= 40) return 'UZT (Uzbekistan)';
		if (offset === 3 && lat > 50) return 'MSK (Moscow)';
		if (offset === 3 && lat < 20) return 'EAT (East Africa)';
		if (offset === 3 && lat >= 20 && lat <= 50) return 'AST (Arabia)';
		if (offset === 1 && lat > 35) return 'CET (Central Europe)';
		if (offset === 1 && lat <= 35) return 'WAT (West Africa)';
		if (offset === 2 && lat > 35) return 'EET (Eastern Europe)';
		if (offset === 2 && lat <= 35) return 'SAST (South Africa)';
		return names.length > 0 ? names.slice(0, 2).join(' / ') : `UTC${offset >= 0 ? '+' : ''}${offset}`;
	}

	let timezoneInfo = $derived.by(() => {
		const center = mapComponent?.getCenter();
		if (!center || activeTool !== 'timezone') return null;
		const utcOffset = Math.round(center.lng / 15);
		const offsetHours = utcOffset >= 0 ? `+${utcOffset}` : `${utcOffset}`;
		const now = new Date();
		const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
		const localMs = utcMs + utcOffset * 3600000;
		const localTime = new Date(localMs);
		return {
			utcOffset: offsetHours,
			timezoneName: getTimezoneName(center.lat, center.lng),
			localTime: localTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
			localDate: localTime.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
			lat: center.lat,
			lng: center.lng
		};
	});

	const CROWD_DENSITIES = [
		{ label: 'Light', value: 0.5, desc: '~2m² per person' },
		{ label: 'Moderate', value: 1.5, desc: 'Shoulder to shoulder' },
		{ label: 'Dense', value: 3, desc: 'Packed crowd' },
		{ label: 'Max', value: 5, desc: 'Crush capacity' }
	];

	// Formats a crowd count with K/M suffixes for readability
	function formatCrowdCount(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return Math.round(n).toString();
	}

	const TOOL_CIRCLE_COLORS = ['#2563eb', '#dc2626', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

	// Toggles a tool panel open/closed and cleans up previous tool state
	function handleToolOpen(tool: string) {
		if (tool === 'matrix') {
			bottomPanelOpen = !bottomPanelOpen;
			return;
		}
		const prev = activeTool;
		activeTool = activeTool === tool ? null : tool as any;
		if (prev === 'distance' && activeTool !== 'distance') {
			toolCircles = [];
		}
		if (prev === 'weather' && activeTool !== 'weather') {
			activeWeatherLayer = null;
		}
	}

	let toolCircleAutocomplete: google.maps.places.Autocomplete | null = null;
	$effect(() => {
		if (activeTool === 'distance' && toolCircleSearchEl && !toolCircleAutocomplete) {
			if (typeof google !== 'undefined' && google.maps?.places?.Autocomplete) {
				toolCircleAutocomplete = new google.maps.places.Autocomplete(toolCircleSearchEl, {
					fields: ['name', 'formatted_address', 'geometry']
				});
				toolCircleAutocomplete.addListener('place_changed', () => {
					const place = toolCircleAutocomplete!.getPlace();
					if (!place?.geometry?.location) return;
					toolCirclePendingLocation = {
						lat: place.geometry.location.lat(),
						lng: place.geometry.location.lng(),
						name: place.name || place.formatted_address?.split(',')[0] || 'Location'
					};
					mapComponent?.flyTo(toolCirclePendingLocation.lat, toolCirclePendingLocation.lng);
				});
			}
		}
		if (activeTool !== 'distance') {
			toolCircleAutocomplete = null;
		}
	});

	// Adds a distance circle at the pending location with the current radius
	function addToolCircle() {
		if (!toolCirclePendingLocation) return;
		const { lat, lng, name } = toolCirclePendingLocation;
		const color = TOOL_CIRCLE_COLORS[toolCircles.length % TOOL_CIRCLE_COLORS.length];
		toolCircles = [...toolCircles, {
			id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
			lat, lng, radius: toolCircleRadius, label: `${name} (${toolCircleRadius >= 1000 ? (toolCircleRadius / 1000) + 'km' : toolCircleRadius + 'm'})`,
			color
		}];
		toolCirclePendingLocation = null;
	}

	// Removes a distance circle by its ID
	function removeToolCircle(id: string) {
		toolCircles = toolCircles.filter(c => c.id !== id);
	}

	let showExportEncryptModal = $state(false);
	let exportEncryptPassword = $state('');
	let pendingEncryptedImport = $state<ArrayBuffer | null>(null);
	let showImportDecryptModal = $state(false);
	let importDecryptPassword = $state('');
	let importDecryptError = $state(false);
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
	let csvAzimuthCol = $state(-1);
	let csvRadiusCol = $state(-1);
	let csvIconCol = $state(-1);
	let csvLayerCol = $state(-1);
	let csvAltitudeCol = $state(-1);
	let csvSpeedCol = $state(-1);
	let csvNotesCol = $state(-1);
	let showCsvWalkthrough = $state(false);

	let ctxMenu = $state({ show: false, x: 0, y: 0, lat: 0, lng: 0 });

	$effect(() => {
		if (pinStore.selectedPinId || drawingStore.selectedDrawingId) propsOpen = true;
	});

	let timelineActive = $state(false);
	let timelinePlaying = $state(false);
	let timelineTime = $state(0);
	let timelineSpeed = $state(1);
	let timelineAnimFrame = $state(0);
	let timelineLayers = $state<Set<string>>(new Set());
	let timelineLayerPickerOpen = $state(false);
	let filteredPinIds = $state<Set<string> | null>(null);

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
				setTimeout(() => { splashVisible = false; }, 300);
			}, 800);
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

	// Opens the encrypted export modal
	function handleExportEncrypted() {
		showExportEncryptModal = true;
		exportEncryptPassword = '';
	}

	// Encrypts and downloads the map data as a .scatter file
	async function confirmExportEncrypted() {
		if (!exportEncryptPassword) return;
		const center = mapComponent?.getCenter();
		const zoom = mapComponent?.getZoom();
		const data = buildExportData(center, zoom, routes, travelMode, labelsVisible, notesVisible, heatmapEnabled, isSatellite, tiltEnabled, pinLabelsVisible, poiLabelsVisible, routesVisible);
		await downloadEncryptedJson(data, exportEncryptPassword);
		showExportEncryptModal = false;
		exportEncryptPassword = '';
	}

	// Exports all pins as a CSV file
	function handleExportCsv() {
		exportCsv(pinStore.pins);
	}

	// Applies imported data to the map state including center, routes, and view settings
	function applyImportResult(result: NonNullable<ReturnType<typeof importJson>>) {
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

	// Opens a file picker to import a previously exported JSON or .scatter file
	async function handleImport() {
		const imported = await openImportDialog();
		if (!imported) return;
		if (imported.encrypted && imported.fileData) {
			pendingEncryptedImport = imported.fileData;
			importDecryptPassword = '';
			importDecryptError = false;
			showImportDecryptModal = true;
		} else if (imported.result) {
			applyImportResult(imported.result);
		}
	}

	// Decrypts a .scatter file with the provided password and applies its data
	async function confirmImportDecrypt() {
		if (!pendingEncryptedImport || !importDecryptPassword) return;
		const result = await importEncryptedJson(pendingEncryptedImport, importDecryptPassword);
		if (result) {
			applyImportResult(result);
			showImportDecryptModal = false;
			pendingEncryptedImport = null;
		} else {
			importDecryptError = true;
		}
	}

	// Opens a file picker for CSV, parses it, and shows the column mapping modal
	function handleImportCsv() {
		showCsvWalkthrough = true;
	}

	// Opens a file picker, parses the selected CSV, and detects column mappings
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
			csvAzimuthCol = detected.azimuth;
			csvRadiusCol = detected.radius;
			csvIconCol = detected.icon;
			csvLayerCol = detected.layer;
			csvAltitudeCol = detected.altitude;
			csvSpeedCol = detected.speed;
			csvNotesCol = detected.notes;
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
			csvAzimuthCol = -1;
			csvRadiusCol = -1;
			csvIconCol = -1;
			csvLayerCol = -1;
			csvAltitudeCol = -1;
			csvSpeedCol = -1;
			csvNotesCol = -1;
		}
		showCsvModal = true;
	}

	// Imports the mapped CSV rows as pins, deduplicating first
	function confirmCsvImport() {
		if (csvLatCol < 0 || csvLngCol < 0) return;
		historyStore.push('Imported CSV');
		const uniqueRows = deduplicateRows(csvRows, csvLatCol, csvLngCol);
		const addedPoints: { lat: number; lng: number }[] = [];

		const layerNameMap = new Map<string, string>();
		for (const l of layerStore.layers) {
			layerNameMap.set(l.name.toLowerCase(), l.id);
		}
		let layerColorIdx = layerStore.layers.length;

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

			let targetLayerId: string | undefined;
			if (csvLayerCol >= 0 && row[csvLayerCol]?.trim()) {
				const layerName = row[csvLayerCol].trim();
				const existing = layerNameMap.get(layerName.toLowerCase());
				if (existing) {
					targetLayerId = existing;
				} else {
					const color = LAYER_COLORS[layerColorIdx % LAYER_COLORS.length];
					layerColorIdx++;
					const newLayer = layerStore.addLayer(layerName, color);
					layerNameMap.set(layerName.toLowerCase(), newLayer.id);
					targetLayerId = newLayer.id;
				}
			}

			const pin = pinStore.addPin(coords.lat, coords.lng, targetLayerId);
			const updates: Record<string, any> = {};
			if (label) updates.label = label;
			if (timestamp) updates.timestamp = timestamp;
			if (csvIconCol >= 0 && row[csvIconCol]?.trim()) updates.icon = row[csvIconCol].trim();
			if (csvAzimuthCol >= 0 && row[csvAzimuthCol]?.trim()) {
				const v = Number(row[csvAzimuthCol]);
				if (!isNaN(v)) updates.azimuth = v;
			}
			if (csvRadiusCol >= 0 && row[csvRadiusCol]?.trim()) {
				const v = Number(row[csvRadiusCol]);
				if (!isNaN(v) && v > 0) updates.radius = v;
			}
			if (csvAltitudeCol >= 0 && row[csvAltitudeCol]?.trim()) {
				const v = Number(row[csvAltitudeCol]);
				if (!isNaN(v)) updates.altitude = v;
			}
			if (csvSpeedCol >= 0 && row[csvSpeedCol]?.trim()) {
				const v = Number(row[csvSpeedCol]);
				if (!isNaN(v) && v >= 0) updates.speed = v;
			}
			if (csvNotesCol >= 0 && row[csvNotesCol]?.trim()) updates.notes = row[csvNotesCol].trim();
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
		csvAzimuthCol = -1;
		csvRadiusCol = -1;
		csvIconCol = -1;
		csvLayerCol = -1;
		csvAltitudeCol = -1;
		csvSpeedCol = -1;
		csvNotesCol = -1;
		if (addedPoints.length > 0) mapComponent?.fitBounds(addedPoints);
	}

	// Closes the CSV modal and resets all column mapping state
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
		csvAzimuthCol = -1;
		csvRadiusCol = -1;
		csvIconCol = -1;
		csvLayerCol = -1;
		csvAltitudeCol = -1;
		csvSpeedCol = -1;
		csvNotesCol = -1;
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

		if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey) && !isInput) {
			e.preventDefault();
			saveCurrentView();
			return;
		}

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
			onExportEncrypted={handleExportEncrypted}
			onClearAll={handleClearAll}
			onUndo={() => historyStore.undo()}
			onRedo={() => historyStore.redo()}
			canUndo={historyStore.canUndo}
			canRedo={historyStore.canRedo}
			{cursorLat}
			{cursorLng}
			{bottomPanelOpen}
			onToggleBottomPanel={() => (bottomPanelOpen = !bottomPanelOpen)}
			savedViews={savedViews.map(v => ({ id: v.id, name: v.name }))}
			onSaveView={saveCurrentView}
			onLoadView={loadSavedView}
			onDeleteView={deleteSavedView}
			onToolOpen={handleToolOpen}
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
			<div class="map-section" style="flex: {embedMode || !bottomPanelOpen ? 1 : splitRatio};">
				<Map
					bind:this={mapComponent}
					{apiKey}
					mapId={mapIdEnv}
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
					{labelMinZoom}
					{routesVisible}
					{timeFilter}
					{timelineHiddenLayers}
					hiddenPinIds={filteredPinIds}
					{toolCircles}
					sunAzimuth={activeTool === 'sun' && sunPosition ? sunPosition.azimuth : null}
					sunAltitude={activeTool === 'sun' && sunPosition ? sunPosition.altitude : null}
					weatherLayer={activeTool === 'weather' ? activeWeatherLayer : null}
					weatherApiKey={owmApiKey}
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
							class:active={is3dView}
							onclick={async () => { await mapComponent?.goToGlobe(); is3dView = mapComponent?.is3dActive() ?? false; }}
							title={is3dView ? 'Exit 3D view' : '3D view'}
						>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M3.6 9h16.8M3.6 15h16.8" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 3a15.3 15.3 0 014 9 15.3 15.3 0 01-4 9 15.3 15.3 0 01-4-9 15.3 15.3 0 014-9z" />
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
								onclick={(e) => { e.stopPropagation(); clusterDropdownOpen = false; labelsDropdownOpen = !labelsDropdownOpen; }}
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
										<input type="checkbox" bind:checked={routesVisible} />
										<span>Routes</span>
									</label>
									<div class="ctrl-dropdown-sep"></div>
									<span class="ctrl-dropdown-title">LABEL ZOOM</span>
									<div class="ctrl-slider-row">
										<input type="range" class="ctrl-range" min="0" max="22" bind:value={labelMinZoom} />
										<span class="ctrl-slider-val">{labelMinZoom}</span>
									</div>
									<div class="ctrl-slider-hints">
										<span>Always</span>
										<span>Close</span>
									</div>
								</div>
							{/if}
						</div>
						<div class="ctrl-dropdown-wrap">
							<button
								class="ctrl-btn"
								class:active={clusterDropdownOpen}
								onclick={(e) => { e.stopPropagation(); labelsDropdownOpen = false; clusterDropdownOpen = !clusterDropdownOpen; }}
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


				{#if !embedMode}
					<div class="float-props">
						<button class="float-props-header" onclick={() => (propsOpen = !propsOpen)}>
							<span class="float-props-title">PROPERTIES</span>
							<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								{#if propsOpen}
									<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
								{:else}
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
								{/if}
							</svg>
						</button>
					{#if propsOpen}
						<div class="float-props-body">
							{#if fpSelectedPin}
								<div class="fp-field">
									<label class="fp-lbl">NAME</label>
									<input type="text" value={fpSelectedPin.label} maxlength={MAX_PIN_LABEL_LENGTH} oninput={(e) => pinStore.updatePin(fpSelectedPin.id, { label: (e.target as HTMLInputElement).value })} class="fp-input" />
								</div>
								<div class="fp-field">
									<label class="fp-lbl">COORDS</label>
									<div class="fp-coords">
										<span class="fp-coord-val">{fpSelectedPin.lat.toFixed(6)}, {fpSelectedPin.lng.toFixed(6)}</span>
										<button class="fp-copy" onclick={() => navigator.clipboard.writeText(`${fpSelectedPin.lat.toFixed(6)}, ${fpSelectedPin.lng.toFixed(6)}`)} title="Copy">
											<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
												<path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
											</svg>
										</button>
									</div>
								</div>
								<div class="fp-field">
									<label class="fp-lbl">LAYER</label>
									<select value={fpSelectedPin.layerId} onchange={(e) => pinStore.updatePin(fpSelectedPin.id, { layerId: (e.target as HTMLSelectElement).value })} class="fp-select">
										{#each layerStore.layers as layer}
											<option value={layer.id}>{layer.name}</option>
										{/each}
									</select>
								</div>
								<div class="fp-field">
									<label class="fp-lbl">TIMESTAMP</label>
									<input type="datetime-local" value={fpSelectedPin.timestamp ? new Date(new Date(fpSelectedPin.timestamp).getTime() - new Date(fpSelectedPin.timestamp).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} oninput={(e) => { const val = (e.target as HTMLInputElement).value; pinStore.updatePin(fpSelectedPin.id, { timestamp: val ? new Date(val).toISOString() : undefined }); }} class="fp-input" />
								</div>
								<div class="fp-field">
									<label class="fp-lbl">ICON</label>
									<div class="fp-icon-picker">
										{#each Object.keys(PIN_ICONS) as iconName}
											<button class="fp-icon-btn" class:active={fpSelectedPin.icon === iconName} title={iconName} onclick={() => pinStore.updatePin(fpSelectedPin.id, { icon: fpSelectedPin.icon === iconName ? undefined : iconName })}>
												<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={PIN_ICONS[iconName].fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d={PIN_ICONS[iconName].path} /></svg>
											</button>
										{/each}
									</div>
								</div>
								<button class="fp-expand-btn" onclick={() => (propsExtendedOpen = !propsExtendedOpen)}>
									<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
										{#if propsExtendedOpen}
											<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
										{:else}
											<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
										{/if}
									</svg>
									<span>Extended</span>
								</button>
								{#if propsExtendedOpen}
								<div class="fp-field">
									<label class="fp-lbl">AZIMUTH <span class="fp-unit">deg</span></label>
									<input type="number" min="0" max="360" step="0.1" value={fpSelectedPin.azimuth ?? ''} placeholder="—" oninput={(e) => { const v = (e.target as HTMLInputElement).value; pinStore.updatePin(fpSelectedPin.id, { azimuth: v ? Number(v) : undefined } as any); }} class="fp-input" />
								</div>
								<div class="fp-field">
									<label class="fp-lbl">RADIUS <span class="fp-unit">m</span></label>
									<input type="number" min="0" step="1" value={fpSelectedPin.radius ?? ''} placeholder="—" oninput={(e) => { const v = (e.target as HTMLInputElement).value; pinStore.updatePin(fpSelectedPin.id, { radius: v ? Number(v) : undefined } as any); }} class="fp-input" />
								</div>
								<div class="fp-field">
									<label class="fp-lbl">ALTITUDE <span class="fp-unit">m</span></label>
									<input type="number" step="0.1" value={fpSelectedPin.altitude ?? ''} placeholder="—" oninput={(e) => { const v = (e.target as HTMLInputElement).value; pinStore.updatePin(fpSelectedPin.id, { altitude: v ? Number(v) : undefined } as any); }} class="fp-input" />
								</div>
								<div class="fp-field">
									<label class="fp-lbl">SPEED <span class="fp-unit">km/h</span></label>
									<input type="number" min="0" step="0.1" value={fpSelectedPin.speed ?? ''} placeholder="—" oninput={(e) => { const v = (e.target as HTMLInputElement).value; pinStore.updatePin(fpSelectedPin.id, { speed: v ? Number(v) : undefined } as any); }} class="fp-input" />
								</div>
								<div class="fp-field">
									<label class="fp-lbl">NOTES</label>
									<input type="text" value={fpSelectedPin.notes ?? ''} placeholder="—" oninput={(e) => { const v = (e.target as HTMLInputElement).value; pinStore.updatePin(fpSelectedPin.id, { notes: v || undefined } as any); }} class="fp-input" />
								</div>
								{/if}
							{:else if fpSelectedDrawing}
								<div class="fp-field">
									<label class="fp-lbl">NAME</label>
									<input type="text" value={fpSelectedDrawing.label} maxlength={MAX_PIN_LABEL_LENGTH} oninput={(e) => drawingStore.updateDrawing(fpSelectedDrawing.id, { label: (e.target as HTMLInputElement).value })} class="fp-input" />
								</div>
								<div class="fp-field">
									<label class="fp-lbl">TYPE</label>
									<span class="fp-static">{fpSelectedDrawing.type}</span>
								</div>
								{#if fpSelectedDrawing.type === 'polygon' && fpSelectedDrawing.points.length >= 3}
									<div class="fp-field"><label class="fp-lbl">AREA</label><span class="fp-measure">{formatArea(polygonArea(fpSelectedDrawing.points))}</span></div>
									<div class="fp-field"><label class="fp-lbl">PERIMETER</label><span class="fp-measure">{formatDistance(polylineLength(fpSelectedDrawing.points, true))}</span></div>
								{:else if fpSelectedDrawing.type === 'circle' && fpSelectedDrawing.radius}
									<div class="fp-field"><label class="fp-lbl">AREA</label><span class="fp-measure">{formatArea(Math.PI * (fpSelectedDrawing.radius / 1000) ** 2)}</span></div>
									<div class="fp-field"><label class="fp-lbl">RADIUS</label><span class="fp-measure">{formatDistance(fpSelectedDrawing.radius / 1000)}</span></div>
								{:else if (fpSelectedDrawing.type === 'path' || fpSelectedDrawing.type === 'arrow') && fpSelectedDrawing.points.length >= 2}
									<div class="fp-field"><label class="fp-lbl">LENGTH</label><span class="fp-measure">{formatDistance(polylineLength(fpSelectedDrawing.points))}</span></div>
								{/if}
								{#if fpSelectedDrawing.type !== 'note'}
									<div class="fp-field">
										<label class="fp-lbl">WIDTH</label>
										<div class="fp-stroke-row">
											{#each STROKE_WIDTH_OPTIONS as w}
												<button class="fp-stroke-btn" class:active={fpSelectedDrawing.strokeWidth === w} onclick={() => drawingStore.updateDrawing(fpSelectedDrawing.id, { strokeWidth: w })} title="{w}px">
													<span class="fp-stroke-line" style="height: {w}px;"></span>
												</button>
											{/each}
										</div>
									</div>
								{/if}
								<div class="fp-field">
									<label class="fp-lbl">LAYER</label>
									<select value={fpSelectedDrawing.layerId} onchange={(e) => drawingStore.updateDrawing(fpSelectedDrawing.id, { layerId: (e.target as HTMLSelectElement).value })} class="fp-select">
										{#each layerStore.layers as layer}
											<option value={layer.id}>{layer.name}</option>
										{/each}
									</select>
								</div>
							{:else}
								<div class="fp-empty">Select a pin or annotation</div>
							{/if}
						</div>
					{/if}
					</div>
				{/if}

				{#if !readonlyMode && !embedMode}
					<div class="drawing-toolbar-wrap">
						<DrawingToolbar onFinish={handleDrawingFinish} />
						{#if drawingStore.mode !== 'none'}
							<span class="mode-badge-inline">{drawingStore.mode.toUpperCase()}</span>
						{/if}
					</div>
				{/if}
			</div>

			{#if !embedMode && bottomPanelOpen}
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

	{#if activeTool === 'distance'}
		<div class="tool-panel">
			<div class="tool-panel-header">
				<span class="tool-panel-title">DISTANCE CIRCLES</span>
				<button class="tool-panel-close" onclick={() => (activeTool = null)}>
					<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>
			<div class="tool-panel-body">
				<div class="tp-field">
					<label class="tp-lbl">LOCATION</label>
					<input bind:this={toolCircleSearchEl} type="text" placeholder="Search a place..." class="tp-input" />
					{#if toolCirclePendingLocation}
						<span class="tp-hint">{toolCirclePendingLocation.name}</span>
					{/if}
				</div>
				<div class="tp-field">
					<label class="tp-lbl">RADIUS</label>
					<div class="tp-radius-row">
						<input type="number" min="1" bind:value={toolCircleRadius} class="tp-input tp-input-sm" />
						<span class="tp-unit">m</span>
					</div>
					<div class="tp-presets">
						{#each [1000, 2000, 5000, 10000, 25000, 50000] as r}
							<button class="tp-preset" class:active={toolCircleRadius === r} onclick={() => (toolCircleRadius = r)}>{r >= 1000 ? (r/1000) + 'km' : r + 'm'}</button>
						{/each}
					</div>
				</div>
				<button class="tp-btn" onclick={addToolCircle} disabled={!toolCirclePendingLocation}>Draw Circle</button>
				{#if toolCircles.length > 0}
					<div class="tp-list">
						{#each toolCircles as circle}
							<div class="tp-list-item">
								<span class="tp-list-dot" style="background: {circle.color};"></span>
								<span class="tp-list-label">{circle.label}</span>
								<button class="tp-list-del" onclick={() => removeToolCircle(circle.id)}>×</button>
							</div>
						{/each}
						<button class="tp-btn-text" onclick={() => (toolCircles = [])}>Clear all</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if activeTool === 'crowd'}
		<div class="tool-panel">
			<div class="tool-panel-header">
				<span class="tool-panel-title">CROWD ESTIMATOR</span>
				<button class="tool-panel-close" onclick={() => (activeTool = null)}>
					<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>
			<div class="tool-panel-body">
				<div class="tp-field">
					<label class="tp-lbl">AREA <span class="tp-unit-inline">m²</span></label>
					{#if crowdAutoArea > 0}
						<span class="tp-value">{Math.round(crowdAutoArea).toLocaleString()} m²</span>
						<span class="tp-hint">From selected {crowdSelectedDrawing?.type}</span>
					{:else}
						<input type="number" min="0" bind:value={crowdManualArea} placeholder="Enter area in m²" class="tp-input" />
						<span class="tp-hint">Select a polygon/circle or enter manually</span>
					{/if}
				</div>
				<div class="tp-field">
					<label class="tp-lbl">DENSITY</label>
					<div class="tp-density-btns">
						{#each CROWD_DENSITIES as d, i}
							<button class="tp-density-btn" class:active={crowdDensityIdx === i} onclick={() => (crowdDensityIdx = i)}>
								<span class="tp-density-label">{d.label}</span>
								<span class="tp-density-desc">{d.desc}</span>
							</button>
						{/each}
					</div>
				</div>
				{#if crowdArea > 0}
					<div class="tp-result">
						<span class="tp-result-label">ESTIMATED</span>
						<span class="tp-result-value">{formatCrowdCount(crowdArea * CROWD_DENSITIES[crowdDensityIdx].value)}</span>
						<span class="tp-result-sub">people at {CROWD_DENSITIES[crowdDensityIdx].value}/m²</span>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if activeTool === 'sun'}
		<div class="tool-panel">
			<div class="tool-panel-header">
				<span class="tool-panel-title">SUN POSITION</span>
				<button class="tool-panel-close" onclick={() => (activeTool = null)}>
					<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>
			<div class="tool-panel-body">
				<div class="tp-field">
					<label class="tp-lbl">DATE</label>
					<input type="date" bind:value={sunDate} class="tp-input" />
				</div>
				<div class="tp-field">
					<label class="tp-lbl">TIME <span class="tp-unit-inline">{Math.floor(sunHour).toString().padStart(2, '0')}:{Math.round((sunHour % 1) * 60).toString().padStart(2, '0')}</span></label>
					<input type="range" min="0" max="24" step="0.1" bind:value={sunHour} class="tp-range" />
				</div>
				{#if sunPosition}
					<div class="tp-sun-data">
						<div class="tp-sun-row">
							<span class="tp-sun-label">Azimuth</span>
							<span class="tp-sun-value">{sunPosition.azimuth.toFixed(1)}°</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Altitude</span>
							<span class="tp-sun-value">{sunPosition.altitude.toFixed(1)}°</span>
						</div>
						{#if sunPosition.altitude < 0}
							<span class="tp-hint">Below horizon</span>
						{/if}
					</div>
				{/if}
				{#if sunTimes}
					<div class="tp-sun-data">
						<div class="tp-sun-row">
							<span class="tp-sun-label">Sunrise</span>
							<span class="tp-sun-value">{sunTimes.sunrise.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Sunset</span>
							<span class="tp-sun-value">{sunTimes.sunset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Golden hr</span>
							<span class="tp-sun-value">{sunTimes.goldenHourStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if activeTool === 'timezone'}
		<div class="tool-panel">
			<div class="tool-panel-header">
				<span class="tool-panel-title">TIMEZONE</span>
				<button class="tool-panel-close" onclick={() => (activeTool = null)}>
					<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>
			<div class="tool-panel-body">
				{#if timezoneInfo}
					<div class="tp-tz-main">
						<span class="tp-tz-name">{timezoneInfo.timezoneName}</span>
						<span class="tp-tz-offset">UTC{timezoneInfo.utcOffset}</span>
						<span class="tp-tz-time">{timezoneInfo.localTime}</span>
					</div>
					<div class="tp-sun-data">
						<div class="tp-sun-row">
							<span class="tp-sun-label">Date</span>
							<span class="tp-sun-value">{timezoneInfo.localDate}</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Center</span>
							<span class="tp-sun-value">{timezoneInfo.lat.toFixed(4)}, {timezoneInfo.lng.toFixed(4)}</span>
						</div>
					</div>
					<span class="tp-hint">Based on longitude. Actual timezone may differ due to political boundaries.</span>
				{:else}
					<span class="tp-hint">Pan the map to see timezone</span>
				{/if}
			</div>
		</div>
	{/if}

	{#if activeTool === 'weather'}
		<div class="tool-panel">
			<div class="tool-panel-header">
				<span class="tool-panel-title">WEATHER</span>
				<button class="tool-panel-close" onclick={() => (activeTool = null)}>
					<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>
			<div class="tool-panel-body">
				<button class="tp-btn" onclick={fetchWeather} disabled={weatherLoading}>
					{weatherLoading ? 'Fetching...' : 'Fetch Weather'}
				</button>

				{#if weatherData}
					<div class="tp-sun-data">
						<div class="tp-sun-row">
							<span class="tp-sun-label">Location</span>
							<span class="tp-sun-value">{weatherData.name || '—'}</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Condition</span>
							<span class="tp-sun-value">{weatherData.weather?.[0]?.main || '—'}</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Temp</span>
							<span class="tp-sun-value">{weatherData.main?.temp?.toFixed(1) ?? '—'}°C</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Feels like</span>
							<span class="tp-sun-value">{weatherData.main?.feels_like?.toFixed(1) ?? '—'}°C</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Humidity</span>
							<span class="tp-sun-value">{weatherData.main?.humidity ?? '—'}%</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Wind</span>
							<span class="tp-sun-value">{weatherData.wind?.speed?.toFixed(1) ?? '—'} m/s {weatherData.wind?.deg != null ? `${weatherData.wind.deg}°` : ''}</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Pressure</span>
							<span class="tp-sun-value">{weatherData.main?.pressure ?? '—'} hPa</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Visibility</span>
							<span class="tp-sun-value">{weatherData.visibility != null ? (weatherData.visibility >= 1000 ? (weatherData.visibility / 1000).toFixed(1) + ' km' : weatherData.visibility + ' m') : '—'}</span>
						</div>
						<div class="tp-sun-row">
							<span class="tp-sun-label">Clouds</span>
							<span class="tp-sun-value">{weatherData.clouds?.all ?? '—'}%</span>
						</div>
					</div>
				{/if}

				<div class="tp-field">
					<label class="tp-lbl">MAP OVERLAY</label>
					<div class="tp-weather-btns">
						{#each WEATHER_LAYERS as layer}
							<button
								class="tp-weather-btn"
								class:active={activeWeatherLayer === layer.id}
								onclick={() => (activeWeatherLayer = activeWeatherLayer === layer.id ? null : layer.id)}
							>{layer.label}</button>
						{/each}
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if showSaveViewModal}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={() => { showSaveViewModal = false; }} role="dialog" aria-modal="true" aria-label="Save view" onkeydown={(e) => { if (e.key === 'Escape') { showSaveViewModal = false; } }}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal" onclick={(e) => e.stopPropagation()} role="document">
				<div class="modal-header">
					<span class="modal-title">SAVE VIEW</span>
					<button class="modal-close" onclick={() => { showSaveViewModal = false; }}>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
					</button>
				</div>
				<div class="modal-body">
					<input type="text" class="modal-input" placeholder="View name" bind:value={saveViewName} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmSaveView(); } }} />
				</div>
				<div class="modal-footer">
					<button class="modal-btn cancel" onclick={() => { showSaveViewModal = false; }}>Cancel</button>
					<button class="modal-btn confirm" onclick={confirmSaveView} disabled={!saveViewName.trim()}>Save</button>
				</div>
			</div>
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
				</div>
				<div class="modal-footer">
					<button class="modal-btn cancel" onclick={() => confirmShare(false)}>Share without password</button>
					<button class="modal-btn confirm" onclick={() => confirmShare(true)} disabled={!sharePassword}>Encrypt & Share</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showExportEncryptModal}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={() => { showExportEncryptModal = false; }} role="dialog" aria-modal="true" aria-label="Encrypt export" onkeydown={(e) => { if (e.key === 'Escape') { showExportEncryptModal = false; } }}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal" onclick={(e) => e.stopPropagation()} role="document">
				<div class="modal-header">
					<span class="modal-title">EXPORT ENCRYPTED</span>
					<button class="modal-close" onclick={() => { showExportEncryptModal = false; }}>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
					</button>
				</div>
				<div class="modal-body">
					<div class="share-hint">Set a password to encrypt the export file (.scatter).</div>
					<input type="password" class="nearby-input" placeholder="Password" bind:value={exportEncryptPassword} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmExportEncrypted(); } }} />
				</div>
				<div class="modal-footer">
					<button class="modal-btn cancel" onclick={() => { showExportEncryptModal = false; }}>Cancel</button>
					<button class="modal-btn confirm" onclick={confirmExportEncrypted} disabled={!exportEncryptPassword}>Encrypt & Export</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showImportDecryptModal}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={() => { showImportDecryptModal = false; }} role="dialog" aria-modal="true" aria-label="Decrypt import" onkeydown={(e) => { if (e.key === 'Escape') { showImportDecryptModal = false; } }}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal" onclick={(e) => e.stopPropagation()} role="document">
				<div class="modal-header">
					<span class="modal-title">DECRYPT FILE</span>
					<button class="modal-close" onclick={() => { showImportDecryptModal = false; }}>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
					</button>
				</div>
				<div class="modal-body">
					<div class="share-hint">Enter the password to decrypt this .scatter file.</div>
					<input type="password" class="nearby-input" placeholder="Password" bind:value={importDecryptPassword} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmImportDecrypt(); } }} />
					{#if importDecryptError}
						<span class="csv-error">Wrong password or corrupted file.</span>
					{/if}
				</div>
				<div class="modal-footer">
					<button class="modal-btn cancel" onclick={() => { showImportDecryptModal = false; }}>Cancel</button>
					<button class="modal-btn confirm" onclick={confirmImportDecrypt} disabled={!importDecryptPassword}>Decrypt & Import</button>
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
							<span class="walkthrough-col-info">single column, or date + time</span>
						</div>
						<div class="walkthrough-col">
							<span class="walkthrough-col-name">layer</span>
							<span class="walkthrough-col-info">group, folder</span>
						</div>
						<div class="walkthrough-col">
							<span class="walkthrough-col-name">icon</span>
							<span class="walkthrough-col-info">type, category, marker</span>
						</div>
						<div class="walkthrough-col">
							<span class="walkthrough-col-name">azimuth</span>
							<span class="walkthrough-col-info">bearing, heading, direction</span>
						</div>
						<div class="walkthrough-col">
							<span class="walkthrough-col-name">radius</span>
							<span class="walkthrough-col-info">accuracy, hdop</span>
						</div>
						<div class="walkthrough-col">
							<span class="walkthrough-col-name">altitude</span>
							<span class="walkthrough-col-info">elevation, alt, height</span>
						</div>
						<div class="walkthrough-col">
							<span class="walkthrough-col-name">speed</span>
							<span class="walkthrough-col-info">velocity</span>
						</div>
						<div class="walkthrough-col">
							<span class="walkthrough-col-name">notes</span>
							<span class="walkthrough-col-info">comment, remarks</span>
						</div>
					</div>
					<div class="walkthrough-example">
						<div class="walkthrough-example-label">Example</div>
						<code class="walkthrough-example-code">lat,lng,name,layer,bearing,date,time<br/>51.5074,-0.1278,London,Sites,45,25/12/2024,14:30:00<br/>48.8566,2.3522,Paris,Sites,180,26/12/2024,09:15:00</code>
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
						<div class="csv-divider"></div>
						<div class="csv-section-label">Extended Fields <span class="csv-optional">all optional</span></div>
						<div class="csv-field">
							<label class="csv-label">Layer</label>
							<select class="csv-select" bind:value={csvLayerCol}>
								<option value={-1}>None</option>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						<div class="csv-field">
							<label class="csv-label">Icon</label>
							<select class="csv-select" bind:value={csvIconCol}>
								<option value={-1}>None</option>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						<div class="csv-field">
							<label class="csv-label">Azimuth</label>
							<select class="csv-select" bind:value={csvAzimuthCol}>
								<option value={-1}>None</option>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						<div class="csv-field">
							<label class="csv-label">Radius</label>
							<select class="csv-select" bind:value={csvRadiusCol}>
								<option value={-1}>None</option>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						<div class="csv-field">
							<label class="csv-label">Altitude</label>
							<select class="csv-select" bind:value={csvAltitudeCol}>
								<option value={-1}>None</option>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						<div class="csv-field">
							<label class="csv-label">Speed</label>
							<select class="csv-select" bind:value={csvSpeedCol}>
								<option value={-1}>None</option>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
						<div class="csv-field">
							<label class="csv-label">Notes</label>
							<select class="csv-select" bind:value={csvNotesCol}>
								<option value={-1}>None</option>
								{#each csvHeaders as header, i}
									<option value={i}>{header}</option>
								{/each}
							</select>
						</div>
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
		background: #f8f9fa;
		z-index: 99999;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		transition: opacity 0.3s ease, visibility 0.3s ease;
	}

	.splash-fade {
		opacity: 0;
		visibility: hidden;
	}

	.splash-logo {
		width: 64px;
		height: 64px;
		object-fit: contain;
	}

	.splash-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		z-index: 1;
	}

	.splash-text {
		font-family: var(--font-mono);
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 0.2em;
		color: #999;
	}

	.splash-bar {
		width: 100px;
		height: 2px;
		background: #eee;
		border-radius: 0;
		overflow: hidden;
		margin-top: 4px;
	}

	.splash-bar-fill {
		width: 0%;
		height: 100%;
		background: #999;
		border-radius: 0;
		animation: splashLoad 0.7s ease-in-out forwards;
	}

	@keyframes panel-slide-in {
		from { opacity: 0; transform: translateX(8px); }
		to { opacity: 1; transform: translateX(0); }
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
		background: #f8f9fa;
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
		gap: 10px;
	}

	.ssw-icon {
		width: 40px;
		height: 40px;
		color: #ccc;
		margin-bottom: 4px;
	}

	.ssw-title {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 700;
		color: #1a1a1a;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.ssw-text {
		font-family: var(--font-mono);
		font-size: 10px;
		color: #999;
		line-height: 1.6;
	}

	.app {
		display: flex;
		flex-direction: column;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		background: #f8f9fa;
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
		position: relative;
	}

	.map-section {
		position: relative;
		min-height: 0;
		overflow: hidden;
	}

	.controls-top {
		position: absolute;
		top: 8px;
		left: 8px;
		right: 8px;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		pointer-events: none;
		z-index: 100;
	}

	.controls-top > :global(*) {
		pointer-events: auto;
	}

	.controls-left {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.ctrl-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 22px;
		border-radius: 2px;
		background: #fff;
		border: 1px solid #ddd;
		color: #888;
		cursor: pointer;
		transition: all 0.08s;
	}

	.ctrl-btn:hover {
		color: #1a1a1a;
		background: #f5f5f5;
		transform: scale(1.05);
	}

	.ctrl-btn.active {
		color: #2563eb;
		background: #f0f4ff;
		border-color: #ddd;
	}

	.ctrl-dropdown-wrap {
		position: relative;
	}

	.ctrl-dropdown {
		position: absolute;
		top: 0;
		left: calc(100% + 4px);
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 3px;
		padding: 6px 10px;
		min-width: 150px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 20;
	}

	.ctrl-dropdown-sep {
		height: 1px;
		background: #f0f0f0;
		margin: 4px 0;
	}

	.ctrl-dropdown-title {
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #999;
		text-transform: uppercase;
		padding-bottom: 2px;
		border-bottom: 1px solid #f0f0f0;
	}

	.ctrl-toggle-row {
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: #666;
		cursor: pointer;
		padding: 3px 0;
	}

	.ctrl-toggle-row input[type='checkbox'] {
		appearance: none;
		width: 12px;
		height: 12px;
		border: 1px solid #ddd;
		border-radius: 2px;
		background: #fff;
		cursor: pointer;
		flex-shrink: 0;
		position: relative;
	}

	.ctrl-toggle-row input[type='checkbox']:checked {
		background: #2563eb;
		border-color: #2563eb;
	}

	.ctrl-toggle-row input[type='checkbox']:checked::after {
		content: '';
		position: absolute;
		left: 3px;
		top: 0.5px;
		width: 3.5px;
		height: 6.5px;
		border: solid #ffffff;
		border-width: 0 1.5px 1.5px 0;
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
		height: 3px;
		border-radius: 0;
		background: #eee;
		outline: none;
		cursor: pointer;
	}

	.ctrl-range::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #2563eb;
		border: 2px solid #fff;
		cursor: pointer;
	}

	.ctrl-range::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #2563eb;
		border: 2px solid #fff;
		cursor: pointer;
	}

	.ctrl-slider-val {
		font-family: var(--font-mono);
		font-size: 10px;
		color: #666;
		min-width: 32px;
		text-align: right;
	}

	.ctrl-slider-hints {
		display: flex;
		justify-content: space-between;
		font-family: var(--font-mono);
		font-size: 8px;
		color: #999;
		padding: 0 2px;
	}

	.drawing-toolbar-wrap {
		position: absolute;
		bottom: 8px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 9999;
		display: flex;
		align-items: center;
		gap: 8px;
		pointer-events: auto;
	}

	.mode-badge-inline {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #2563eb;
		text-transform: uppercase;
		background: #fff;
		padding: 2px 6px;
		border: 1px solid #ddd;
		border-radius: 2px;
		white-space: nowrap;
	}

	.float-props {
		position: fixed;
		top: 40px;
		right: 10px;
		z-index: 9999;
		width: 240px;
		max-height: calc(100vh - 50px);
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 3px;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
		font-family: var(--font-mono);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.float-props-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 8px;
		border-bottom: 1px solid #eee;
		flex-shrink: 0;
		cursor: pointer;
		background: none;
		border-left: none;
		border-right: none;
		border-top: none;
		width: 100%;
		color: #999;
	}

	.float-props-header:hover {
		background: #f8f9fa;
	}

	.float-props-title {
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #999;
		text-transform: uppercase;
		font-family: var(--font-mono);
	}

	.fp-empty {
		padding: 12px 0;
		text-align: center;
		font-size: 9px;
		color: #ccc;
	}

	.float-props-body {
		padding: 6px 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		overflow-y: auto;
	}

	.fp-field {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.fp-lbl {
		font-size: 8px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: #999;
		text-transform: uppercase;
	}

	.fp-unit {
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		color: #bbb;
	}

	.fp-input {
		width: 100%;
		padding: 3px 5px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #f8f9fa;
		color: #1a1a1a;
		font-size: 10px;
		font-family: var(--font-mono);
		outline: none;
	}

	.fp-input:focus {
		border-color: #2563eb;
	}

	.fp-select {
		width: 100%;
		padding: 3px 5px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #f8f9fa;
		color: #333;
		font-size: 10px;
		font-family: var(--font-mono);
		outline: none;
	}

	.fp-select:focus {
		border-color: #2563eb;
	}

	.fp-coords {
		display: flex;
		align-items: center;
		gap: 3px;
	}

	.fp-coord-val {
		font-size: 10px;
		color: #333;
		font-variant-numeric: tabular-nums;
	}

	.fp-copy {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 2px;
		background: transparent;
		border: none;
		color: #999;
		cursor: pointer;
	}

	.fp-copy:hover {
		color: #333;
		background: #f5f5f5;
	}

	.fp-static {
		font-size: 10px;
		color: #333;
	}

	.fp-measure {
		font-size: 10px;
		color: #2563eb;
		font-weight: 600;
	}

	.fp-icon-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}

	.fp-icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #fff;
		color: #666;
		cursor: pointer;
	}

	.fp-icon-btn:hover {
		background: #f5f5f5;
		color: #1a1a1a;
	}

	.fp-icon-btn.active {
		background: #f0f4ff;
		border-color: #2563eb;
		color: #2563eb;
	}

	.fp-stroke-row {
		display: flex;
		align-items: center;
		gap: 3px;
	}

	.fp-stroke-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 16px;
		border-radius: 2px;
		border: 1px solid transparent;
		background: transparent;
		cursor: pointer;
	}

	.fp-stroke-btn:hover {
		background: #f5f5f5;
	}

	.fp-stroke-btn.active {
		border-color: #333;
	}

	.fp-stroke-line {
		display: block;
		width: 12px;
		background: #333;
	}

	.fp-expand-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 3px 0;
		margin-top: 2px;
		background: none;
		border: none;
		border-top: 1px solid #f0f0f0;
		color: #999;
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
		width: 100%;
	}

	.fp-expand-btn:hover {
		color: #666;
	}

	.tool-panel {
		position: fixed;
		top: 40px;
		right: 260px;
		z-index: 9999;
		width: 240px;
		max-height: calc(100vh - 50px);
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 3px;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
		font-family: var(--font-mono);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: panel-slide-in 0.15s ease-out;
	}

	.tool-panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 8px;
		border-bottom: 1px solid #eee;
		flex-shrink: 0;
	}

	.tool-panel-title {
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #999;
		text-transform: uppercase;
	}

	.tool-panel-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 2px;
		background: none;
		border: none;
		color: #999;
		cursor: pointer;
	}

	.tool-panel-close:hover {
		color: #1a1a1a;
		background: #f5f5f5;
	}

	.tool-panel-body {
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow-y: auto;
	}

	.tp-field {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.tp-lbl {
		font-size: 8px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: #999;
		text-transform: uppercase;
	}

	.tp-unit-inline {
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		color: #bbb;
	}

	.tp-input {
		width: 100%;
		padding: 4px 6px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #f8f9fa;
		color: #1a1a1a;
		font-size: 10px;
		font-family: var(--font-mono);
		outline: none;
	}

	.tp-input:focus {
		border-color: #2563eb;
	}

	.tp-input-sm {
		width: 80px;
	}

	.tp-radius-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.tp-unit {
		font-size: 9px;
		color: #999;
	}

	.tp-presets {
		display: flex;
		gap: 2px;
		flex-wrap: wrap;
	}

	.tp-preset {
		padding: 2px 6px;
		font-size: 9px;
		font-family: var(--font-mono);
		font-weight: 600;
		background: #fff;
		border: 1px solid #e0e0e0;
		border-radius: 2px;
		color: #666;
		cursor: pointer;
	}

	.tp-preset:hover {
		background: #f5f5f5;
	}

	.tp-preset.active {
		background: #f0f4ff;
		border-color: #2563eb;
		color: #2563eb;
	}

	.tp-hint {
		font-size: 9px;
		color: #999;
	}

	.tp-value {
		font-size: 11px;
		font-weight: 600;
		color: #1a1a1a;
	}

	.tp-btn {
		padding: 5px 10px;
		border-radius: 2px;
		border: none;
		background: #2563eb;
		color: #fff;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		cursor: pointer;
	}

	.tp-btn:hover {
		background: #1d4ed8;
	}

	.tp-btn:disabled {
		background: #e0e0e0;
		color: #999;
		cursor: default;
	}

	.tp-btn-text {
		background: none;
		border: none;
		color: #999;
		font-family: var(--font-mono);
		font-size: 9px;
		cursor: pointer;
		text-align: left;
		padding: 2px 0;
	}

	.tp-btn-text:hover {
		color: #dc2626;
	}

	.tp-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-top: 1px solid #f0f0f0;
		padding-top: 6px;
	}

	.tp-list-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 2px 0;
	}

	.tp-list-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.tp-list-label {
		font-size: 9px;
		color: #333;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}

	.tp-list-del {
		background: none;
		border: none;
		color: #ccc;
		font-size: 14px;
		cursor: pointer;
		padding: 0 2px;
		line-height: 1;
	}

	.tp-list-del:hover {
		color: #dc2626;
	}

	.tp-density-btns {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tp-density-btn {
		display: flex;
		flex-direction: column;
		padding: 4px 6px;
		border: 1px solid #e0e0e0;
		border-radius: 2px;
		background: #fff;
		cursor: pointer;
		text-align: left;
	}

	.tp-density-btn:hover {
		background: #f5f5f5;
	}

	.tp-density-btn.active {
		background: #f0f4ff;
		border-color: #2563eb;
	}

	.tp-density-label {
		font-size: 10px;
		font-weight: 600;
		color: #1a1a1a;
		font-family: var(--font-mono);
	}

	.tp-density-desc {
		font-size: 8px;
		color: #999;
		font-family: var(--font-mono);
	}

	.tp-result {
		display: flex;
		flex-direction: column;
		padding: 8px;
		background: #f8f9fa;
		border: 1px solid #e0e0e0;
		border-radius: 2px;
		text-align: center;
	}

	.tp-result-label {
		font-size: 8px;
		font-weight: 600;
		color: #999;
		letter-spacing: 0.06em;
	}

	.tp-result-value {
		font-size: 20px;
		font-weight: 700;
		color: #2563eb;
		font-family: var(--font-mono);
	}

	.tp-result-sub {
		font-size: 9px;
		color: #999;
	}

	.tp-range {
		width: 100%;
		-webkit-appearance: none;
		appearance: none;
		height: 3px;
		border-radius: 0;
		background: #eee;
		outline: none;
		cursor: pointer;
	}

	.tp-range::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #f59e0b;
		border: 2px solid #fff;
		cursor: pointer;
	}

	.tp-range::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #f59e0b;
		border: 2px solid #fff;
		cursor: pointer;
	}

	.tp-sun-data {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px 0;
		border-top: 1px solid #f0f0f0;
	}

	.tp-sun-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.tp-sun-label {
		font-size: 9px;
		color: #999;
	}

	.tp-sun-value {
		font-size: 10px;
		font-weight: 600;
		color: #1a1a1a;
		font-family: var(--font-mono);
	}

	.tp-tz-main {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 8px 0;
		gap: 2px;
	}

	.tp-tz-name {
		font-size: 10px;
		font-weight: 600;
		color: #666;
		font-family: var(--font-mono);
		letter-spacing: 0.03em;
	}

	.tp-weather-btns {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tp-weather-btn {
		padding: 5px 8px;
		border: 1px solid #e0e0e0;
		border-radius: 2px;
		background: #fff;
		color: #333;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 500;
		cursor: pointer;
		text-align: left;
	}

	.tp-weather-btn:hover {
		background: #f5f5f5;
	}

	.tp-weather-btn.active {
		background: #f0f4ff;
		border-color: #2563eb;
		color: #2563eb;
		font-weight: 600;
	}

	.tp-tz-offset {
		font-size: 14px;
		font-weight: 700;
		color: #2563eb;
		font-family: var(--font-mono);
	}

	.tp-tz-time {
		font-size: 20px;
		font-weight: 700;
		color: #1a1a1a;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	.timeline-panel {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 7px;
		border-radius: 3px;
		background: #fff;
		border: 1px solid #ddd;
		font-family: var(--font-mono);
		width: 180px;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
	}

	.timeline-row {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.timeline-play {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 2px;
		border: 1px solid #ddd;
		background: #fff;
		color: #666;
		cursor: pointer;
		flex-shrink: 0;
	}

	.timeline-play:hover {
		color: #1a1a1a;
		background: #f5f5f5;
	}

	.timeline-scrubber {
		width: 100%;
		height: 3px;
		-webkit-appearance: none;
		appearance: none;
		background: #eee;
		border-radius: 0;
		outline: none;
		cursor: pointer;
	}

	.timeline-scrubber::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #2563eb;
		border: 2px solid #fff;
		cursor: pointer;
	}

	.timeline-scrubber::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #2563eb;
		border: 2px solid #fff;
		cursor: pointer;
	}

	.timeline-time {
		font-size: 9px;
		color: #666;
		white-space: nowrap;
		text-align: left;
	}

	.timeline-speed {
		padding: 2px 4px;
		border-radius: 2px;
		border: 1px solid #ddd;
		background: #fff;
		color: #666;
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
		width: 22px;
		height: 22px;
		border-radius: 2px;
		border: 1px solid #ddd;
		background: #fff;
		color: #666;
		cursor: pointer;
		flex-shrink: 0;
	}

	.tl-layer-btn:hover {
		color: #1a1a1a;
		background: #f5f5f5;
	}

	.tl-layer-btn.active {
		color: #2563eb;
		background: #f0f4ff;
	}

	.tl-layer-dropdown {
		position: absolute;
		bottom: 100%;
		right: 0;
		margin-bottom: 4px;
		padding: 5px;
		border-radius: 3px;
		background: #fff;
		border: 1px solid #ddd;
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 130px;
		z-index: 30;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.tl-layer-option {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 3px 4px;
		border-radius: 2px;
		cursor: pointer;
		font-size: 10px;
		color: #333;
		white-space: nowrap;
	}

	.tl-layer-option:hover {
		background: #f5f5f5;
	}

	.tl-layer-option input[type="checkbox"] {
		appearance: none;
		width: 12px;
		height: 12px;
		border: 1px solid #ddd;
		border-radius: 2px;
		background: #fff;
		cursor: pointer;
		flex-shrink: 0;
		position: relative;
	}

	.tl-layer-option input[type="checkbox"]:checked {
		background: #2563eb;
		border-color: #2563eb;
	}

	.tl-layer-option input[type="checkbox"]:checked::after {
		content: '';
		position: absolute;
		left: 3px;
		top: 0.5px;
		width: 3.5px;
		height: 6.5px;
		border: solid #ffffff;
		border-width: 0 1.5px 1.5px 0;
		transform: rotate(45deg);
	}

	.tl-layer-dot {
		width: 7px;
		height: 7px;
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
		border-radius: 2px;
		border: 1px solid #ddd;
		background: #fff;
		color: #999;
		font-size: 9px;
		font-family: var(--font-mono);
		cursor: pointer;
		text-align: center;
		margin-top: 2px;
	}

	.tl-layer-clear:hover {
		color: #1a1a1a;
		background: #f5f5f5;
	}

	.divider {
		flex-shrink: 0;
		height: 3px;
		background: #f0f0f0;
		border-top: 1px solid #e0e0e0;
		border-bottom: 1px solid #e0e0e0;
		cursor: row-resize;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.08s;
	}

	.divider:hover,
	.divider.dragging {
		background: #e0e0e0;
	}

	.divider-grip {
		width: 28px;
		height: 2px;
		border-radius: 1px;
		background: #ccc;
	}

	.divider:hover .divider-grip,
	.divider.dragging .divider-grip {
		background: #999;
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
		background: rgba(0, 0, 0, 0.25);
	}

	.modal {
		width: 360px;
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 4px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		border-bottom: 1px solid #eee;
		background: #f8f9fa;
	}

	.modal-title {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #999;
		text-transform: uppercase;
	}

	.modal-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 2px;
		background: transparent;
		border: none;
		color: #999;
		cursor: pointer;
		transition: all 0.08s;
	}

	.modal-close:hover {
		color: #1a1a1a;
		background: #f0f0f0;
	}

	.modal-body {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.modal-textarea {
		width: 100%;
		padding: 8px 10px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #f8f9fa;
		color: #1a1a1a;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.5;
		resize: vertical;
		outline: none;
		transition: border-color 0.08s;
	}

	.modal-textarea:focus {
		border-color: #2563eb;
	}

	.modal-textarea::placeholder {
		color: #ccc;
	}

	.modal-input {
		width: 100%;
		padding: 6px 10px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #f8f9fa;
		color: #1a1a1a;
		font-family: var(--font-mono);
		font-size: 11px;
		outline: none;
	}

	.modal-input:focus {
		border-color: #2563eb;
	}

	.modal-input::placeholder {
		color: #ccc;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		padding: 10px 14px;
		border-top: 1px solid #eee;
		background: #f8f9fa;
	}

	.modal-btn {
		padding: 6px 14px;
		border-radius: 2px;
		border: none;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		transition: all 0.08s;
	}

	.modal-btn.cancel {
		background: #fff;
		color: #666;
		border: 1px solid #ddd;
	}

	.modal-btn.cancel:hover {
		color: #1a1a1a;
		border-color: #ccc;
		background: #f5f5f5;
	}

	.modal-btn.confirm {
		background: #2563eb;
		color: #ffffff;
		border: 1px solid #2563eb;
	}

	.modal-btn.confirm:hover {
		background: #1d4ed8;
		border-color: #1d4ed8;
	}

	.modal-btn.confirm:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.csv-modal {
		width: 440px;
	}

	.csv-mapping {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.csv-field {
		display: grid;
		grid-template-columns: 90px 1fr;
		align-items: center;
		gap: 10px;
	}

	.csv-label {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		color: #666;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.csv-optional {
		color: #999;
		font-weight: 400;
		text-transform: none;
		font-size: 8px;
	}

	.csv-select {
		flex: 1;
		padding: 6px 8px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #f8f9fa;
		color: #1a1a1a;
		font-family: var(--font-mono);
		font-size: 10px;
		outline: none;
		transition: border-color 0.08s;
	}

	.csv-select:focus {
		border-color: #2563eb;
	}

	.csv-preview {
		border: 1px solid #e0e0e0;
		border-radius: 3px;
		overflow: hidden;
	}

	.csv-table {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-mono);
		font-size: 9px;
	}

	.csv-table th {
		padding: 5px 8px;
		text-align: left;
		color: #999;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		background: #f8f9fa;
		border-bottom: 1px solid #e0e0e0;
	}

	.csv-table td {
		padding: 4px 8px;
		color: #666;
		border-bottom: 1px solid #f0f0f0;
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
		padding: 4px 8px;
		font-family: var(--font-mono);
		font-size: 9px;
		color: #999;
		text-align: center;
	}

	.csv-status {
		font-family: var(--font-mono);
		font-size: 9px;
		padding: 2px 0;
	}

	.csv-ok {
		color: #10b981;
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
		padding: 5px 8px;
		border: 1px solid #e0e0e0;
		background: #fff;
		color: #999;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.08s;
	}

	.csv-toggle-btn:first-child {
		border-radius: 2px 0 0 2px;
		border-right: none;
	}

	.csv-toggle-btn:last-child {
		border-radius: 0 2px 2px 0;
	}

	.csv-toggle-btn.active {
		background: #f0f4ff;
		color: #2563eb;
		border-color: #2563eb;
	}

	.csv-toggle-btn:hover:not(.active) {
		color: #333;
		background: #f5f5f5;
	}

	.csv-section-label {
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #999;
		margin-bottom: 2px;
	}

	.csv-divider {
		height: 1px;
		background: #f0f0f0;
		margin: 4px 0;
	}

	.csv-sub-field {
		padding-left: 10px;
		border-left: 2px solid #e0e0e0;
		margin-left: 4px;
	}

	.csv-label-indent {
		padding-left: 0;
		color: #999;
	}

	.csv-walkthrough-modal {
		width: 420px;
	}

	.walkthrough-desc {
		font-family: var(--font-mono);
		font-size: 10px;
		color: #666;
		line-height: 1.7;
	}

	.walkthrough-desc strong {
		color: #1a1a1a;
		font-weight: 600;
	}

	.walkthrough-columns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.walkthrough-col {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 10px;
		border-radius: 3px;
		border: 1px solid #e0e0e0;
		background: #f8f9fa;
	}

	.walkthrough-col.required {
		border-color: #2563eb;
		background: #f0f4ff;
	}

	.walkthrough-col-name {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		color: #1a1a1a;
	}

	.walkthrough-col-info {
		font-family: var(--font-mono);
		font-size: 8px;
		color: #999;
		line-height: 1.3;
	}

	.walkthrough-col.required .walkthrough-col-info {
		color: #2563eb;
		opacity: 0.6;
	}

	.walkthrough-example {
		border: 1px solid #e0e0e0;
		border-radius: 3px;
		overflow: hidden;
	}

	.walkthrough-example-label {
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: #999;
		text-transform: uppercase;
		padding: 4px 8px;
		background: #f8f9fa;
		border-bottom: 1px solid #e0e0e0;
	}

	.walkthrough-example-code {
		display: block;
		font-family: var(--font-mono);
		font-size: 9px;
		color: #666;
		padding: 6px 8px;
		line-height: 1.6;
		overflow-x: auto;
	}

	.walkthrough-note {
		font-family: var(--font-mono);
		font-size: 9px;
		color: #999;
		text-align: center;
	}

	.ctx-menu {
		position: fixed;
		z-index: 200;
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 3px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
		padding: 3px;
		min-width: 150px;
	}

	.ctx-item {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		padding: 6px 10px;
		background: transparent;
		border: none;
		border-radius: 2px;
		color: #333;
		font-family: var(--font-mono);
		font-size: 10px;
		cursor: pointer;
		transition: background 0.08s;
	}

	.ctx-item:hover {
		background: #f5f5f5;
		color: #1a1a1a;
	}

	.ctx-coords {
		padding: 5px 10px;
		font-family: var(--font-mono);
		font-size: 9px;
		font-variant-numeric: tabular-nums;
		color: #999;
		user-select: text;
	}

	.ctx-sep {
		height: 1px;
		background: #f0f0f0;
		margin: 2px 4px;
	}

	.nearby-panel {
		position: absolute;
		top: 40px;
		left: 8px;
		z-index: 20;
		width: 260px;
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 3px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
		overflow: hidden;
		max-height: calc(100% - 50px);
		display: flex;
		flex-direction: column;
	}

	.nearby-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 10px;
		border-bottom: 1px solid #eee;
		background: #f8f9fa;
		flex-shrink: 0;
	}

	.nearby-body {
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.nearby-input {
		width: 100%;
		padding: 6px 8px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #f8f9fa;
		color: #1a1a1a;
		font-family: var(--font-mono);
		font-size: 10px;
		outline: none;
		transition: border-color 0.08s;
	}

	.nearby-input:focus {
		border-color: #2563eb;
	}

	.nearby-input::placeholder {
		color: #ccc;
	}

	.nearby-section-label {
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: #999;
		text-transform: uppercase;
	}

	.radius-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 3px;
	}

	.radius-btn {
		padding: 4px 3px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #fff;
		color: #999;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.08s;
	}

	.radius-btn:hover {
		border-color: #ccc;
		color: #666;
	}

	.radius-btn.active {
		border-color: #2563eb;
		color: #2563eb;
		background: #f0f4ff;
	}

	.nearby-search-btn {
		padding: 6px;
		border-radius: 2px;
		border: 1px solid #2563eb;
		background: #2563eb;
		color: #ffffff;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		cursor: pointer;
		transition: background 0.08s;
	}

	.nearby-search-btn:hover {
		background: #1d4ed8;
	}

	.nearby-search-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.nearby-results {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}

	.nearby-results-actions {
		display: flex;
		gap: 6px;
		padding: 6px 10px;
		border-bottom: 1px solid #f0f0f0;
		flex-shrink: 0;
	}

	.nearby-text-btn {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		color: #999;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 2px;
	}

	.nearby-text-btn:hover {
		color: #333;
		background: #f5f5f5;
	}

	.nearby-results-list {
		display: flex;
		flex-direction: column;
	}

	.nearby-result {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		padding: 6px 10px;
		background: transparent;
		border: none;
		border-bottom: 1px solid #f0f0f0;
		cursor: pointer;
		text-align: left;
		transition: background 0.08s;
		width: 100%;
		font-family: var(--font-mono);
	}

	.nearby-result:hover {
		background: #f5f5f5;
	}

	.nearby-result.selected {
		background: #f0f4ff;
	}

	.nearby-check {
		width: 14px;
		height: 14px;
		border-radius: 2px;
		border: 1px solid #ddd;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-top: 1px;
		color: #2563eb;
		background: #fff;
	}

	.nearby-check.checked {
		border-color: #2563eb;
		background: #2563eb;
		color: #fff;
	}

	.nearby-result-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.nearby-result-name {
		font-size: 10px;
		color: #1a1a1a;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.nearby-result-addr {
		font-size: 9px;
		color: #999;
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
		font-size: 9px;
		color: #f59e0b;
		flex-shrink: 0;
	}

	.nearby-empty {
		padding: 16px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: 10px;
		color: #999;
	}

	.nearby-layer-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-top: 1px solid #eee;
		flex-shrink: 0;
	}

	.nearby-layer-label {
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		color: #999;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.nearby-layer-select {
		flex: 1;
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 2px;
		color: #1a1a1a;
		font-family: var(--font-mono);
		font-size: 9px;
		padding: 3px 5px;
		outline: none;
	}

	.nearby-layer-select:focus {
		border-color: #2563eb;
	}

	.nearby-footer {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		padding: 8px 10px;
		border-top: 1px solid #eee;
		flex-shrink: 0;
	}

	.share-hint {
		font-family: var(--font-mono);
		font-size: 10px;
		color: #999;
		line-height: 1.6;
	}

	.decrypt-error {
		border-color: #dc2626 !important;
	}

	.decrypt-error-msg {
		font-family: var(--font-mono);
		font-size: 9px;
		color: #dc2626;
		font-weight: 600;
	}
</style>
