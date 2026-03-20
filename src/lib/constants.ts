// Shared constants for field limits, colors, zoom thresholds, and icon paths
export const MAX_PIN_LABEL_LENGTH = 80;
export const MAX_NOTE_TEXT_LENGTH = 200;
export const MAX_LAYER_NAME_LENGTH = 40;
export const MAX_URL_LENGTH = 32000;
export const MAX_HISTORY = 50;
export const COORDINATE_PRECISION = 1e6;
export const LABEL_MIN_ZOOM = 14;
export const DEFAULT_STROKE_WIDTH = 2;
export const STROKE_WIDTH_OPTIONS = [1, 2, 3, 4, 5];

export const LAYER_COLORS = ['#22d3ee', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#f97316', '#06b6d4', '#facc15'];
export const ROUTE_COLORS = ['#f59e0b', '#22d3ee', '#10b981', '#8b5cf6', '#ec4899', '#ef4444'];

export const LABEL_BLOCK_ZOOM = 15;

export const PIN_ICONS: Record<string, { path: string; fill?: boolean }> = {
	home: { path: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
	airport: { path: 'M12 19V5m0 0l-3 3m3-3l3 3M5 12h14', fill: true },
	restaurant: { path: 'M3 3v8h2V3M7 3v5a4 4 0 004 4v9m0-18v5a4 4 0 004-4V3m2 0v18' },
	hotel: { path: 'M3 21V7a2 2 0 012-2h14a2 2 0 012 2v14M9 9h6M9 13h6M9 17h6' },
	hospital: { path: 'M12 6v12m-6-6h12M4 3h16a1 1 0 011 1v16a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z' },
	school: { path: 'M12 3L1 9l11 6 9-4.91V17M5 13.18v4L12 21l7-3.82v-4' },
	park: { path: 'M12 22V8m-4 4a4 4 0 118 0M6 14a6 6 0 1112 0' },
	office: { path: 'M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 7h2m-2 4h2m4-4h2m-2 4h2m-4 4h2' },
	shopping: { path: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 9m12-9l2 9m-7-4h.01' },
	star: { path: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', fill: true },
	flag: { path: 'M4 21V4m0 0l8 4 8-4v11l-8 4-8-4' },
	heart: { path: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z', fill: true },
	person: { path: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
	skull: { path: 'M12 2a8 8 0 00-8 8c0 3.5 2 6 4 7v3h2v-2h4v2h2v-3c2-1 4-3.5 4-7a8 8 0 00-8-8zm-2 10a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm4 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z', fill: true },
	eye: { path: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zm11 3a3 3 0 100-6 3 3 0 000 6z' },
	camera: { path: 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a5 5 0 100-10 5 5 0 000 10z' },
	car: { path: 'M5 17a2 2 0 100-4 2 2 0 000 4zm14 0a2 2 0 100-4 2 2 0 000 4zM3 11l2-6h14l2 6M3 11v6h18v-6M3 11h18' },
	phone: { path: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z' },
	wifi: { path: 'M12 20h.01M2 8.82a15 15 0 0120 0M5 12.86a10 10 0 0114 0M8.5 16.43a5 5 0 017 0' },
	lock: { path: 'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zm-2 0V7a5 5 0 00-10 0v4' },
	alert: { path: 'M12 2L1 21h22L12 2zm0 6v6m0 2v2' },
	crosshair: { path: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 8a4 4 0 100 8 4 4 0 000-8z' },
	shield: { path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
	clock: { path: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4v6l4 2' },
	truck: { path: 'M1 3h15v13H1zm15 8h4l3 3v5h-7m-8 0a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z' },
	building: { path: 'M3 21h18M6 21V3h12v18M9 7h2m-2 4h2m4-4h2m-2 4h2M10 21v-4h4v4' },
	fire: { path: 'M12 2c1 3 5 6 5 10a5 5 0 01-10 0c0-4 4-7 5-10z', fill: true },
	money: { path: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6' }
};

export const DRAW_ICON_PATHS: Record<string, string> = {
	path: 'M3 17l6-6 4 4 8-8',
	arrow: 'M5 19L19 5M19 5H9M19 5v10',
	polygon: 'M4 6l4-4 8 4 4 4-4 8-8 4z',
	circle: 'M12 2a10 10 0 100 20 10 10 0 000-20z',
	note: 'M7 8h10M7 12h6m-6 4h8M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z',
	measure: 'M2 12h4m12 0h4M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83'
};
