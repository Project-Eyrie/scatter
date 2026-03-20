<script lang="ts">
	// Bottom panel with distance matrix, street view, and properties editor for pins and drawings
	import { onDestroy, tick, untrack } from 'svelte';
	import { pinStore } from '$lib/stores.svelte';
	import { drawingStore } from '$lib/drawing-store.svelte';
	import { layerStore } from '$lib/layer-store.svelte';
	import { haversineDistance, formatDistance, polygonArea, formatArea, polylineLength } from '$lib/geo';
	import { historyStore } from '$lib/history-store.svelte';
	import { MAX_PIN_LABEL_LENGTH, STROKE_WIDTH_OPTIONS, DRAW_ICON_PATHS, PIN_ICONS } from '$lib/constants';

	interface Props {
		onFlyTo: (lat: number, lng: number) => void;
	}

	let { onFlyTo }: Props = $props();

	let activeTab = $state<'matrix' | 'streetview' | 'travel' | 'history'>('matrix');
	let streetViewEl: HTMLDivElement;
	let streetViewPanorama: google.maps.StreetViewPanorama | null = null;
	let lastStreetViewPinId: string | null = null;
	let svStatus = $state<'ok' | 'no-coverage' | 'loading'>('ok');

	let selectedPin = $derived(pinStore.pins.find((p) => p.id === pinStore.selectedPinId));
	let selectedDrawing = $derived(drawingStore.drawings.find((d) => d.id === drawingStore.selectedDrawingId));

	const CROWD_DENSITIES = [
		{ label: 'Light', value: 0.5, desc: '~2m² per person' },
		{ label: 'Moderate', value: 1.5, desc: 'shoulder to shoulder' },
		{ label: 'Dense', value: 3, desc: 'packed crowd' },
		{ label: 'Max', value: 5, desc: 'crush capacity' }
	];
	let crowdDensityIdx = $state(1);

	function getAreaKm2(drawing: NonNullable<typeof selectedDrawing>): number | null {
		if (drawing.type === 'polygon' && drawing.points.length >= 3) return polygonArea(drawing.points);
		if (drawing.type === 'circle' && drawing.radius) return Math.PI * (drawing.radius / 1000) ** 2;
		return null;
	}

	function formatCrowdCount(count: number): string {
		if (count >= 1_000_000) return `~${(count / 1_000_000).toFixed(1)}M`;
		if (count >= 1_000) return `~${(count / 1_000).toFixed(1)}K`;
		return `~${Math.round(count)}`;
	}

	// Cleans up the street view panorama and its event listeners
	function destroyPanorama() {
		if (streetViewPanorama) {
			google.maps.event.clearInstanceListeners(streetViewPanorama);
			streetViewPanorama = null;
		}
	}

	// Creates a new street view panorama at the given coordinates
	function createPanorama(lat: number, lng: number) {
		if (!streetViewEl) return;
		destroyPanorama();
		streetViewEl.innerHTML = '';
		svStatus = 'loading';
		streetViewPanorama = new google.maps.StreetViewPanorama(streetViewEl, {
			position: { lat, lng },
			pov: { heading: 0, pitch: 0 },
			zoom: 1,
			addressControl: false,
			fullscreenControl: false,
			motionTrackingControl: false
		});
		streetViewPanorama.addListener('status_changed', () => {
			const status = streetViewPanorama?.getStatus();
			if (status === google.maps.StreetViewStatus.ZERO_RESULTS) {
				svStatus = 'no-coverage';
			} else {
				svStatus = 'ok';
			}
		});
	}

	$effect(() => {
		const id = pinStore.selectedPinId;
		if (id && id !== lastStreetViewPinId) {
			const pin = untrack(() => pinStore.pins.find((p) => p.id === id));
			if (pin) {
				activeTab = 'streetview';
				lastStreetViewPinId = id;
				tick().then(() => createPanorama(pin.lat, pin.lng));
			}
		} else if (!id) {
			lastStreetViewPinId = null;
		}
	});

	// Switches to street view tab and loads panorama for the selected pin
	function switchToStreetView() {
		activeTab = 'streetview';
		const pin = selectedPin;
		if (pin && streetViewEl) {
			tick().then(() => {
				if (!streetViewEl) return;
				createPanorama(pin.lat, pin.lng);
			});
		}
	}

	onDestroy(() => {
		destroyPanorama();
	});

	// Triggers a resize event on the street view panorama
	export function invalidateStreetView() {
		if (streetViewPanorama) {
			google.maps.event.trigger(streetViewPanorama, 'resize');
		}
	}

	// Returns a color based on distance magnitude for matrix cell styling
	function distanceColor(km: number): string {
		if (km < 1) return '#10b981';
		if (km < 10) return '#22d3ee';
		if (km < 100) return '#f59e0b';
		return '#ef4444';
	}

	let travelDistance = $state(10);
	let travelSpeedMin = $state(40);
	let travelSpeedMax = $state(60);
	const WALK_SPEED_KMH = 5;

	// Formats minutes into a readable duration string
	function fmtTime(minutes: number): string {
		if (minutes < 1) return '< 1 min';
		const h = Math.floor(minutes / 60);
		const m = Math.round(minutes % 60);
		if (h === 0) return `${m} min`;
		if (m === 0) return `${h}h`;
		return `${h}h ${m}m`;
	}

	let walkTime = $derived(fmtTime((travelDistance / WALK_SPEED_KMH) * 60));
	let driveTimeMin = $derived(travelSpeedMax > 0 ? fmtTime((travelDistance / travelSpeedMax) * 60) : '-');
	let driveTimeMax = $derived(travelSpeedMin > 0 ? fmtTime((travelDistance / travelSpeedMin) * 60) : '-');
