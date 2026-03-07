<script lang="ts">
	// Google Places autocomplete search bar that creates pins from search results
	import { onMount } from 'svelte';
	import { pinStore } from '$lib/stores.svelte';

	interface Props {
		onFlyTo: (lat: number, lng: number) => void;
	}

	let { onFlyTo }: Props = $props();

	let inputEl: HTMLInputElement;
	let initialized = false;

	// Initializes the Google Places Autocomplete widget and wires up place selection
	function initAutocomplete() {
		if (initialized) return;
		if (typeof google === 'undefined' || !google.maps?.places?.Autocomplete) return;

		const autocomplete = new google.maps.places.Autocomplete(inputEl, {
			fields: ['name', 'formatted_address', 'geometry']
		});
		initialized = true;

		autocomplete.addListener('place_changed', () => {
			const place = autocomplete.getPlace();
			if (!place?.geometry?.location) return;

			const lat = place.geometry.location.lat();
			const lng = place.geometry.location.lng();
			pinStore.addPin(lat, lng);

			const pin = pinStore.pins[pinStore.pins.length - 1];
			const label = place.name || place.formatted_address?.split(',')[0] || pin.label;
			pinStore.updatePin(pin.id, { label });

			onFlyTo(lat, lng);
			inputEl.value = '';
		});
	}

	onMount(() => {
		initAutocomplete();
		if (!initialized) {
			const interval = setInterval(() => {
				initAutocomplete();
				if (initialized) clearInterval(interval);
			}, 500);
			return () => clearInterval(interval);
		}
	});
</script>

<div class="search-bar-container">
	<input
		bind:this={inputEl}
		type="text"
		placeholder="Search places..."
		class="search-input"
	/>
</div>

<style>
	.search-bar-container {
		position: relative;
	}

	.search-input {
		width: 100%;
		padding: 7px 10px;
		border-radius: 6px;
		border: 1px solid #1e293b;
		background: #0a0f1a;
		color: #e2e8f0;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.02em;
		outline: none;
		transition: border-color 0.12s;
	}

	.search-input:focus {
		border-color: #334155;
	}

	.search-input::placeholder {
		color: #334155;
	}

	:global(.pac-container) {
		background: #0f172a !important;
		border: 1px solid #1e293b !important;
		border-radius: 6px !important;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
		font-family: 'JetBrains Mono', monospace !important;
		margin-top: 4px !important;
		z-index: 10000 !important;
	}

	:global(.pac-item) {
		padding: 8px 10px !important;
		border-top: 1px solid #1e293b !important;
		color: #94a3b8 !important;
		font-size: 11px !important;
		cursor: pointer !important;
		line-height: 1.4 !important;
	}

	:global(.pac-item:first-child) {
		border-top: none !important;
	}

	:global(.pac-item:hover),
	:global(.pac-item-selected) {
		background: rgba(34, 211, 238, 0.06) !important;
	}

	:global(.pac-item-query) {
		color: #e2e8f0 !important;
		font-size: 11px !important;
		font-family: 'JetBrains Mono', monospace !important;
	}

	:global(.pac-matched) {
		color: #f59e0b !important;
		font-weight: 600 !important;
	}

	:global(.pac-icon) {
		display: none !important;
	}

	:global(.pac-icon-marker) {
		display: none !important;
	}

	:global(.pac-item-query + span) {
		color: #475569 !important;
		font-size: 10px !important;
		font-family: 'JetBrains Mono', monospace !important;
	}
</style>
