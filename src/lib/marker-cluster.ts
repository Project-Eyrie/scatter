// Simple grid-based marker clustering with stats popup using CustomMarker
import { CustomMarker } from './custom-marker';

export interface MarkerMeta {
	layerColor: string;
	layerName: string;
	timestamp?: string;
}

export class SimpleClusterer {
	private map: google.maps.Map;
	private managedMarkers: Set<CustomMarker> = new Set();
	private clusterBadges: CustomMarker[] = [];
	private gridSize: number;
	private maxZoom: number;
	private idleListener: google.maps.MapsEventListener;
	private reclusterScheduled = false;
	private markerMeta: Map<CustomMarker, MarkerMeta> = new Map();
	private activePopup: HTMLElement | null = null;

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
		this.markerMeta.delete(marker);
		marker.setMap(null);
		this.scheduleRecluster();
	}

	// Stores metadata for a marker to display in cluster popups
	setMarkerMeta(marker: CustomMarker, meta: MarkerMeta) {
		this.markerMeta.set(marker, meta);
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
		this.markerMeta.clear();
		this.clearBadges();
	}

	// Clears all markers and removes the idle event listener
	destroy() {
		this.clearMarkers();
		this.dismissPopup();
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

	// Dismisses the active cluster stats popup
	private dismissPopup() {
		if (this.activePopup) {
			this.activePopup.remove();
			this.activePopup = null;
		}
	}

	// Builds a stats popup element for a cluster group
	private buildPopup(group: CustomMarker[], avgLat: number, avgLng: number): HTMLElement {
		const layerCounts = new Map<string, { color: string; name: string; count: number }>();
		let minTs = Infinity;
		let maxTs = -Infinity;
		let hasTimestamps = false;

		for (const m of group) {
			const meta = this.markerMeta.get(m);
			if (meta) {
				const key = meta.layerName;
				const existing = layerCounts.get(key);
				if (existing) {
					existing.count++;
				} else {
					layerCounts.set(key, { color: meta.layerColor, name: meta.layerName, count: 1 });
				}
				if (meta.timestamp) {
					const t = new Date(meta.timestamp).getTime();
					if (!isNaN(t)) {
						hasTimestamps = true;
						if (t < minTs) minTs = t;
						if (t > maxTs) maxTs = t;
					}
				}
			}
		}

		const popup = document.createElement('div');
		popup.style.cssText = `
			position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
			margin-bottom: 8px; padding: 8px 10px; border-radius: 2px;
			background: rgba(255,255,255,0.95);
			border: 1px solid #e0e0e0; min-width: 120px; z-index: 50;
			font-family: 'JetBrains Mono', monospace;
			box-shadow: 0 1px 4px rgba(0,0,0,0.1);
		`;

		const header = document.createElement('div');
		header.style.cssText = 'color: #1a1a1a; font-size: 11px; font-weight: 700; margin-bottom: 6px;';
		header.textContent = `${group.length} pins`;
		popup.appendChild(header);

		for (const entry of layerCounts.values()) {
			const row = document.createElement('div');
			row.style.cssText = 'display: flex; align-items: center; gap: 5px; margin-bottom: 2px;';
			const dot = document.createElement('span');
			dot.style.cssText = `width: 6px; height: 6px; border-radius: 50%; background: ${entry.color}; flex-shrink: 0;`;
			row.appendChild(dot);
			const name = document.createElement('span');
			name.style.cssText = 'color: #666; font-size: 9px; flex: 1;';
			name.textContent = entry.name;
			row.appendChild(name);
			const count = document.createElement('span');
			count.style.cssText = 'color: #999; font-size: 9px;';
			count.textContent = `${entry.count}`;
			row.appendChild(count);
			popup.appendChild(row);
		}

		if (hasTimestamps && minTs !== Infinity) {
			const timeRow = document.createElement('div');
			timeRow.style.cssText = 'color: #999; font-size: 8px; margin-top: 4px; border-top: 1px solid #e0e0e0; padding-top: 4px;';
			const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
			timeRow.textContent = minTs === maxTs ? fmt(minTs) : `${fmt(minTs)} — ${fmt(maxTs)}`;
			popup.appendChild(timeRow);
		}

		const zoomBtn = document.createElement('button');
		zoomBtn.style.cssText = `
			display: block; width: 100%; margin-top: 6px; padding: 3px;
			border-radius: 2px; border: 1px solid #e0e0e0;
			background: #f8f9fa; color: #2563eb;
			font-family: 'JetBrains Mono', monospace; font-size: 9px;
			font-weight: 600; cursor: pointer; text-align: center;
		`;
		zoomBtn.textContent = 'Zoom in';
		zoomBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.dismissPopup();
			const currentZoom = this.map.getZoom() ?? 3;
			this.map.setZoom(currentZoom + 2);
			this.map.panTo({ lat: avgLat, lng: avgLng });
		});
		popup.appendChild(zoomBtn);

		return popup;
	}

	// Groups nearby markers into grid cells and replaces clusters with count badges
	private recluster() {
		this.clearBadges();
		this.dismissPopup();
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

				const wrapper = document.createElement('div');
				wrapper.style.cssText = 'position: relative; display: flex; flex-direction: column; align-items: center;';

				const el = document.createElement('div');
				el.style.cssText = `
					width: 36px; height: 36px; border-radius: 50%;
					background: rgba(34, 211, 238, 0.08); border: 2px solid rgba(34, 211, 238, 0.5);
					display: flex; align-items: center; justify-content: center;
					font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
					color: #22d3ee; cursor: pointer;
				`;
				el.textContent = `${group.length}`;
				wrapper.appendChild(el);

				const badge = new CustomMarker({
					position: { lat: avgLat, lng: avgLng },
					content: wrapper,
					map: this.map,
					clickable: true
				});
				badge.addEventListener('click', () => {
					this.dismissPopup();
					const popup = this.buildPopup(group, avgLat, avgLng);
					wrapper.insertBefore(popup, el);
					this.activePopup = popup;
					const dismiss = (e: MouseEvent) => {
						if (!popup.contains(e.target as Node)) {
							this.dismissPopup();
							document.removeEventListener('click', dismiss);
						}
					};
					setTimeout(() => document.addEventListener('click', dismiss), 0);
				});
				this.clusterBadges.push(badge);
			}
		}
	}
}
