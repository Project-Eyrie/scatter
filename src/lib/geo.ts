// Geographic math utilities for distance, area, and duration calculations
const EARTH_RADIUS_KM = 6371;

// Converts degrees to radians
function toRad(deg: number): number {
	return (deg * Math.PI) / 180;
}

// Calculates straight-line distance between two coordinates using the haversine formula
export function haversineDistance(
	a: { lat: number; lng: number },
	b: { lat: number; lng: number }
): number {
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const sinLat = Math.sin(dLat / 2);
	const sinLng = Math.sin(dLng / 2);
	const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
	return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Formats a distance in km to a human-readable string with appropriate units
export function formatDistance(km: number): string {
	if (km < 1) return `${Math.round(km * 1000)} m`;
	return `${km.toFixed(2)} km`;
}

// Calculates the area of a polygon using the spherical excess formula
export function polygonArea(points: { lat: number; lng: number }[]): number {
	if (points.length < 3) return 0;
	let total = 0;
	for (let i = 0; i < points.length; i++) {
		const j = (i + 1) % points.length;
		total += toRad(points[j].lng - points[i].lng)
			* (2 + Math.sin(toRad(points[i].lat)) + Math.sin(toRad(points[j].lat)));
	}
	return Math.abs(total * EARTH_RADIUS_KM * EARTH_RADIUS_KM / 2);
}

// Formats an area in km² to a human-readable string with appropriate units
export function formatArea(km2: number): string {
	if (km2 < 0.01) return `${Math.round(km2 * 1e6)} m²`;
	if (km2 < 1) return `${(km2 * 1e6).toFixed(0)} m²`;
	return `${km2.toFixed(2)} km²`;
}

// Calculates the total length of a polyline or polygon perimeter in km
export function polylineLength(points: { lat: number; lng: number }[], closed: boolean = false): number {
	let total = 0;
	for (let i = 0; i < points.length - 1; i++) {
		total += haversineDistance(points[i], points[i + 1]);
	}
	if (closed && points.length > 2) {
		total += haversineDistance(points[points.length - 1], points[0]);
	}
	return total;
}

// Formats a duration in seconds to a human-readable time string
export function formatDuration(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const mins = Math.floor(seconds / 60);
	if (mins < 60) return `${mins} min`;
	const hrs = Math.floor(mins / 60);
	const remainMins = mins % 60;
	return `${hrs}h ${remainMins}m`;
}
