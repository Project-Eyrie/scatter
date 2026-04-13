<script lang="ts">
	// Bottom panel with distance matrix, street view, and properties editor for pins and drawings
	import { onDestroy, tick, untrack } from 'svelte';
	import { pinStore } from '$lib/stores.svelte';
	import { layerStore } from '$lib/layer-store.svelte';
	import { haversineDistance, formatDistance } from '$lib/geo';


	interface Props {
		onFlyTo: (lat: number, lng: number) => void;
	}

	let { onFlyTo }: Props = $props();

	let activeTab = $state<'matrix' | 'streetview' | 'travel'>('matrix');
	let streetViewEl: HTMLDivElement;
	let streetViewPanorama: google.maps.StreetViewPanorama | null = null;
	let lastStreetViewPinId: string | null = null;
	let svStatus = $state<'ok' | 'no-coverage' | 'loading'>('ok');

	let selectedPin = $derived(pinStore.pins.find((p) => p.id === pinStore.selectedPinId));

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


</div>

<style>
	.panel {
		height: 100%;
		background: #fff;
		font-family: var(--font-mono);
		overflow: hidden;
		display: flex;
	}

	.panel-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
	}

	.tab-bar {
		display: flex;
		align-items: center;
		border-bottom: 1px solid #e0e0e0;
		flex-shrink: 0;
	}

	.tab {
		padding: 6px 10px;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #999;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		transition: color 0.1s;
	}

	.tab:hover {
		color: #666;
	}

	.tab.active {
		color: #1a1a1a;
		border-bottom-color: #2563eb;
	}

	.tab-count {
		font-size: 9px;
		color: #ccc;
		margin-left: auto;
		padding-right: 10px;
	}

	.tab-sub {
		font-size: 9px;
		color: #666;
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
		background: rgba(255, 255, 255, 0.92);
		color: #999;
		font-size: 10px;
	}

	.panel-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		padding: 20px;
		font-size: 10px;
		color: #ccc;
	}

	.matrix-label {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px;
		font-size: 8px;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: #ccc;
		border-bottom: 1px solid #f0f0f0;
		flex-shrink: 0;
	}

	.matrix-scroll {
		flex: 1;
		overflow: auto;
	}

	.matrix {
		border-collapse: collapse;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.matrix-corner {
		position: sticky;
		top: 0;
		left: 0;
		z-index: 3;
		background: #f8f9fa;
		width: 100px;
		min-width: 100px;
	}

	.matrix-col-head {
		position: sticky;
		top: 0;
		z-index: 2;
		background: #f8f9fa;
		padding: 4px 6px;
		text-align: center;
		font-size: 9px;
		font-weight: 600;
		color: #999;
		white-space: nowrap;
		min-width: 70px;
	}

	.matrix-col-head.highlight {
		background: #f0f4ff;
		color: #333;
	}

	.matrix-row-head {
		position: sticky;
		left: 0;
		z-index: 1;
		background: #f8f9fa;
		padding: 4px 6px;
		text-align: left;
		font-size: 9px;
		font-weight: 600;
		color: #999;
		white-space: nowrap;
		width: 100px;
		min-width: 100px;
	}

	.matrix-row-head.highlight {
		background: #f0f4ff;
		color: #333;
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
		color: #1a1a1a;
	}

	.head-num {
		font-weight: 600;
		font-size: 9px;
		flex-shrink: 0;
		width: 14px;
		color: #333;
	}

	.head-name {
		font-size: 9px;
		font-weight: 400;
		color: #666;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.matrix-cell {
		padding: 5px 8px;
		text-align: center;
		white-space: nowrap;
		border-top: 1px solid #f0f0f0;
	}

	.matrix-cell.highlight-row,
	.matrix-cell.highlight-col {
		background: #f0f4ff;
	}

	.matrix-cell.diagonal {
		color: #ddd;
	}

	.diag {
		color: #ddd;
	}

	.dist-val {
		font-weight: 600;
		font-size: 10px;
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
		gap: 2px;
	}

	.travel-lbl {
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: #999;
		text-transform: uppercase;
	}

	.travel-input {
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

	.travel-input:focus {
		border-color: #2563eb;
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
		color: #999;
		font-size: 10px;
	}

	.travel-sep {
		height: 1px;
		background: #e0e0e0;
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
		border-radius: 0;
		background: #f8f9fa;
		border: 1px solid #e0e0e0;
	}

	.travel-result-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 2px;
		background: #f0f4ff;
		color: #2563eb;
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
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #1a1a1a;
	}

	.travel-result-sub {
		font-size: 8px;
		color: #999;
	}

	.travel-result-val {
		font-size: 11px;
		font-weight: 700;
		color: #1a1a1a;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		flex-shrink: 0;
	}

</style>
