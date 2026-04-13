// TypeScript interfaces and type definitions for pins, drawings, layers, and routes
export interface Pin {
	id: string;
	lat: number;
	lng: number;
	label: string;
	layerId: string;
	timestamp?: string;
	icon?: string;
	azimuth?: number;
	radius?: number;
	altitude?: number;
	speed?: number;
	notes?: string;
}

export interface RouteInfo {
	distance: number;
	duration: number;
	distanceText: string;
	durationText: string;
}

export interface RoutePair {
	id: string;
	waypointIds: string[];
}

export interface DrawingPoint {
	lat: number;
	lng: number;
}

export type DrawingType = 'path' | 'polygon' | 'circle' | 'arrow' | 'note';
export type DrawingMode = 'none' | DrawingType | 'measure';

export interface Drawing {
	id: string;
	type: DrawingType;
	points: DrawingPoint[];
	radius?: number;
	color: string;
	strokeWidth: number;
	label: string;
	layerId: string;
	text?: string;
	animated?: boolean;
	reversed?: boolean;
	timestamp?: string;
	endTimestamp?: string;
	waypointPinIds?: string[];
}

export interface Layer {
	id: string;
	name: string;
	visible: boolean;
	color: string;
}

export type TravelMode = 'DRIVING' | 'WALKING';

export interface NearbyResult {
	id: string;
	name: string;
	lat: number;
	lng: number;
	address: string;
	rating?: number;
	isOpen?: boolean;
}
