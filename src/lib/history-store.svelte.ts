// Undo/redo history tracking for pins and drawings state with snapshot management
import type { Pin, Drawing } from './types';
import { pinStore } from './stores.svelte';
import { drawingStore } from './drawing-store.svelte';
import { MAX_HISTORY } from './constants';

interface Snapshot {
	pins: Pin[];
	drawings: Drawing[];
	description: string;
	timestamp: number;
}

// Creates the singleton reactive history store
function createHistoryStore() {
	let undoStack = $state<Snapshot[]>([]);
	let redoStack = $state<Snapshot[]>([]);
	let ignoreNext = false;

	// Takes a snapshot of current pins and drawings state
	function capture(description: string): Snapshot {
		return {
			pins: pinStore.pins.map((p) => ({ ...p })),
			drawings: drawingStore.drawings.map((d) => ({ ...d, points: [...d.points] })),
			description,
			timestamp: Date.now()
		};
	}

	// Restores a snapshot into the stores without triggering another capture
	function restore(snap: Snapshot) {
		ignoreNext = true;
		pinStore.loadPins(snap.pins.map((p) => ({ ...p })));
		drawingStore.loadDrawings(snap.drawings.map((d) => ({ ...d, points: [...d.points] })));
		ignoreNext = false;
	}

	return {
		get canUndo() {
			return undoStack.length > 0;
		},
		get canRedo() {
			return redoStack.length > 0;
		},
		get undoEntries() {
			return undoStack;
		},
		get redoEntries() {
			return redoStack;
		},

		// Saves current state before a mutation
		push(description = 'Action') {
			if (ignoreNext) return;
			undoStack = [...undoStack.slice(-(MAX_HISTORY - 1)), capture(description)];
			redoStack = [];
		},

		// Reverts to the previous state
		undo() {
			if (undoStack.length === 0) return;
			const current = capture('Current');
			const prev = undoStack[undoStack.length - 1];
			undoStack = undoStack.slice(0, -1);
			redoStack = [...redoStack, current];
			restore(prev);
		},

		// Re-applies a previously undone state
		redo() {
			if (redoStack.length === 0) return;
			const current = capture('Current');
			const next = redoStack[redoStack.length - 1];
			redoStack = redoStack.slice(0, -1);
			undoStack = [...undoStack, current];
			restore(next);
		},

		// Jumps to a specific undo stack entry by index
		jumpTo(index: number) {
			if (index < 0 || index >= undoStack.length) return;
			const current = capture('Current');
			const target = undoStack[index];
			const moved = undoStack.slice(index + 1);
			moved.push(current);
			redoStack = [...redoStack, ...moved];
			undoStack = undoStack.slice(0, index);
			restore(target);
		},

		// Clears all history stacks
		clear() {
			undoStack = [];
			redoStack = [];
		}
	};
}

export const historyStore = createHistoryStore();
