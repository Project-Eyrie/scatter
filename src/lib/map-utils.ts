// DOM element factories for Google Maps markers, labels, and notes
import type { Drawing } from './types';
import { PIN_ICONS } from './constants';

// Injects the timeline glow keyframes once into the document
let glowStyleInjected = false;
function ensureGlowStyle() {
	if (glowStyleInjected || typeof document === 'undefined') return;
	const style = document.createElement('style');
	style.textContent = `
		@keyframes timeline-glow {
			0% { filter: brightness(1); }
			100% { filter: brightness(1.3); }
		}
		@keyframes pin-fade-in {
			0% { opacity: 0; transform: scale(0.5); }
			100% { opacity: 1; transform: scale(1); }
		}
	`;
	document.head.appendChild(style);
	glowStyleInjected = true;
}

// Lightens a hex color by blending 45% toward white
function brightenColor(hex: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	const br = Math.min(255, r + Math.round((255 - r) * 0.45));
	const bg = Math.min(255, g + Math.round((255 - g) * 0.45));
	const bb = Math.min(255, b + Math.round((255 - b) * 0.45));
	return `#${br.toString(16).padStart(2, '0')}${bg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
}

// Creates a pin marker with number badge, label tooltip, and teardrop pointer
export function createMarkerContent(index: number, selected: boolean, layerColor: string, label?: string, showLabel = false, labelOffset?: { x: number; y: number }, hideLabel = false, timestamp?: string, timeHighlight = false, fadeIn = false, icon?: string): HTMLElement {
	if (timeHighlight || fadeIn) ensureGlowStyle();
	const color = selected ? brightenColor(layerColor) : layerColor;
	const wrapper = document.createElement('div');
	wrapper.style.cssText = `
		display: flex; flex-direction: column; align-items: center;
		cursor: pointer; position: relative;
		${fadeIn ? 'animation: pin-fade-in 0.4s ease-out;' : ''}
	`;

	const badge = document.createElement('div');
	const glowShadow = timeHighlight
		? `box-shadow: 0 0 0 4px ${layerColor}55, 0 0 12px 2px ${layerColor}44, 0 2px 6px rgba(0,0,0,0.25); animation: timeline-glow 1.2s ease-in-out infinite alternate;`
		: selected
			? `box-shadow: 0 0 0 3px ${color}44, 0 2px 6px rgba(0,0,0,0.25);`
			: `box-shadow: 0 2px 6px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.08);`;
	badge.style.cssText = `
		width: 28px; height: 28px; border-radius: 50%;
		background: ${color}; border: 2px solid #fff;
		display: flex; align-items: center; justify-content: center;
		font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700;
		color: #fff;
		${glowShadow}
		transition: all 0.15s;
		position: relative;
		z-index: ${timeHighlight ? 10 : 2};
	`;
	const iconDef = icon ? PIN_ICONS[icon] : undefined;
	if (iconDef) {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('width', '16');
		svg.setAttribute('height', '16');
		svg.setAttribute('fill', iconDef.fill ? '#fff' : 'none');
		svg.setAttribute('stroke', '#fff');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		pathEl.setAttribute('d', iconDef.path);
		svg.appendChild(pathEl);
		badge.appendChild(svg);
	} else {
		badge.textContent = `${index + 1}`;
	}
	wrapper.appendChild(badge);

	const pointer = document.createElement('div');
	pointer.style.cssText = `
		width: 2px; height: 8px; background: ${color};
		border-radius: 0 0 1px 1px; margin-top: -1px;
		box-shadow: 0 2px 4px rgba(0,0,0,0.08);
		z-index: 1;
	`;
	wrapper.appendChild(pointer);

	if (label && (selected || showLabel) && !hideLabel) {
		const ox = labelOffset?.x ?? 0;
		const oy = labelOffset?.y ?? 0;
		const tooltipTop = timestamp ? -36 + oy : -26 + oy;
		const tooltip = document.createElement('div');
		tooltip.style.cssText = `
			position: absolute; top: ${tooltipTop}px; left: 50%; transform: translateX(calc(-50% + ${ox}px));
			padding: 3px 8px; border-radius: 2px;
			background: rgba(255,255,255,0.95);
			border: 1px solid ${color}66;
			font-family: 'JetBrains Mono', monospace;
			white-space: nowrap;
			max-width: 180px; overflow: hidden;
			pointer-events: none;
			box-shadow: 0 1px 4px rgba(0,0,0,0.1);
			display: flex; flex-direction: column; align-items: center;
		`;
		const labelEl = document.createElement('div');
		labelEl.style.cssText = `
			color: #1a1a1a; font-size: 9px; font-weight: 600;
			overflow: hidden; text-overflow: ellipsis; max-width: 100%;
		`;
		labelEl.textContent = label;
		tooltip.appendChild(labelEl);
		if (timestamp) {
			const tsEl = document.createElement('div');
			tsEl.style.cssText = `
				color: #999; font-size: 8px; font-weight: 400;
				margin-top: 1px;
			`;
			tsEl.textContent = timestamp;
			tooltip.appendChild(tsEl);
		}
		wrapper.appendChild(tooltip);
	}

	return wrapper;
}

// Creates a temporary search result marker with a label, dot, and pointer
export function createSearchMarkerContent(name: string): HTMLElement {
	const wrapper = document.createElement('div');
	wrapper.style.cssText = `
		display: flex; flex-direction: column; align-items: center;
		cursor: pointer;
	`;

	const label = document.createElement('div');
	label.style.cssText = `
		margin-bottom: 2px; padding: 1px 5px; border-radius: 2px;
		background: rgba(255,255,255,0.95);
		border: 1px solid rgba(34, 211, 238, 0.3);
		color: #333; font-family: 'JetBrains Mono', monospace;
		font-size: 8px; white-space: nowrap;
		max-width: 120px; overflow: hidden; text-overflow: ellipsis;
		box-shadow: 0 1px 4px rgba(0,0,0,0.1);
	`;
	label.textContent = name;
	wrapper.appendChild(label);

	const dot = document.createElement('div');
	dot.style.cssText = `
		width: 14px; height: 14px; border-radius: 50%;
		background: rgba(34, 211, 238, 0.15); border: 2px solid rgba(34, 211, 238, 0.7);
	`;
	wrapper.appendChild(dot);

	const pointer = document.createElement('div');
	pointer.style.cssText = `
		width: 2px; height: 4px; background: rgba(34, 211, 238, 0.5);
		border-radius: 0 0 1px 1px; margin-top: -1px;
	`;
	wrapper.appendChild(pointer);

	return wrapper;
}

// Creates a compact note icon (!) that expands to show text when selected
export function createNoteContent(text: string, color: string, selected: boolean): HTMLElement {
	const wrapper = document.createElement('div');
	wrapper.style.cssText = `
		position: relative;
		display: flex; flex-direction: column; align-items: center;
		cursor: grab;
	`;

	if (selected) {
		const popup = document.createElement('div');
		popup.style.cssText = `
			position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 8px;
			display: flex; flex-direction: column; align-items: center;
			min-width: max-content;
			pointer-events: none;
		`;

		const textBox = document.createElement('div');
		textBox.style.cssText = `
			padding: 6px 10px; border-radius: 2px; max-width: 200px;
			background: rgba(255,255,255,0.95);
			border: 1.5px solid ${color};
			border-top: 2px solid ${color};
			color: #1a1a1a; font-family: 'JetBrains Mono', monospace;
			font-size: 11px; line-height: 1.4;
			box-shadow: 0 1px 4px rgba(0,0,0,0.1);
			white-space: pre-wrap; word-break: break-word;
		`;
		textBox.textContent = text;
		popup.appendChild(textBox);

		const triangle = document.createElement('div');
		triangle.style.cssText = `
			width: 0; height: 0;
			border-left: 5px solid transparent;
			border-right: 5px solid transparent;
			border-top: 5px solid ${color};
			margin-top: -1px;
		`;
		popup.appendChild(triangle);

		wrapper.appendChild(popup);
	}

	const icon = document.createElement('div');
	icon.style.cssText = `
		width: 24px; height: 24px; border-radius: 50%;
		background: ${color}; border: 2px solid rgba(255, 255, 255, 0.8);
		display: flex; align-items: center; justify-content: center;
		color: #fff; font-family: 'JetBrains Mono', monospace;
		font-size: 14px; font-weight: 700; line-height: 1;
		box-shadow: 0 1px 4px rgba(0,0,0,0.12);
	`;
	icon.textContent = '!';
	wrapper.appendChild(icon);

	return wrapper;
}

// Creates a styled label element for drawing shapes with pointer anchor
export function createDrawingLabelContent(label: string, color: string): HTMLElement {
	const wrapper = document.createElement('div');
	wrapper.style.cssText = `
		display: flex; flex-direction: column; align-items: center;
		pointer-events: auto; cursor: pointer;
	`;

	const el = document.createElement('div');
	el.style.cssText = `
		padding: 2px 6px; border-radius: 2px;
		background: rgba(255,255,255,0.95);
		border: 1px solid ${color}66;
		color: ${color}; font-family: 'JetBrains Mono', monospace;
		font-size: 9px; font-weight: 600; white-space: nowrap;
		box-shadow: 0 1px 4px rgba(0,0,0,0.1);
	`;
	el.textContent = label;
	wrapper.appendChild(el);

	const pointer = document.createElement('div');
	pointer.style.cssText = `
		width: 2px; height: 4px; background: ${color}66;
		border-radius: 0 0 1px 1px; margin-top: -1px;
	`;
	wrapper.appendChild(pointer);
	return wrapper;
}

// Computes the distance between two lat/lng points using a fast approximation
function segmentLength(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
	const dlat = b.lat - a.lat;
	const dlng = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
	return Math.sqrt(dlat * dlat + dlng * dlng);
}

// Computes the geometric center position for placing a label on a drawing
export function getDrawingLabelPosition(drawing: Drawing): { lat: number; lng: number } | null {
	if (drawing.type === 'circle' && drawing.points.length > 0) {
		return { lat: drawing.points[0].lat, lng: drawing.points[0].lng };
	}
	if (drawing.type === 'polygon' && drawing.points.length >= 3) {
		const lat = drawing.points.reduce((s, p) => s + p.lat, 0) / drawing.points.length;
		const lng = drawing.points.reduce((s, p) => s + p.lng, 0) / drawing.points.length;
		return { lat, lng };
	}
	if ((drawing.type === 'path' || drawing.type === 'arrow') && drawing.points.length >= 2) {
		const pts = drawing.points;
		const segLengths: number[] = [];
		let totalLength = 0;
		for (let i = 1; i < pts.length; i++) {
			const len = segmentLength(pts[i - 1], pts[i]);
			segLengths.push(len);
			totalLength += len;
		}
		const halfDist = totalLength / 2;
		let accumulated = 0;
		for (let i = 0; i < segLengths.length; i++) {
			if (accumulated + segLengths[i] >= halfDist) {
				const remaining = halfDist - accumulated;
				const t = segLengths[i] > 0 ? remaining / segLengths[i] : 0;
				return {
					lat: pts[i].lat + t * (pts[i + 1].lat - pts[i].lat),
					lng: pts[i].lng + t * (pts[i + 1].lng - pts[i].lng)
				};
			}
			accumulated += segLengths[i];
		}
		return { lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lng };
	}
	return null;
}

// Converts latitude to Mercator Y pixel coordinate
function latToMercatorY(lat: number, zoom: number): number {
	const latRad = lat * Math.PI / 180;
	return -(256 * Math.pow(2, zoom)) / (2 * Math.PI) * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
}

// Converts Mercator Y pixel coordinate back to latitude
function mercatorYToLat(y: number, zoom: number): number {
	const scale = (256 * Math.pow(2, zoom)) / (2 * Math.PI);
	return (2 * Math.atan(Math.exp(-y / scale)) - Math.PI / 2) * 180 / Math.PI;
}

// Resolves overlapping positions by nudging them apart in pixel space
export function resolveOverlaps(
	items: Array<{ lat: number; lng: number; width: number; height: number; isAnchored?: boolean }>,
	zoom: number
): Array<{ lat: number; lng: number }> {
	const lngScale = Math.pow(2, zoom) * 256 / 360;
	const MIN_GAP = 4;
	const positions = items.map((item) => ({
		px: item.lng * lngScale,
		py: latToMercatorY(item.lat, zoom),
		w: item.width,
		h: item.height,
		isAnchored: item.isAnchored ?? false
	}));

	for (let iter = 0; iter < 5; iter++) {
		for (let i = 0; i < positions.length; i++) {
			for (let j = i + 1; j < positions.length; j++) {
				const a = positions[i];
				const b = positions[j];

				const overlapX = (a.w + b.w) / 2 + MIN_GAP - Math.abs(a.px - b.px);
				const overlapY = (a.h + b.h) / 2 + MIN_GAP - Math.abs(a.py - b.py);

				if (overlapX > 0 && overlapY > 0) {
					const pushX = overlapX < overlapY;
					const nudge = (pushX ? overlapX : overlapY) / 2 + 2;

					if (pushX) {
						const dir = a.px <= b.px ? -1 : 1;
						if (!a.isAnchored) a.px += dir * nudge;
						if (!b.isAnchored) b.px -= dir * nudge;
						if (a.isAnchored) b.px -= dir * nudge * 2;
						if (b.isAnchored) a.px += dir * nudge * 2;
					} else {
						const dir = a.py <= b.py ? -1 : 1;
						if (!a.isAnchored) a.py += dir * nudge;
						if (!b.isAnchored) b.py -= dir * nudge;
						if (a.isAnchored) b.py -= dir * nudge * 2;
						if (b.isAnchored) a.py += dir * nudge * 2;
					}
				}
			}
		}
	}

	return positions.map((p) => ({
		lng: p.px / lngScale,
		lat: mercatorYToLat(p.py, zoom)
	}));
}

// Computes pixel offsets for pin labels to avoid overlapping each other
export function computePinLabelOffsets(
	pins: Array<{ lat: number; lng: number; hasLabel: boolean }>,
	zoom: number
): Array<{ x: number; y: number }> {
	const LABEL_W = 80;
	const LABEL_H = 18;
	const LABEL_Y_OFFSET = -26;
	const MIN_GAP = 4;
	const lngScale = Math.pow(2, zoom) * 256 / 360;

	const offsets = pins.map(() => ({ x: 0, y: 0 }));
	if (pins.length < 2) return offsets;

	const labelPositions = pins.map((pin) => ({
		px: pin.lng * lngScale,
		py: latToMercatorY(pin.lat, zoom) + LABEL_Y_OFFSET - LABEL_H / 2,
		hasLabel: pin.hasLabel
	}));

	const labelIndices = labelPositions
		.map((lp, i) => (lp.hasLabel ? i : -1))
		.filter((i) => i >= 0);

	if (labelIndices.length < 2) return offsets;

	const pxOffsets = labelIndices.map(() => ({ dx: 0, dy: 0 }));

	for (let iter = 0; iter < 5; iter++) {
		for (let ii = 0; ii < labelIndices.length; ii++) {
			for (let jj = ii + 1; jj < labelIndices.length; jj++) {
				const a = labelPositions[labelIndices[ii]];
				const b = labelPositions[labelIndices[jj]];
				const ax = a.px + pxOffsets[ii].dx;
				const ay = a.py + pxOffsets[ii].dy;
				const bx = b.px + pxOffsets[jj].dx;
				const by = b.py + pxOffsets[jj].dy;

				const overlapX = LABEL_W + MIN_GAP - Math.abs(ax - bx);
				const overlapY = LABEL_H + MIN_GAP - Math.abs(ay - by);

				if (overlapX > 0 && overlapY > 0) {
					const pushX = overlapX < overlapY;
					const nudge = (pushX ? overlapX : overlapY) / 2 + 2;

					if (pushX) {
						const dir = ax <= bx ? -1 : 1;
						pxOffsets[ii].dx += dir * nudge;
						pxOffsets[jj].dx -= dir * nudge;
					} else {
						const dir = ay <= by ? -1 : 1;
						pxOffsets[ii].dy += dir * nudge;
						pxOffsets[jj].dy -= dir * nudge;
					}
				}
			}
		}
	}

	for (let ii = 0; ii < labelIndices.length; ii++) {
		offsets[labelIndices[ii]] = { x: pxOffsets[ii].dx, y: pxOffsets[ii].dy };
	}

	return offsets;
}
