// Simple grid-based marker clustering using CustomMarker without mapId dependency

import { CustomMarker } from './custom-marker';

export class SimpleClusterer {
	private map: google.maps.Map;
	private managedMarkers: Set<CustomMarker> = new Set();
	private clusterBadges: CustomMarker[] = [];
	private gridSize: number;
	private maxZoom: number;
	private idleListener: google.maps.MapsEventListener;
	private reclusterScheduled = false;

	// Binds to a map and listens for idle events to trigger reclustering
	constructor(map: google.maps.Map, gridSize = 60, maxZoom = 14) {
		this.map = map;
		this.gridSize = gridSize;
		this.maxZoom = maxZoom;
		this.idleListener = map.addListener('idle', () => this.recluster());
	}

	// Updates the max zoom for clustering and retriggers
	setMaxZoom(zoom: number) {
		this.maxZoom = zoom;
		this.recluster();
	}

	// Adds a marker to the managed set and triggers reclustering
	addMarker(marker: CustomMarker) {
		this.managedMarkers.add(marker);
		this.scheduleRecluster();
	}

	// Removes a marker from the managed set and the map
	removeMarker(marker: CustomMarker) {
		this.managedMarkers.delete(marker);
		marker.setMap(null);
		this.scheduleRecluster();
	}

	// Checks whether a marker is currently managed by this clusterer
	hasMarker(marker: CustomMarker): boolean {
		return this.managedMarkers.has(marker);
	}

	// Removes all markers from the map and clears the managed set
	clearMarkers() {
		for (const marker of this.managedMarkers) {
			marker.setMap(null);
		}
		this.managedMarkers.clear();
		this.clearBadges();
	}

	// Clears all markers and removes the idle event listener
	destroy() {
		this.clearMarkers();
		google.maps.event.removeListener(this.idleListener);
	}

	// Batches recluster calls to the next animation frame
	private scheduleRecluster() {
		if (this.reclusterScheduled) return;
		this.reclusterScheduled = true;
		requestAnimationFrame(() => {
			this.reclusterScheduled = false;
			this.recluster();
		});
	}

	// Removes all cluster badge markers from the map
	private clearBadges() {
		for (const badge of this.clusterBadges) {
			badge.setMap(null);
		}
		this.clusterBadges = [];
	}

	// Groups nearby markers into grid cells and replaces clusters with count badges
	private recluster() {
		this.clearBadges();
		if (this.managedMarkers.size === 0) return;

		const zoom = this.map.getZoom() ?? 3;

		if (zoom > this.maxZoom) {
			for (const marker of this.managedMarkers) {
				if (!marker.getMap()) marker.setMap(this.map);
			}
			return;
		}

		const cellSize = (360 / Math.pow(2, zoom)) * (this.gridSize / 256);

		const grid = new Map<string, CustomMarker[]>();
		for (const marker of this.managedMarkers) {
			const pos = marker.position;
			const key = `${Math.floor(pos.lng / cellSize)},${Math.floor(pos.lat / cellSize)}`;
			let group = grid.get(key);
			if (!group) {
				group = [];
				grid.set(key, group);
			}
			group.push(marker);
		}

		for (const group of grid.values()) {
			if (group.length === 1) {
				if (!group[0].getMap()) group[0].setMap(this.map);
			} else {
				let avgLat = 0;
				let avgLng = 0;
				for (const m of group) {
					m.setMap(null);
					avgLat += m.position.lat;
					avgLng += m.position.lng;
				}
				avgLat /= group.length;
				avgLng /= group.length;

				const el = document.createElement('div');
				el.style.cssText = `
					width: 36px; height: 36px; border-radius: 50%;
					background: rgba(34, 211, 238, 0.15); border: 2px solid rgba(34, 211, 238, 0.5);
					display: flex; align-items: center; justify-content: center;
					font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
					color: #22d3ee; cursor: pointer;
					backdrop-filter: blur(4px);
				`;
				el.textContent = `${group.length}`;

				const badge = new CustomMarker({
					position: { lat: avgLat, lng: avgLng },
					content: el,
					map: this.map,
					clickable: true
				});
				badge.addEventListener('click', () => {
					const currentZoom = this.map.getZoom() ?? 3;
					this.map.setZoom(currentZoom + 2);
					this.map.panTo({ lat: avgLat, lng: avgLng });
				});
				this.clusterBadges.push(badge);
			}
		}
	}
}