</script>

<div class="panel">
	<div class="panel-main">
		<div class="tab-bar">
			<button
				class="tab" class:active={activeTab === 'matrix'}
				onclick={() => (activeTab = 'matrix')}
			>MATRIX</button>
			<button
				class="tab" class:active={activeTab === 'streetview'}
				onclick={switchToStreetView}
			>STREET VIEW</button>
			<button
				class="tab" class:active={activeTab === 'travel'}
				onclick={() => (activeTab = 'travel')}
			>TRAVEL</button>
			<button
				class="tab" class:active={activeTab === 'history'}
				onclick={() => (activeTab = 'history')}
			>HISTORY{historyStore.undoEntries.length > 0 ? ` (${historyStore.undoEntries.length})` : ''}</button>
			{#if activeTab === 'matrix' && pinStore.pins.length >= 2}
				<span class="tab-count">{pinStore.pins.length} pins · straight-line</span>
			{/if}
			{#if activeTab === 'streetview' && selectedPin}
				<span class="tab-sub">{selectedPin.label}</span>
			{/if}
		</div>

		<div class="tab-content" class:hidden={activeTab !== 'matrix'}>
			{#if pinStore.pins.length < 2}
				<div class="panel-empty">
					<span>Place 2+ pins to generate matrix</span>
				</div>
			{:else}
				<div class="matrix-label">
						<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 20L20 4" />
						</svg>
						STRAIGHT-LINE DISTANCES
					</div>
					<div class="matrix-scroll">
					<table class="matrix">
						<thead>
							<tr>
								<th class="matrix-corner"></th>
								{#each pinStore.pins as pin, i}
									{@const pLayer = layerStore.layers.find((l) => l.id === pin.layerId)}
									<th
										class="matrix-col-head"
										class:highlight={pin.id === pinStore.selectedPinId}
										title={pin.label}
									>
										<button class="matrix-head-btn" onclick={() => { pinStore.selectedPinId = pin.id; onFlyTo(pin.lat, pin.lng); }} style="color: {pin.id === pinStore.selectedPinId ? (pLayer?.color ?? '#22d3ee') : ''};">
											<span class="head-num">{i + 1}</span>
											<span class="head-name">{pin.label}</span>
										</button>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each pinStore.pins as pinA, i}
								{@const aLayer = layerStore.layers.find((l) => l.id === pinA.layerId)}
								<tr>
									<td
										class="matrix-row-head"
										class:highlight={pinA.id === pinStore.selectedPinId}
									>
										<button class="matrix-head-btn" onclick={() => { pinStore.selectedPinId = pinA.id; onFlyTo(pinA.lat, pinA.lng); }} style="color: {pinA.id === pinStore.selectedPinId ? (aLayer?.color ?? '#22d3ee') : ''};" title={pinA.label}>
											<span class="head-num">{i + 1}</span>
											<span class="head-name">{pinA.label}</span>
										</button>
									</td>
									{#each pinStore.pins as pinB, j}
										{@const dist = i !== j ? haversineDistance(pinA, pinB) : 0}
										<td
											class="matrix-cell"
											class:diagonal={i === j}
											class:highlight-row={pinA.id === pinStore.selectedPinId}
											class:highlight-col={pinB.id === pinStore.selectedPinId}
										>
											{#if i === j}
												<span class="diag">-</span>
											{:else}
												<span class="dist-val" style="color: {distanceColor(dist)};">{formatDistance(dist)}</span>
											{/if}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<div class="tab-content sv-tab" class:hidden={activeTab !== 'streetview'}>
			{#if pinStore.selectedPinId}
				<div bind:this={streetViewEl} class="sv-content"></div>
				{#if svStatus === 'no-coverage'}
					<div class="sv-no-coverage">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
							<path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
						</svg>
						<span>No street view coverage</span>
					</div>
				{/if}
			{:else}
				<div class="panel-empty">
					<span>Select a pin to view street view</span>
				</div>
			{/if}
		</div>

		<div class="tab-content" class:hidden={activeTab !== 'history'}>
			{#if historyStore.undoEntries.length === 0 && historyStore.redoEntries.length === 0}
				<div class="panel-empty">
					<span>No history yet</span>
				</div>
			{:else}
				<div class="history-scroll">
					{#each historyStore.redoEntries.toReversed() as entry, i}
						<button
							class="history-entry redo"
							onclick={() => {
								const redoIdx = historyStore.redoEntries.length - 1 - i;
								for (let r = 0; r <= redoIdx; r++) historyStore.redo();
							}}
						>
							<span class="history-dot redo-dot"></span>
							<span class="history-desc">{entry.description}</span>
							<span class="history-time">{new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
						</button>
					{/each}
					<div class="history-current">
						<span class="history-dot current-dot"></span>
						<span class="history-desc">Current state</span>
					</div>
					{#each historyStore.undoEntries.toReversed() as entry, i}
						<button
							class="history-entry undo"
							onclick={() => {
								const targetIdx = historyStore.undoEntries.length - 1 - i;
								historyStore.jumpTo(targetIdx);
							}}
						>
							<span class="history-dot undo-dot"></span>
							<span class="history-desc">{entry.description}</span>
							<span class="history-time">{new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="tab-content" class:hidden={activeTab !== 'travel'}>
			<div class="travel-calc">
				<div class="travel-field">
					<label class="travel-lbl" for="travel-dist">DISTANCE (km)</label>
					<input
						id="travel-dist"
						type="number"
						min="0"
						step="0.1"
						bind:value={travelDistance}
						class="travel-input"
					/>
				</div>
				<div class="travel-field">
					<label class="travel-lbl">SPEED RANGE (km/h)</label>
					<div class="travel-speed-row">
						<input
							type="number"
							min="1"
							step="5"
							bind:value={travelSpeedMin}
							class="travel-input speed"
							placeholder="Min"
						/>
						<span class="travel-dash">-</span>
						<input
							type="number"
							min="1"
							step="5"
							bind:value={travelSpeedMax}
							class="travel-input speed"
							placeholder="Max"
						/>
					</div>
				</div>
				<div class="travel-sep"></div>
				<div class="travel-results">
					<div class="travel-result">
						<div class="travel-result-icon">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M13 7a2 2 0 100-4 2 2 0 000 4zM15.5 21l-3-8.5L9 15v6M9 15l3-8 4 2" />
							</svg>
						</div>
						<div class="travel-result-body">
							<span class="travel-result-label">WALKING</span>
							<span class="travel-result-sub">{WALK_SPEED_KMH} km/h avg</span>
						</div>
						<span class="travel-result-val">{walkTime}</span>
					</div>
					<div class="travel-result">
						<div class="travel-result-icon">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M8 17a2 2 0 100-4 2 2 0 000 4zM16 17a2 2 0 100-4 2 2 0 000 4zM4 11l2-5h12l2 5M4 11v6h1.5m13 0H20v-6M4 11h16" />
							</svg>
						</div>
						<div class="travel-result-body">
							<span class="travel-result-label">DRIVING</span>
							<span class="travel-result-sub">{travelSpeedMin}-{travelSpeedMax} km/h</span>
						</div>
						<span class="travel-result-val">{driveTimeMin === driveTimeMax ? driveTimeMin : `${driveTimeMin} - ${driveTimeMax}`}</span>
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="props-panel">
		{#if selectedPin}
			{@const pinLayer = layerStore.layers.find((l) => l.id === selectedPin.layerId)}
			<div class="props-header">
				<span class="props-badge" style="background: {pinLayer?.color ?? '#22d3ee'};">{pinStore.pins.indexOf(selectedPin) + 1}</span>
				<span class="props-title">PROPERTIES</span>
			</div>
			<div class="props-body">
				<div class="prop-field">
					<label class="prop-lbl" for="prop-name">NAME</label>
					<input
						id="prop-name"
						type="text"
						value={selectedPin.label}
						maxlength={MAX_PIN_LABEL_LENGTH}
						oninput={(e) => pinStore.updatePin(selectedPin.id, { label: (e.target as HTMLInputElement).value })}
						class="prop-input"
					/>
				</div>
				<div class="prop-field">
					<label class="prop-lbl" for="prop-coords">COORDS</label>
					<div class="prop-coords">
						<span class="prop-coord-val">{selectedPin.lat.toFixed(6)}, {selectedPin.lng.toFixed(6)}</span>
						<button class="prop-copy" onclick={() => navigator.clipboard.writeText(`${selectedPin.lat.toFixed(6)}, ${selectedPin.lng.toFixed(6)}`)} title="Copy">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
							</svg>
						</button>
					</div>
				</div>
				<div class="prop-field">
					<label class="prop-lbl" for="prop-layer">LAYER</label>
					<select
						id="prop-layer"
						value={selectedPin.layerId}
						onchange={(e) => pinStore.updatePin(selectedPin.id, { layerId: (e.target as HTMLSelectElement).value })}
						class="prop-select"
					>
						{#each layerStore.layers as layer}
							<option value={layer.id}>{layer.name}</option>
						{/each}
					</select>
				</div>
				<div class="prop-field">
					<label class="prop-lbl" for="prop-timestamp">TIMESTAMP</label>
					<input
						id="prop-timestamp"
						type="datetime-local"
						value={selectedPin.timestamp ? new Date(new Date(selectedPin.timestamp).getTime() - new Date(selectedPin.timestamp).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
						oninput={(e) => {
							const val = (e.target as HTMLInputElement).value;
							pinStore.updatePin(selectedPin.id, { timestamp: val ? new Date(val).toISOString() : undefined });
						}}
						class="prop-input"
					/>
				</div>
				<div class="prop-field">
					<label class="prop-lbl">ICON</label>
					<div class="icon-picker">
						{#each Object.keys(PIN_ICONS) as iconName}
							<button
								class="icon-btn"
								class:active={selectedPin.icon === iconName}
								title={iconName}
								onclick={() => pinStore.updatePin(selectedPin.id, { icon: selectedPin.icon === iconName ? undefined : iconName })}
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={PIN_ICONS[iconName].fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
									<path d={PIN_ICONS[iconName].path} />
								</svg>
							</button>
						{/each}
					</div>
				</div>
			</div>
		{:else if selectedDrawing}
			{@const drawLayer = layerStore.layers.find((l) => l.id === selectedDrawing.layerId)}
			<div class="props-header">
				<span class="props-draw-badge" style="color: {drawLayer?.color ?? '#22d3ee'};">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d={DRAW_ICON_PATHS[selectedDrawing.type] ?? ''} />
					</svg>
				</span>
				<span class="props-title">PROPERTIES</span>
			</div>
			<div class="props-body">
				<div class="prop-field">
					<label class="prop-lbl" for="prop-draw-name">NAME</label>
					<input
						id="prop-draw-name"
						type="text"
						value={selectedDrawing.label}
						maxlength={MAX_PIN_LABEL_LENGTH}
						oninput={(e) => drawingStore.updateDrawing(selectedDrawing.id, { label: (e.target as HTMLInputElement).value })}
						class="prop-input"
					/>
				</div>
				<div class="prop-field">
					<label class="prop-lbl">TYPE</label>
					<span class="prop-static">{selectedDrawing.type}</span>
				</div>
				{#if selectedDrawing.type === 'polygon' && selectedDrawing.points.length >= 3}
					<div class="prop-field">
						<label class="prop-lbl">AREA</label>
						<span class="prop-measure">{formatArea(polygonArea(selectedDrawing.points))}</span>
					</div>
					<div class="prop-field">
						<label class="prop-lbl">PERIMETER</label>
						<span class="prop-measure">{formatDistance(polylineLength(selectedDrawing.points, true))}</span>
					</div>
				{:else if selectedDrawing.type === 'circle' && selectedDrawing.radius}
					<div class="prop-field">
						<label class="prop-lbl">AREA</label>
						<span class="prop-measure">{formatArea(Math.PI * (selectedDrawing.radius / 1000) ** 2)}</span>
					</div>
					<div class="prop-field">
						<label class="prop-lbl">RADIUS</label>
						<span class="prop-measure">{formatDistance(selectedDrawing.radius / 1000)}</span>
					</div>
				{:else if (selectedDrawing.type === 'path' || selectedDrawing.type === 'arrow') && selectedDrawing.points.length >= 2}
					<div class="prop-field">
						<label class="prop-lbl">LENGTH</label>
						<span class="prop-measure">{formatDistance(polylineLength(selectedDrawing.points))}</span>
					</div>
				{/if}
				{#if getAreaKm2(selectedDrawing) !== null}
					{@const areaKm2 = getAreaKm2(selectedDrawing)!}
					{@const areaM2 = areaKm2 * 1_000_000}
					{@const density = CROWD_DENSITIES[crowdDensityIdx]}
					{@const count = areaM2 * density.value}
					<div class="prop-field crowd-field">
						<label class="prop-lbl">CROWD</label>
						<div class="crowd-row">
							<span class="prop-measure crowd-count">{formatCrowdCount(count)}</span>
							<div class="crowd-density-btns">
								{#each CROWD_DENSITIES as d, i}
									<button
										class="crowd-btn"
										class:active={crowdDensityIdx === i}
										onclick={() => crowdDensityIdx = i}
										title="{d.desc}"
									>{d.label}</button>
								{/each}
							</div>
						</div>
					</div>
				{/if}
				{#if selectedDrawing.type !== 'note'}
					<div class="prop-field">
						<label class="prop-lbl">WIDTH</label>
						<div class="prop-stroke-row">
							{#each STROKE_WIDTH_OPTIONS as w}
								<button
									class="prop-stroke-btn"
									class:active={selectedDrawing.strokeWidth === w}
									onclick={() => drawingStore.updateDrawing(selectedDrawing.id, { strokeWidth: w })}
									title="{w}px"
								>
									<span class="prop-stroke-line" style="height: {w}px;"></span>
								</button>
							{/each}
						</div>
					</div>
				{/if}
				<div class="prop-field">
					<label class="prop-lbl" for="prop-draw-layer">LAYER</label>
					<select
						id="prop-draw-layer"
						value={selectedDrawing.layerId}
						onchange={(e) => drawingStore.updateDrawing(selectedDrawing.id, { layerId: (e.target as HTMLSelectElement).value })}
						class="prop-select"
					>
						{#each layerStore.layers as layer}
							<option value={layer.id}>{layer.name}</option>
						{/each}
					</select>
				</div>
				</div>
		{:else}
			<div class="props-empty">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 props-empty-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
					<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span>Select a pin or annotation</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.panel {
		height: 100%;
		background: #0a0f1a;
		font-family: var(--font-mono);
		overflow: hidden;
		display: flex;
	}

	.panel-main {
		flex: 3;
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
	}

	.tab-bar {
		display: flex;
		align-items: center;
		border-bottom: 1px solid #1e293b;
		flex-shrink: 0;
	}

	.tab {
		padding: 6px 14px;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #475569;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		transition: color 0.12s;
	}

	.tab:hover {
		color: #94a3b8;
	}

	.tab.active {
		color: #e2e8f0;
		border-bottom-color: #f59e0b;
	}

	.tab-count {
		font-size: 9px;
		color: #334155;
		margin-left: auto;
		padding-right: 10px;
	}

	.tab-sub {
		font-size: 9px;
		color: #64748b;
		margin-left: auto;
		padding-right: 10px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 200px;
	}

	.tab-content {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.tab-content.hidden {
		display: none;
	}

	.sv-tab {
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.sv-content {
		flex: 1;
		min-height: 0;
	}

	.sv-no-coverage {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		background: rgba(10, 15, 26, 0.9);
		color: #475569;
		font-size: 11px;
	}

	.panel-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		padding: 20px;
		font-size: 10px;
		color: #334155;
	}

	.matrix-label {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px;
		font-size: 8px;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: #334155;
		border-bottom: 1px solid #111827;
		flex-shrink: 0;
	}

	.matrix-scroll {
		flex: 1;
		overflow: auto;
	}

	.matrix {
		border-collapse: collapse;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.matrix-corner {
		position: sticky;
		top: 0;
		left: 0;
		z-index: 3;
		background: #0a0f1a;
		width: 100px;
		min-width: 100px;
	}

	.matrix-col-head {
		position: sticky;
		top: 0;
		z-index: 2;
		background: #0a0f1a;
		padding: 4px 6px;
		text-align: center;
		font-weight: 700;
		color: #475569;
		white-space: nowrap;
		min-width: 70px;
	}

	.matrix-col-head.highlight {
		color: #22d3ee;
	}

	.matrix-row-head {
		position: sticky;
		left: 0;
		z-index: 1;
		background: #0a0f1a;
		padding: 4px 6px;
		text-align: left;
		font-weight: 700;
		color: #475569;
		white-space: nowrap;
		width: 100px;
		min-width: 100px;
	}

	.matrix-row-head.highlight {
		color: #22d3ee;
	}

	.matrix-head-btn {
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		padding: 2px 4px;
		display: flex;
		align-items: center;
		gap: 5px;
		width: 100%;
	}

	.matrix-head-btn:hover {
		color: #e2e8f0;
	}

	.head-num {
		font-weight: 700;
		font-size: 10px;
		flex-shrink: 0;
		width: 14px;
	}

	.head-name {
		font-size: 9px;
		font-weight: 400;
		color: #64748b;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.matrix-cell {
		padding: 6px 10px;
		text-align: center;
		white-space: nowrap;
		border-top: 1px solid #111827;
	}

	.matrix-cell.highlight-row,
	.matrix-cell.highlight-col {
		background: rgba(34, 211, 238, 0.03);
	}

	.matrix-cell.diagonal {
		color: #1e293b;
	}

	.diag {
		color: #1e293b;
	}

	.dist-val {
		font-weight: 600;
		font-size: 11px;
	}

	.props-panel {
		flex: 1;
		min-width: 0;
		border-left: 1px solid #1e293b;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
	}

	.props-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border-bottom: 1px solid #1e293b;
		flex-shrink: 0;
	}

	.props-badge {
		display: flex;
		width: 18px;
		height: 18px;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		font-size: 9px;
		font-weight: 700;
		color: #0a0f1a;
		flex-shrink: 0;
	}

	.props-draw-badge {
		display: flex;
		width: 18px;
		height: 18px;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.props-title {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #475569;
	}

	.props-body {
		padding: 6px 10px;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.prop-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.prop-lbl {
		font-size: 8px;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: #334155;
	}

	.prop-input {
		width: 100%;
		padding: 5px 7px;
		border-radius: 4px;
		border: 1px solid #334155;
		background: #0a0f1a;
		color: #e2e8f0;
		font-size: 11px;
		font-family: var(--font-mono);
		outline: none;
		transition: border-color 0.12s;
	}

	.prop-input:focus {
		border-color: #475569;
	}

	.prop-coords {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.prop-coord-val {
		font-size: 10px;
		color: #64748b;
		font-variant-numeric: tabular-nums;
	}

	.prop-copy {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 3px;
		background: transparent;
		border: none;
		color: #475569;
		cursor: pointer;
		flex-shrink: 0;
	}

	.prop-copy:hover {
		color: #94a3b8;
		background: rgba(255, 255, 255, 0.05);
	}

	.prop-static {
		font-size: 10px;
		color: #64748b;
	}

	.prop-measure {
		font-size: 11px;
		color: #22d3ee;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.crowd-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.crowd-count {
		min-width: 50px;
	}

	.crowd-density-btns {
		display: flex;
		gap: 2px;
	}

	.crowd-btn {
		padding: 1px 5px;
		font-size: 9px;
		font-family: 'JetBrains Mono', monospace;
		font-weight: 600;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 3px;
		color: #94a3b8;
		cursor: pointer;
		transition: all 0.15s;
	}

	.crowd-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: #e2e8f0;
	}

	.crowd-btn.active {
		background: rgba(34, 211, 238, 0.15);
		border-color: rgba(34, 211, 238, 0.4);
		color: #22d3ee;
	}

	.prop-stroke-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.prop-stroke-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 18px;
		border-radius: 3px;
		border: 1.5px solid transparent;
		background: transparent;
		cursor: pointer;
		transition: all 0.12s;
	}

	.prop-stroke-btn:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.prop-stroke-btn.active {
		border-color: #94a3b8;
	}

	.prop-stroke-line {
		display: block;
		width: 14px;
		background: #94a3b8;
		border-radius: 1px;
	}

	.prop-select {
		width: 100%;
		padding: 4px 6px;
		border-radius: 4px;
		border: 1px solid #1e293b;
		background: #111827;
		color: #94a3b8;
		font-size: 10px;
		font-family: var(--font-mono);
		outline: none;
	}

	.prop-select:focus {
		border-color: #334155;
	}

	.props-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		gap: 6px;
		font-size: 10px;
		color: #334155;
	}

	.props-empty-icon {
		color: #1e293b;
	}

	.travel-calc {
		padding: 10px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow-y: auto;
	}

	.travel-field {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.travel-lbl {
		font-size: 8px;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: #334155;
	}

	.travel-input {
		width: 100%;
		padding: 5px 7px;
		border-radius: 4px;
		border: 1px solid #1e293b;
		background: #111827;
		color: #e2e8f0;
		font-size: 11px;
		font-family: var(--font-mono);
		outline: none;
	}

	.travel-input:focus {
		border-color: #334155;
	}

	.travel-input.speed {
		width: 70px;
		flex-shrink: 0;
	}

	.travel-speed-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.travel-dash {
		color: #475569;
		font-size: 11px;
	}

	.travel-sep {
		height: 1px;
		background: #1e293b;
		margin: 2px 0;
	}

	.travel-results {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.travel-result {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 5px;
		background: #111827;
		border: 1px solid #1e293b;
	}

	.travel-result-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: rgba(34, 211, 238, 0.08);
		color: #22d3ee;
		flex-shrink: 0;
	}

	.travel-result-body {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1;
	}

	.travel-result-label {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: #e2e8f0;
	}

	.travel-result-sub {
		font-size: 8px;
		color: #475569;
	}

	.travel-result-val {
		font-size: 12px;
		font-weight: 700;
		color: #22d3ee;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.history-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 4px 0;
	}

	.history-entry {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 5px 12px;
		background: none;
		border: none;
		font-family: var(--font-mono);
		cursor: pointer;
		transition: background 0.1s;
		text-align: left;
	}

	.history-entry:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	.history-current {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 12px;
		border-top: 1px solid #1e293b;
		border-bottom: 1px solid #1e293b;
		background: rgba(34, 211, 238, 0.04);
	}

	.history-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.undo-dot {
		background: #475569;
	}

	.redo-dot {
		background: rgba(245, 158, 11, 0.5);
	}

	.current-dot {
		background: #22d3ee;
	}

	.history-desc {
		flex: 1;
		font-size: 10px;
		color: #94a3b8;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history-current .history-desc {
		color: #22d3ee;
		font-weight: 600;
	}

	.history-entry.redo .history-desc {
		color: #64748b;
		font-style: italic;
	}

	.history-time {
		font-size: 8px;
		color: #334155;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}

	.icon-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 3px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(255, 255, 255, 0.05);
		color: #94a3b8;
		cursor: pointer;
		transition: all 0.15s;
	}

	.icon-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: #e2e8f0;
	}

	.icon-btn.active {
		background: rgba(34, 211, 238, 0.15);
		border-color: rgba(34, 211, 238, 0.4);
		color: #22d3ee;
	}
</style>
