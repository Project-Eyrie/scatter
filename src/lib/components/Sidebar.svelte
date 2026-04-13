<script lang="ts">
	// Sidebar with search, layers, and tabs for pins, routes, and drawings
	import { pinStore } from '$lib/stores.svelte';
	import { drawingStore } from '$lib/drawing-store.svelte';
	import { layerStore } from '$lib/layer-store.svelte';
	import { historyStore } from '$lib/history-store.svelte';
	import { haversineDistance, formatDistance, formatDuration, polygonArea, formatArea, polylineLength } from '$lib/geo';
	import SearchBar from './SearchBar.svelte';
	import { LAYER_COLORS, ROUTE_COLORS, DRAW_ICON_PATHS, STROKE_WIDTH_OPTIONS, PIN_ICONS } from '$lib/constants';
	import { formatTimestamp } from '$lib/csv-import';
	import type { RouteInfo, RoutePair, TravelMode } from '$lib/types';

	interface Props {
		routes: RoutePair[];
		routeResults: (RouteInfo | null)[][];
		notesVisible: boolean;
		labelsVisible: boolean;
		travelMode: TravelMode;
		onRoutesChange: (routes: RoutePair[]) => void;
		onNotesVisibleChange: (visible: boolean) => void;
		onLabelsVisibleChange: (visible: boolean) => void;
		onTravelModeChange: (mode: TravelMode) => void;
		onFlyTo: (lat: number, lng: number) => void;
		onSaveRouteAsPath: (routeIndex: number) => void;
		onFilteredPinIds?: (ids: Set<string> | null) => void;
	}

	let {
		routes,
		routeResults,
		notesVisible,
		labelsVisible,
		travelMode,
		onRoutesChange,
		onNotesVisibleChange,
		onLabelsVisibleChange,
		onTravelModeChange,
		onFlyTo,
		onSaveRouteAsPath,
		onFilteredPinIds
	}: Props = $props();

	// Creates a new route between the first two pins
	function addRoute() {
		if (pinStore.pins.length < 2) return;
		const newRoute: RoutePair = {
			id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			waypointIds: [pinStore.pins[0].id, pinStore.pins[1].id]
		};
		onRoutesChange([...routes, newRoute]);
	}

	// Removes a route by its ID
	function removeRoute(id: string) {
		onRoutesChange(routes.filter((r) => r.id !== id));
	}

	// Updates a specific waypoint in a route to a different pin
	function updateWaypoint(routeId: string, wpIdx: number, pinId: string) {
		onRoutesChange(routes.map((r) => {
			if (r.id !== routeId) return r;
			const updated = [...r.waypointIds];
			updated[wpIdx] = pinId;
			return { ...r, waypointIds: updated };
		}));
	}

	// Appends a new waypoint to an existing route
	function addWaypoint(routeId: string, pinId: string) {
		onRoutesChange(routes.map((r) => {
			if (r.id !== routeId) return r;
			return { ...r, waypointIds: [...r.waypointIds, pinId] };
		}));
	}

	// Removes a waypoint from a route, deleting the route if fewer than 2 remain
	function removeWaypoint(routeId: string, wpIdx: number) {
		onRoutesChange(routes.map((r) => {
			if (r.id !== routeId) return r;
			const updated = r.waypointIds.filter((_, i) => i !== wpIdx);
			return { ...r, waypointIds: updated };
		}).filter((r) => r.waypointIds.length >= 2));
	}

	let copiedPinId = $state<string | null>(null);

	// Copies pin coordinates to clipboard with brief visual feedback
	function copyCoords(pin: { lat: number; lng: number; id: string }) {
		navigator.clipboard.writeText(`${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}`);
		copiedPinId = pin.id;
		setTimeout(() => { copiedPinId = null; }, 1500);
	}

	let activeSection = $state<'pins' | 'route' | 'draw'>('pins');
	let layersExpanded = $state(false);
	let addingLayer = $state(false);
	let newLayerName = $state('');
	let editingLayerId = $state<string | null>(null);
	let editingLayerName = $state('');

	// Creates a new layer with auto-assigned color
	function addLayer() {
		if (!newLayerName.trim()) return;
		const colorIndex = layerStore.layers.length % LAYER_COLORS.length;
		layerStore.addLayer(newLayerName.trim(), LAYER_COLORS[colorIndex]);
		newLayerName = '';
		addingLayer = false;
	}

	// Begins inline editing of a layer name
	function startEditLayer(id: string, name: string) {
		editingLayerId = id;
		editingLayerName = name;
	}

	// Saves the edited layer name
	function finishEditLayer() {
		if (editingLayerId && editingLayerName.trim()) {
			layerStore.updateLayer(editingLayerId, { name: editingLayerName.trim() });
		}
		editingLayerId = null;
	}

	// Counts pins belonging to a specific layer
	function layerPinCount(layerId: string): number {
		return pinStore.pins.filter((p) => p.layerId === layerId).length;
	}

	// Counts drawings belonging to a specific layer
	function layerDrawCount(layerId: string): number {
		return drawingStore.drawings.filter((d) => d.layerId === layerId).length;
	}

	let pinSearch = $state('');
	let filterOpen = $state(false);
	let filterLayerId = $state<string | null>(null);
	let filterTimestamp = $state<'all' | 'with' | 'without'>('all');

	// Filters pins by search query, layer, and timestamp status
	let filteredPins = $derived(
		pinStore.pins.filter((p) => {
			if (filterLayerId && p.layerId !== filterLayerId) return false;
			if (filterTimestamp === 'with' && !p.timestamp) return false;
			if (filterTimestamp === 'without' && p.timestamp) return false;
			if (pinSearch.trim() !== '') {
				const q = pinSearch.toLowerCase();
				if (!p.label.toLowerCase().includes(q) && !`${p.lat},${p.lng}`.includes(q)) return false;
			}
			return true;
		})
	);

	let hasActiveFilters = $derived(filterLayerId !== null || filterTimestamp !== 'all');

	// Emits filtered pin IDs to parent when filters are active
	$effect(() => {
		if (!onFilteredPinIds) return;
		if (!hasActiveFilters && pinSearch.trim() === '') {
			onFilteredPinIds(null);
		} else {
			onFilteredPinIds(new Set(filteredPins.map(p => p.id)));
		}
	});
