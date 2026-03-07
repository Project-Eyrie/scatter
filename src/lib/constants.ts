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

export const DRAW_ICON_PATHS: Record<string, string> = {
	path: 'M3 17l6-6 4 4 8-8',
	arrow: 'M5 19L19 5M19 5H9M19 5v10',
	polygon: 'M4 6l4-4 8 4 4 4-4 8-8 4z',
	circle: 'M12 2a10 10 0 100 20 10 10 0 000-20z',
	note: 'M7 8h10M7 12h6m-6 4h8M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z',
	measure: 'M2 12h4m12 0h4M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83'
};