</script>

<aside class="sidebar">
	<div class="section-border" style="padding: 8px;">
		<SearchBar {onFlyTo} />
	</div>

	<div class="section-border">
		<button class="layers-toggle" onclick={() => (layersExpanded = !layersExpanded)}>
			<div class="flex items-center gap-2">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
				</svg>
				<span class="text-[10px] font-semibold tracking-wider text-slate-500">LAYERS</span>
				<span class="text-[10px] text-slate-600">{layerStore.layers.length}</span>
			</div>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-slate-600 transition-transform" class:rotate-180={layersExpanded} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
			</svg>
		</button>

		{#if layersExpanded}
			<div class="layers-list">
				{#each layerStore.layers as layer (layer.id)}
					{@const isActive = layer.id === layerStore.activeLayerId}
					<div class="layer-row" class:active={isActive}>
						<button
							class="layer-vis"
							onclick={() => layerStore.toggleVisibility(layer.id)}
							title="{layer.visible ? 'Hide' : 'Show'} layer"
						>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="color: {layer.visible ? layer.color : '#cbd5e1'}">
								{#if layer.visible}
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
								{:else}
									<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
								{/if}
							</svg>
						</button>

						{#if editingLayerId === layer.id}
							<input
								type="text"
								bind:value={editingLayerName}
								onblur={finishEditLayer}
								onkeydown={(e) => { if (e.key === 'Enter') finishEditLayer(); if (e.key === 'Escape') { editingLayerId = null; } }}
								class="layer-edit-input"
							/>
						{:else}
							<button
								class="layer-name"
								onclick={() => (layerStore.activeLayerId = layer.id)}
								ondblclick={() => startEditLayer(layer.id, layer.name)}
								title="Click to set active, double-click to rename"
							>
								<span class="layer-dot" style="background: {layer.color};"></span>
								<span class="layer-text">{layer.name}</span>
								<span class="layer-count">{layerPinCount(layer.id)}p {layerDrawCount(layer.id)}d</span>
							</button>
						{/if}

						{#if layer.id !== 'default'}
							<button class="layer-del" onclick={() => layerStore.removeLayer(layer.id)} title="Delete layer">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
									<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
								</svg>
							</button>
						{/if}
					</div>

					{#if isActive}
						<div class="layer-color-row">
							{#each LAYER_COLORS as color}
								<button
									class="layer-swatch"
									class:active={layer.color === color}
									style="background: {color};"
									onclick={() => { layerStore.updateLayer(layer.id, { color }); drawingStore.syncLayerColor(layer.id, color); }}
									title="Set layer color"
								></button>
							{/each}
						</div>
					{/if}
				{/each}

				{#if addingLayer}
					<div class="layer-add-form">
						<input
							type="text"
							placeholder="Layer name..."
							bind:value={newLayerName}
							onkeydown={(e) => { if (e.key === 'Enter') addLayer(); if (e.key === 'Escape') { addingLayer = false; } }}
							class="layer-add-input"
						/>
						<button class="layer-add-confirm" onclick={addLayer} title="Add">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						</button>
					</div>
				{:else}
					<button class="layer-add-btn" onclick={() => { addingLayer = true; }}>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
						</svg>
						<span>Add layer</span>
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<div class="tab-row">
		{#each [
			{ key: 'pins', label: 'PINS' },
			{ key: 'route', label: 'ROUTE' },
			{ key: 'draw', label: 'ANNOTATIONS' }
		] as tab (tab.key)}
			<button
				class="tab"
				class:active={activeSection === tab.key}
				onclick={() => (activeSection = tab.key as typeof activeSection)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<div class="flex-1 overflow-y-auto">
		{#if activeSection === 'pins'}
			<div class="content">
				{#if pinStore.pins.length > 0}
					<div class="content-header">
						<span class="counter">{pinStore.pins.length} PIN{pinStore.pins.length !== 1 ? 'S' : ''}</span>
						<button class="text-btn danger" onclick={() => { historyStore.push('Cleared all pins'); pinStore.clearAll(); }}>Clear</button>
					</div>
					<div class="pin-search-row">
						<svg xmlns="http://www.w3.org/2000/svg" class="pin-search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
						</svg>
						<input
							type="text"
							placeholder="Filter pins..."
							bind:value={pinSearch}
							class="pin-search-input"
						/>
						{#if pinSearch}
							<button class="pin-search-clear" onclick={() => (pinSearch = '')}>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
									<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
								</svg>
							</button>
						{/if}
						<button class="pin-filter-btn" class:active={hasActiveFilters} onclick={() => filterOpen = !filterOpen} title="Filter options">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
							</svg>
						</button>
					</div>
					{#if filterOpen}
						<div class="pin-filter-panel">
							<div class="pin-filter-field">
								<span class="pin-filter-lbl">LAYER</span>
								<select class="pin-filter-select" bind:value={filterLayerId}>
									<option value={null}>All layers</option>
									{#each layerStore.layers as layer}
										<option value={layer.id}>
											{layer.name}
										</option>
									{/each}
								</select>
							</div>
							<div class="pin-filter-field">
								<span class="pin-filter-lbl">TIMESTAMP</span>
								<div class="pin-filter-radios">
									<label class="pin-filter-radio"><input type="radio" bind:group={filterTimestamp} value="all" /> All</label>
									<label class="pin-filter-radio"><input type="radio" bind:group={filterTimestamp} value="with" /> With</label>
									<label class="pin-filter-radio"><input type="radio" bind:group={filterTimestamp} value="without" /> Without</label>
								</div>
							</div>
							{#if hasActiveFilters}
								<button class="pin-filter-clear-btn" onclick={() => { filterLayerId = null; filterTimestamp = 'all'; }}>Clear filters</button>
							{/if}
						</div>
					{/if}
				{/if}

				{#if pinStore.pins.length === 0}
					<div class="empty">
						<svg xmlns="http://www.w3.org/2000/svg" class="empty-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
							<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
						</svg>
						<p class="empty-text">Right-click map to place pins</p>
					</div>
				{/if}

				<div class="list">
					{#each filteredPins as pin (pin.id)}
						{@const i = pinStore.pins.indexOf(pin)}
						{@const sel = pin.id === pinStore.selectedPinId}
						{@const pinLayer = layerStore.layers.find((l) => l.id === pin.layerId)}
						<div
							class="card" class:selected={sel}
							onclick={() => { pinStore.selectedPinId = pin.id; onFlyTo(pin.lat, pin.lng); }}
							role="button" tabindex="0"
							onkeydown={(e) => { if (e.key === 'Enter') { pinStore.selectedPinId = pin.id; onFlyTo(pin.lat, pin.lng); } }}
						>
							<div class="card-row">
								<span class="badge" style="border-color: {pinLayer?.color ?? '#22d3ee'}; color: {pinLayer?.color ?? '#22d3ee'}; {sel ? `box-shadow: 0 0 0 3px ${pinLayer?.color ?? '#22d3ee'}44;` : ''}">
									{#if pin.icon && PIN_ICONS[pin.icon]}
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={PIN_ICONS[pin.icon].fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3"><path d={PIN_ICONS[pin.icon].path} /></svg>
									{:else}
										{i + 1}
									{/if}
								</span>
								<div class="card-body">
									<input
										type="text" value={pin.label}
										oninput={(e) => pinStore.updatePin(pin.id, { label: (e.target as HTMLInputElement).value })}
										onclick={(e) => e.stopPropagation()}
										class="card-name"
									/>
									{#if pin.timestamp}
										<div class="card-timestamp">{formatTimestamp(pin.timestamp)}</div>
									{/if}
									<div class="card-meta">
										<span class="layer-indicator" style="background: {pinLayer?.color ?? '#22d3ee'};"></span>
										{pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}
									</div>
								</div>
								<div class="card-actions">
									<button class="card-act" onclick={(e) => { e.stopPropagation(); copyCoords(pin); }} title={copiedPinId === pin.id ? 'Copied!' : 'Copy coordinates'}>
										{#if copiedPinId === pin.id}
											<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="#10b981" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
											</svg>
										{:else}
											<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
												<path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
											</svg>
										{/if}
									</button>
									<button class="card-act del" onclick={(e) => { e.stopPropagation(); historyStore.push('Removed pin'); pinStore.removePin(pin.id); }} title="Delete">
										<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
											<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
										</svg>
									</button>
								</div>
							</div>
							{#if sel}
								<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
								<div class="card-layer-row" onclick={(e) => e.stopPropagation()}>
									<span class="card-layer-label">LAYER</span>
									<select
										value={pin.layerId}
										onchange={(e) => pinStore.updatePin(pin.id, { layerId: (e.target as HTMLSelectElement).value })}
										class="card-layer-sel"
									>
										{#each layerStore.layers as layer}
											<option value={layer.id}>{layer.name}</option>
										{/each}
									</select>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>

		{:else if activeSection === 'route'}
			<div class="content">
				{#if pinStore.pins.length < 2}
					<div class="empty">
						<svg xmlns="http://www.w3.org/2000/svg" class="empty-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
						</svg>
						<p class="empty-text">Place 2+ pins for routes</p>
					</div>
				{:else}
					<div class="route-builder">
						<div class="content-header">
							<span class="counter">{routes.length} ROUTE{routes.length !== 1 ? 'S' : ''}</span>
							{#if routes.length > 0}
								<button class="text-btn danger" onclick={() => onRoutesChange([])}>Clear</button>
							{/if}
						</div>

						<div class="travel-toggle">
							<button
								class="travel-btn"
								class:active={travelMode === 'DRIVING'}
								onclick={() => onTravelModeChange('DRIVING')}
								title="Driving mode"
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M8 17a2 2 0 100-4 2 2 0 000 4zM16 17a2 2 0 100-4 2 2 0 000 4zM4 11l2-5h12l2 5M4 11v6h1.5m13 0H20v-6M4 11h16" />
								</svg>
								<span>DRIVE</span>
							</button>
							<button
								class="travel-btn"
								class:active={travelMode === 'WALKING'}
								onclick={() => onTravelModeChange('WALKING')}
								title="Walking mode"
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M13 7a2 2 0 100-4 2 2 0 000 4zM15.5 21l-3-8.5L9 15v6M9 15l3-8 4 2" />
								</svg>
								<span>WALK</span>
							</button>
						</div>

						<div class="route-pairs">
							{#each routes as route, ri (route.id)}
								{@const routeColor = ROUTE_COLORS[ri % ROUTE_COLORS.length]}
								{@const segResults = routeResults[ri] ?? []}
								<div class="route-pair-card">
									<div class="route-pair-header">
										<span class="route-color-dot" style="background: {routeColor};"></span>
										<span class="route-pair-num">ROUTE {ri + 1}</span>
										<button class="wp-del" onclick={() => onSaveRouteAsPath(ri)} title="Save as path">
											<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
											</svg>
										</button>
										<button class="wp-del" onclick={() => removeRoute(route.id)} title="Remove route">
											<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
												<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
											</svg>
										</button>
									</div>
									<div class="route-pair-selects">
										{#each route.waypointIds as wpId, wi}
											{@const wpPin = pinStore.pins.find((p) => p.id === wpId)}
											<div class="route-field">
												<span class="wp-index" style="color: {routeColor};">{wi + 1}</span>
												<select
													value={wpId}
													onchange={(e) => updateWaypoint(route.id, wi, (e.target as HTMLSelectElement).value)}
													class="wp-sel"
												>
													{#each pinStore.pins as pin, j}
														<option value={pin.id}>[{j + 1}] {pin.label}</option>
													{/each}
												</select>
												{#if route.waypointIds.length > 2}
													<button class="wp-del" onclick={() => removeWaypoint(route.id, wi)} title="Remove waypoint">
														<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
															<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
														</svg>
													</button>
												{/if}
											</div>
											{#if wi < route.waypointIds.length - 1}
												{@const nextPin = pinStore.pins.find((p) => p.id === route.waypointIds[wi + 1])}
												{@const segResult = segResults[wi] ?? null}
												{#if wpPin && nextPin}
													<div class="seg-result">
														<div class="seg-arrow" style="color: {routeColor};">
															<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
																<path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
															</svg>
														</div>
														<div class="seg-stats">
															<span class="seg-stat cyan">{formatDistance(haversineDistance(wpPin, nextPin))}</span>
															{#if segResult}
																<span class="seg-stat amber">{segResult.distanceText || formatDistance(segResult.distance / 1000)}</span>
																<span class="seg-stat amber">{segResult.durationText || formatDuration(segResult.duration)}</span>
															{:else}
																<span class="seg-stat muted">...</span>
															{/if}
														</div>
													</div>
												{/if}
											{/if}
										{/each}
									</div>
									<select
										value=""
										onchange={(e) => { const val = (e.target as HTMLSelectElement).value; if (val) { addWaypoint(route.id, val); (e.target as HTMLSelectElement).value = ''; } }}
										class="wp-add-sel"
									>
										<option value="">+ Add waypoint...</option>
										{#each pinStore.pins as pin, j}
											<option value={pin.id}>[{j + 1}] {pin.label}</option>
										{/each}
									</select>
									{#if segResults.length > 0}
										{@const totalDrive = segResults.reduce((sum, r) => sum + (r ? r.distance / 1000 : 0), 0)}
										{@const totalTime = segResults.reduce((sum, r) => sum + (r ? r.duration : 0), 0)}
										{@const allLoaded = segResults.every((r) => r !== null)}
										<div class="route-total">
											<span class="route-total-label">TOTAL</span>
											{#if allLoaded}
												<span class="seg-stat amber">{formatDistance(totalDrive)}</span>
												<span class="seg-stat amber">{formatDuration(totalTime)} {travelMode === 'WALKING' ? 'walk' : 'drive'}</span>
											{:else}
												<span class="seg-stat muted">calculating...</span>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>

						<button class="route-add-btn" onclick={addRoute}>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
							</svg>
							<span>Add route</span>
						</button>
					</div>
				{/if}
			</div>

		{:else if activeSection === 'draw'}
			<div class="content">
				<div class="draw-controls">
					<button class="notes-toggle" onclick={() => onNotesVisibleChange(!notesVisible)} title="{notesVisible ? 'Hide' : 'Show'} notes on map">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="color: {notesVisible ? '#22d3ee' : '#cbd5e1'};">
							{#if notesVisible}
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
							{:else}
								<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
							{/if}
						</svg>
						<span class="notes-toggle-text">{notesVisible ? 'Notes visible' : 'Notes hidden'}</span>
					</button>
					<button class="notes-toggle" onclick={() => onLabelsVisibleChange(!labelsVisible)} title="{labelsVisible ? 'Hide' : 'Show'} labels on map">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="color: {labelsVisible ? '#f59e0b' : '#cbd5e1'};">
							{#if labelsVisible}
								<path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
							{:else}
								<path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18" />
							{/if}
						</svg>
						<span class="notes-toggle-text">{labelsVisible ? 'Labels visible' : 'Labels hidden'}</span>
					</button>
				</div>

				{#if drawingStore.drawings.length > 0}
					<div class="content-header">
						<span class="counter">{drawingStore.drawings.length} DRAWING{drawingStore.drawings.length !== 1 ? 'S' : ''}</span>
						<button class="text-btn danger" onclick={() => { historyStore.push('Cleared all drawings'); drawingStore.clearAll(); }}>Clear</button>
					</div>
				{/if}

				{#if drawingStore.drawings.length === 0}
					<div class="empty">
						<svg xmlns="http://www.w3.org/2000/svg" class="empty-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
						</svg>
						<p class="empty-text">Use toolbar to draw</p>
					</div>
				{/if}

				<div class="list">
					{#each drawingStore.drawings as drawing (drawing.id)}
						{@const sel = drawing.id === drawingStore.selectedDrawingId}
						{@const drawLayer = layerStore.layers.find((l) => l.id === drawing.layerId)}
						<div
							class="card" class:selected={sel}
							onclick={() => (drawingStore.selectedDrawingId = drawing.id)}
							role="button" tabindex="0"
							onkeydown={(e) => { if (e.key === 'Enter') drawingStore.selectedDrawingId = drawing.id; }}
						>
							<div class="card-row">
								<span class="draw-badge" style="color: {drawLayer?.color ?? '#22d3ee'};">
									<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d={DRAW_ICON_PATHS[drawing.type] ?? ''} />
									</svg>
								</span>
								<div class="card-body">
									<input
										type="text" value={drawing.label}
										oninput={(e) => drawingStore.updateDrawing(drawing.id, { label: (e.target as HTMLInputElement).value })}
										onclick={(e) => e.stopPropagation()}
										class="card-name"
									/>
									<div class="card-meta">
										<span class="layer-indicator" style="background: {drawLayer?.color ?? '#22d3ee'};"></span>
										{drawing.type}{drawing.text ? ` / "${drawing.text}"` : ''}
									</div>
									{#if drawing.timestamp}
										<div class="card-meta card-timestamp">{formatTimestamp(drawing.timestamp)}</div>
									{/if}
									{#if drawing.type === 'polygon' && drawing.points.length >= 3}
										<div class="card-measure">
											<span class="measure-val">{formatArea(polygonArea(drawing.points))}</span>
											<span class="measure-sep">/</span>
											<span class="measure-val">{formatDistance(polylineLength(drawing.points, true))} perimeter</span>
										</div>
									{:else if drawing.type === 'circle' && drawing.radius}
										<div class="card-measure">
											<span class="measure-val">{formatArea(Math.PI * (drawing.radius / 1000) ** 2)}</span>
											<span class="measure-sep">/</span>
											<span class="measure-val">{formatDistance(drawing.radius / 1000)} radius</span>
										</div>
									{:else if (drawing.type === 'path' || drawing.type === 'arrow') && drawing.points.length >= 2}
										<div class="card-measure">
											<span class="measure-val">{formatDistance(polylineLength(drawing.points))}</span>
										</div>
									{/if}
								</div>
								<div class="card-actions">
									<button class="card-act del" onclick={(e) => { e.stopPropagation(); historyStore.push('Removed drawing'); drawingStore.removeDrawing(drawing.id); }} title="Delete">
										<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
											<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
										</svg>
									</button>
								</div>
							</div>
							{#if sel}
								{#if drawing.type !== 'note'}
									<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
									<div class="stroke-row" onclick={(e) => e.stopPropagation()}>
										<span class="card-layer-label">WIDTH</span>
										{#each STROKE_WIDTH_OPTIONS as w}
											<button
												class="stroke-btn"
												class:active={drawing.strokeWidth === w}
												onclick={() => drawingStore.updateDrawing(drawing.id, { strokeWidth: w })}
												title="{w}px"
											>
												<span class="stroke-line" style="height: {w}px;"></span>
											</button>
										{/each}
									</div>
								{/if}
								{#if drawing.type === 'path' || drawing.type === 'arrow'}
									<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
									<div class="path-opts-row" onclick={(e) => e.stopPropagation()}>
										<button
											class="path-opt-btn"
											class:active={drawing.animated}
											onclick={() => drawingStore.updateDrawing(drawing.id, { animated: !drawing.animated })}
											title="Animate"
										>
											<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
												<path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
											</svg>
											<span>Animate</span>
										</button>
										<button
											class="path-opt-btn"
											onclick={() => drawingStore.updateDrawing(drawing.id, { reversed: !drawing.reversed })}
											title="Reverse direction"
										>
											<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
											</svg>
											<span>Reverse</span>
										</button>
									</div>
								{/if}
								<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
								<div class="card-layer-row" onclick={(e) => e.stopPropagation()}>
									<span class="card-layer-label">LAYER</span>
									<select
										value={drawing.layerId}
										onchange={(e) => drawingStore.updateDrawing(drawing.id, { layerId: (e.target as HTMLSelectElement).value })}
										class="card-layer-sel"
									>
										{#each layerStore.layers as layer}
											<option value={layer.id}>{layer.name}</option>
										{/each}
									</select>
								</div>
								{#if drawing.type === 'path' || drawing.type === 'arrow'}
									<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
									<div class="card-ts-row" onclick={(e) => e.stopPropagation()}>
										<div class="card-ts-field">
											<span class="card-layer-label">START</span>
											<input
												type="datetime-local"
												value={drawing.timestamp ? new Date(new Date(drawing.timestamp).getTime() - new Date(drawing.timestamp).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
												oninput={(e) => {
													const val = (e.target as HTMLInputElement).value;
													const startIso = val ? new Date(val).toISOString() : undefined;
													const updates: Record<string, string | undefined> = { timestamp: startIso };
													if (startIso && !drawing.endTimestamp && drawing.points.length >= 2) {
														const dist = polylineLength(drawing.points);
														const durationMs = (dist / 40) * 3600000;
														updates.endTimestamp = new Date(new Date(val).getTime() + durationMs).toISOString();
													}
													drawingStore.updateDrawing(drawing.id, updates);
												}}
												class="card-ts-input"
											/>
										</div>
										<div class="card-ts-field">
											<span class="card-layer-label">END</span>
											<input
												type="datetime-local"
												value={drawing.endTimestamp ? new Date(new Date(drawing.endTimestamp).getTime() - new Date(drawing.endTimestamp).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
												oninput={(e) => {
													const val = (e.target as HTMLInputElement).value;
													drawingStore.updateDrawing(drawing.id, { endTimestamp: val ? new Date(val).toISOString() : undefined });
												}}
												class="card-ts-input"
											/>
										</div>
									</div>
								{:else}
									<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
									<div class="card-ts-row" onclick={(e) => e.stopPropagation()}>
										<div class="card-ts-field" style="flex: 1;">
											<span class="card-layer-label">TIMESTAMP</span>
											<input
												type="datetime-local"
												value={drawing.timestamp ? new Date(new Date(drawing.timestamp).getTime() - new Date(drawing.timestamp).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
												oninput={(e) => {
													const val = (e.target as HTMLInputElement).value;
													drawingStore.updateDrawing(drawing.id, { timestamp: val ? new Date(val).toISOString() : undefined });
												}}
												class="card-ts-input"
											/>
										</div>
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>

</aside>

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		width: 300px;
		flex-shrink: 0;
		height: 100%;
		overflow: hidden;
		background: #fff;
		border-right: 1px solid #e0e0e0;
		font-family: var(--font-mono);
	}

	.section-border {
		border-bottom: 1px solid #e0e0e0;
	}

	.layers-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 5px 10px;
		background: transparent;
		border: none;
		cursor: pointer;
	}

	.layers-list {
		padding: 0 10px 6px;
	}

	.layer-row {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 4px;
		border-radius: 2px;
	}

	.layer-row.active {
		background: #f5f5f5;
	}

	.layer-vis {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		background: transparent;
		border: none;
		cursor: pointer;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.layer-vis:hover {
		background: #f5f5f5;
	}

	.layer-name {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 1px 4px;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		border-radius: 2px;
		min-width: 0;
	}

	.layer-name:hover {
		background: #f5f5f5;
	}

	.layer-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.layer-text {
		font-size: 10px;
		color: #333;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.layer-count {
		font-size: 9px;
		color: #999;
		flex-shrink: 0;
	}

	.layer-edit-input {
		flex: 1;
		padding: 1px 4px;
		background: transparent;
		border: none;
		border-bottom: 1px solid #e0e0e0;
		border-radius: 0;
		color: #1a1a1a;
		font-size: 10px;
		font-family: var(--font-mono);
		outline: none;
		min-width: 0;
	}

	.layer-edit-input:focus {
		border-bottom-color: #2563eb;
	}

	.layer-color-row {
		display: flex;
		gap: 3px;
		padding: 2px 4px 4px 30px;
	}

	.layer-swatch {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		border: 1.5px solid transparent;
		cursor: pointer;
	}

	.layer-swatch:hover {
		transform: scale(1.15);
	}

	.layer-swatch.active {
		border-color: #1a1a1a;
	}

	.layer-del {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		background: transparent;
		border: none;
		cursor: pointer;
		color: #ccc;
		border-radius: 2px;
		opacity: 0;
		flex-shrink: 0;
	}

	.layer-row:hover .layer-del {
		opacity: 1;
	}

	.layer-del:hover {
		color: #dc2626;
	}

	.layer-add-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 3px 4px;
		margin-top: 2px;
		background: transparent;
		border: none;
		cursor: pointer;
		color: #999;
		font-size: 9px;
		font-family: var(--font-mono);
		border-radius: 2px;
	}

	.layer-add-btn:hover {
		color: #666;
	}

	.layer-add-form {
		display: flex;
		gap: 4px;
		margin-top: 4px;
	}

	.layer-add-input {
		flex: 1;
		padding: 2px 6px;
		background: #f8f9fa;
		border: 1px solid #e0e0e0;
		border-radius: 2px;
		color: #1a1a1a;
		font-size: 10px;
		font-family: var(--font-mono);
		outline: none;
	}

	.layer-add-input:focus {
		border-color: #2563eb;
	}

	.layer-add-confirm {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 2px;
		background: transparent;
		border: none;
		color: #10b981;
		cursor: pointer;
	}

	.layer-add-confirm:hover {
		color: #059669;
	}

	.tab-row {
		display: flex;
		border-bottom: 1px solid #e0e0e0;
	}

	.tab {
		flex: 1;
		padding: 6px 10px;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #999;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
	}

	.tab:hover {
		color: #666;
	}

	.tab.active {
		color: #1a1a1a;
		border-bottom-color: #2563eb;
	}

	.content {
		padding: 6px 10px;
	}

	.content-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}

	.counter {
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #999;
	}

	.pin-search-row {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 3px 8px;
		margin-bottom: 6px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #f8f9fa;
	}

	.pin-search-row:focus-within {
		border-color: #2563eb;
	}

	.pin-search-icon {
		width: 11px;
		height: 11px;
		color: #999;
		flex-shrink: 0;
	}

	.pin-search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		font-family: var(--font-mono);
		font-size: 10px;
		color: #1a1a1a;
		min-width: 0;
	}

	.pin-search-input::placeholder {
		color: #ccc;
	}

	.pin-search-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border: none;
		background: transparent;
		color: #999;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}

	.pin-search-clear:hover {
		color: #666;
	}

	.pin-filter-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 2px;
		border: none;
		background: transparent;
		color: #999;
		cursor: pointer;
		flex-shrink: 0;
	}

	.pin-filter-btn:hover {
		color: #666;
	}

	.pin-filter-btn.active {
		color: #2563eb;
	}

	.pin-filter-panel {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 6px 8px;
		margin: 0 0 6px;
		border-radius: 2px;
		background: #f8f9fa;
		border: 1px solid #e0e0e0;
	}

	.pin-filter-field {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.pin-filter-lbl {
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #999;
		min-width: 50px;
	}

	.pin-filter-select {
		flex: 1;
		padding: 2px 4px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #fff;
		color: #333;
		font-size: 10px;
		font-family: var(--font-mono);
		cursor: pointer;
		outline: none;
	}

	.pin-filter-select:focus {
		border-color: #2563eb;
	}

	.pin-filter-radios {
		display: flex;
		gap: 8px;
	}

	.pin-filter-radio {
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 9px;
		color: #666;
		cursor: pointer;
	}

	.pin-filter-radio input {
		width: 10px;
		height: 10px;
		accent-color: #2563eb;
		cursor: pointer;
	}

	.pin-filter-clear-btn {
		padding: 2px 6px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: transparent;
		color: #666;
		font-size: 8px;
		font-family: var(--font-mono);
		cursor: pointer;
		align-self: flex-end;
	}

	.pin-filter-clear-btn:hover {
		color: #1a1a1a;
		border-color: #ccc;
	}

	.text-btn {
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.05em;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 2px;
		color: #666;
	}

	.text-btn:hover {
		color: #333;
	}

	.text-btn.danger {
		color: #dc2626;
	}

	.text-btn.danger:hover {
		color: #b91c1c;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 32px 0;
		text-align: center;
	}

	.empty-icon {
		width: 24px;
		height: 24px;
		color: #ccc;
		margin-bottom: 6px;
	}

	.empty-text {
		font-size: 10px;
		color: #999;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.card {
		padding: 4px 10px;
		border-radius: 0;
		border: none;
		border-bottom: 1px solid #f0f0f0;
		background: transparent;
		cursor: pointer;
	}

	.card:hover {
		background: #f5f5f5;
	}

	.card.selected {
		background: #f0f4ff;
		border-left: 2px solid;
	}

	.card-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.badge {
		display: flex;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		font-size: 9px;
		font-weight: 700;
		background: #fff;
		border: 1.5px solid;
	}

	.draw-badge {
		display: flex;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
	}

	.card-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.card-name {
		width: 100%;
		background: transparent;
		color: #1a1a1a;
		font-size: 10px;
		font-weight: 500;
		font-family: var(--font-mono);
		border: none;
		border-bottom: 1px solid transparent;
		border-radius: 0;
		padding: 1px 2px;
		outline: none;
	}

	.card-name:focus {
		border-bottom-color: #2563eb;
		background: #f8f9fa;
	}

	.card-meta {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 9px;
		color: #999;
		font-variant-numeric: tabular-nums;
	}

	.card-timestamp {
		font-family: var(--font-mono);
		font-size: 9px;
		color: #999;
	}

	.card-measure {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 9px;
		margin-top: 1px;
	}

	.measure-val {
		color: #22d3ee;
		font-weight: 500;
	}

	.measure-sep {
		color: #ccc;
	}

	.layer-indicator {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.card-actions {
		display: flex;
		gap: 2px;
		opacity: 0;
	}

	.card:hover .card-actions {
		opacity: 1;
	}

	.card-act {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 2px;
		background: transparent;
		border: none;
		color: #999;
		cursor: pointer;
	}

	.card-act:hover {
		color: #333;
	}

	.card-act.del:hover {
		color: #dc2626;
	}

	.card-layer-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 3px;
		margin-left: 28px;
	}

	.card-layer-label {
		font-size: 8px;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #999;
		flex-shrink: 0;
	}

	.card-layer-sel {
		flex: 1;
		padding: 2px 4px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #fff;
		color: #333;
		font-size: 10px;
		font-family: var(--font-mono);
		outline: none;
	}

	.card-layer-sel:focus {
		border-color: #2563eb;
	}

	.card-ts-row {
		display: flex;
		gap: 6px;
		margin-top: 3px;
		margin-left: 28px;
	}

	.card-ts-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.card-ts-input {
		width: 100%;
		padding: 2px 4px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #f8f9fa;
		color: #333;
		font-size: 9px;
		font-family: var(--font-mono);
		outline: none;
	}

	.card-ts-input:focus {
		border-color: #2563eb;
	}

	.stroke-row {
		display: flex;
		align-items: center;
		gap: 3px;
		margin-top: 3px;
		margin-left: 28px;
	}

	.stroke-btn {
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

	.stroke-btn:hover {
		background: #f5f5f5;
	}

	.stroke-btn.active {
		border-color: #e0e0e0;
		background: #f8f9fa;
	}

	.stroke-line {
		display: block;
		width: 12px;
		background: #666;
		border-radius: 0;
	}

	.path-opts-row {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-top: 3px;
		margin-left: 28px;
	}

	.path-opt-btn {
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 2px 6px;
		border-radius: 2px;
		border: 1px solid #ddd;
		background: transparent;
		color: #666;
		font-family: var(--font-mono);
		font-size: 9px;
		cursor: pointer;
	}

	.path-opt-btn:hover {
		color: #333;
		border-color: #e0e0e0;
	}

	.path-opt-btn.active {
		border-color: #f59e0b;
		color: #f59e0b;
	}

	.route-builder {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.route-pairs {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.route-pair-card {
		padding: 6px 8px;
		border: 1px solid #e0e0e0;
		border-radius: 2px;
		background: #fff;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.route-pair-header {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.route-color-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.route-pair-num {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #999;
		flex: 1;
	}

	.route-pair-selects {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.route-field {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.wp-index {
		font-size: 9px;
		font-weight: 700;
		width: 12px;
		text-align: center;
		flex-shrink: 0;
	}

	.seg-result {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 1px 0 1px 2px;
	}

	.seg-arrow {
		width: 12px;
		display: flex;
		justify-content: center;
		flex-shrink: 0;
	}

	.seg-stats {
		display: flex;
		gap: 6px;
		font-size: 9px;
		font-weight: 600;
	}

	.seg-stat.cyan { color: #22d3ee; }
	.seg-stat.amber { color: #f59e0b; }
	.seg-stat.muted { color: #999; font-weight: 400; }

	.route-total {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 0 0;
		margin-top: 2px;
		border-top: 1px solid #f0f0f0;
		font-size: 9px;
		font-weight: 600;
	}

	.route-total-label {
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #999;
	}

	.wp-add-sel {
		width: 100%;
		padding: 3px 6px;
		border-radius: 2px;
		border: 1px dashed #ddd;
		background: transparent;
		color: #999;
		font-size: 10px;
		font-family: var(--font-mono);
		outline: none;
		cursor: pointer;
	}

	.wp-add-sel:focus {
		border-color: #2563eb;
	}

	.wp-sel {
		flex: 1;
		padding: 3px 6px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: #fff;
		color: #1a1a1a;
		font-size: 10px;
		font-family: var(--font-mono);
		outline: none;
		min-width: 0;
	}

	.wp-sel:focus {
		border-color: #2563eb;
	}

	.wp-del {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 2px;
		background: transparent;
		border: none;
		color: #ccc;
		cursor: pointer;
		flex-shrink: 0;
	}

	.wp-del:hover {
		color: #dc2626;
	}

	.route-add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 5px;
		border-radius: 2px;
		border: 1px dashed #ddd;
		background: transparent;
		color: #999;
		font-size: 10px;
		font-family: var(--font-mono);
		cursor: pointer;
	}

	.route-add-btn:hover {
		color: #666;
		border-color: #e0e0e0;
	}

	.travel-toggle {
		display: flex;
		gap: 4px;
		margin-bottom: 6px;
	}

	.travel-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 4px 6px;
		border-radius: 2px;
		border: 1px solid #e0e0e0;
		background: transparent;
		color: #999;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.05em;
		cursor: pointer;
	}

	.travel-btn:hover {
		color: #666;
	}

	.travel-btn.active {
		color: #22d3ee;
		border-color: #22d3ee;
		background: transparent;
	}

	.draw-controls {
		margin-bottom: 6px;
	}

	.notes-toggle {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		border-radius: 2px;
		background: transparent;
		border: 1px solid #e0e0e0;
		cursor: pointer;
		width: 100%;
	}

	.notes-toggle:hover {
		background: #f5f5f5;
	}

	.notes-toggle-text {
		font-size: 10px;
		color: #666;
		font-family: var(--font-mono);
	}

</style>
