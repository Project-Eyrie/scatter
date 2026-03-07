<script lang="ts">
	// Floating toolbar for selecting drawing tools, colors, and finishing/undoing drawings
	import { drawingStore } from '$lib/drawing-store.svelte';
	import { haversineDistance, formatDistance } from '$lib/geo';
	import { STROKE_WIDTH_OPTIONS } from '$lib/constants';
	import type { DrawingMode } from '$lib/types';

	interface Props {
		onFinish?: () => void;
	}

	let { onFinish }: Props = $props();

	const tools: { mode: DrawingMode; label: string; icon: string }[] = [
		{ mode: 'path', label: 'Path', icon: 'M3 17l6-6 4 4 8-8' },
		{ mode: 'arrow', label: 'Arrow', icon: 'M5 19L19 5M19 5H9M19 5v10' },
		{ mode: 'polygon', label: 'Area', icon: 'M4 6l4-4 8 4 4 4-4 8-8 4z' },
		{ mode: 'circle', label: 'Radius', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20z' },
		{ mode: 'note', label: 'Note', icon: 'M7 8h10M7 12h6m-6 4h8M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z' },
		{
			mode: 'measure',
			label: 'Measure',
			icon: 'M2 12h4m12 0h4M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83'
		}
	];

	// Activates a drawing tool or deactivates it if already active
	function toggleTool(mode: DrawingMode) {
		drawingStore.cancelDrawing();
		if (drawingStore.mode !== mode) {
			drawingStore.mode = mode;
		}
	}

	// Completes the current drawing or delegates to the parent finish handler
	function finishCurrent() {
		if (drawingStore.mode !== 'measure' && onFinish) {
			onFinish();
		} else {
			drawingStore.finishDrawing();
		}
	}

	// Handles keyboard shortcuts for undo (Ctrl+Z) and finish/cancel (Enter)
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'z' && (e.ctrlKey || e.metaKey) && drawingStore.mode !== 'none') {
			e.preventDefault();
			drawingStore.undoLastPoint();
		}
		if (e.key === 'Enter' && drawingStore.mode !== 'none' && drawingStore.mode !== 'note') {
			if (drawingStore.currentPoints.length >= 2) {
				finishCurrent();
			} else {
				drawingStore.cancelDrawing();
			}
		}
	}

	let measureTotal = $derived.by(() => {
		if (drawingStore.mode !== 'measure' || drawingStore.currentPoints.length < 2) return 0;
		const pts = drawingStore.currentPoints;
		let total = 0;
		for (let i = 1; i < pts.length; i++) {
			total += haversineDistance(pts[i - 1], pts[i]);
		}
		return total;
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="toolbar">
	{#each tools as tool (tool.mode)}
		<button
			class="tool-btn"
			class:active={drawingStore.mode === tool.mode}
			onclick={() => toggleTool(tool.mode)}
			title={tool.label}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="icon"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path stroke-linecap="round" stroke-linejoin="round" d={tool.icon} />
			</svg>
			<span class="tool-label">{tool.label}</span>
		</button>
	{/each}

	{#if drawingStore.mode !== 'none' && drawingStore.mode !== 'measure' && drawingStore.mode !== 'note'}
		<div class="sep"></div>
		{#each STROKE_WIDTH_OPTIONS as w}
			<button
				class="width-btn"
				class:active={drawingStore.activeStrokeWidth === w}
				onclick={() => (drawingStore.activeStrokeWidth = w)}
				title="{w}px"
			>
				<span class="width-line" style="height: {w}px;"></span>
			</button>
		{/each}
	{/if}

	{#if drawingStore.mode !== 'none'}
		<div class="sep"></div>
		<div class="status">
			{#if drawingStore.mode === 'measure'}
				{#if measureTotal > 0}
					<span class="measure-value">{formatDistance(measureTotal)}</span>
				{:else}
					<span class="hint">Click to measure</span>
				{/if}
			{:else if drawingStore.mode === 'note'}
				<span class="hint">Click to place note</span>
			{:else if drawingStore.mode === 'circle'}
				<span class="hint">
					{drawingStore.currentPoints.length === 0 ? 'Set center' : 'Set radius'}
				</span>
			{:else}
				<span class="hint">{drawingStore.currentPoints.length} pts</span>
			{/if}
			{#if drawingStore.mode !== 'note' && drawingStore.mode !== 'circle'}
				<span class="key-hints">
					<kbd class="kbd">Enter</kbd><span class="key-sep">{drawingStore.currentPoints.length >= 2 ? 'finish' : 'exit'}</span>
				</span>
			{/if}
		</div>

		{#if drawingStore.mode !== 'note' && drawingStore.currentPoints.length > 0}
			<button class="action-btn" onclick={() => drawingStore.undoLastPoint()} title="Undo (Ctrl+Z)">
				<svg xmlns="http://www.w3.org/2000/svg" class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
				</svg>
			</button>
		{/if}
		{#if drawingStore.mode !== 'note' && drawingStore.currentPoints.length >= 2}
			<button class="action-btn done" onclick={finishCurrent} title="Finish (Enter)">
				<svg xmlns="http://www.w3.org/2000/svg" class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
				</svg>
			</button>
		{/if}
	{/if}
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px;
		background: rgba(15, 23, 42, 0.92);
		backdrop-filter: blur(8px);
		border: 1px solid #1e293b;
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}

	.tool-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		width: 42px;
		height: 40px;
		border-radius: 6px;
		color: #64748b;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.12s;
		padding: 3px 2px 2px;
	}

	.tool-btn:hover {
		color: #cbd5e1;
		background: rgba(255, 255, 255, 0.04);
	}

	.tool-btn.active {
		color: #f59e0b;
		background: rgba(245, 158, 11, 0.08);
	}

	.icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.tool-label {
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 600;
		letter-spacing: 0.03em;
		line-height: 1;
	}

	.icon-sm {
		width: 13px;
		height: 13px;
	}

	.sep {
		width: 1px;
		height: 24px;
		background: #1e293b;
		margin: 0 3px;
	}

	.width-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 4px;
		border: 1.5px solid transparent;
		background: transparent;
		cursor: pointer;
		transition: all 0.12s;
	}

	.width-btn:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.width-btn.active {
		border-color: #94a3b8;
	}

	.width-line {
		display: block;
		width: 12px;
		background: #94a3b8;
		border-radius: 1px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 6px;
	}

	.hint {
		font-family: var(--font-mono);
		font-size: 10px;
		color: #64748b;
		white-space: nowrap;
	}

	.measure-value {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		color: #e2e8f0;
		white-space: nowrap;
	}

	.key-hints {
		display: flex;
		align-items: center;
		gap: 3px;
		margin-left: 6px;
	}

	.kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 1px 5px;
		border-radius: 3px;
		border: 1px solid #334155;
		background: rgba(255, 255, 255, 0.03);
		color: #64748b;
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 600;
		line-height: 1.4;
		white-space: nowrap;
	}

	.key-sep {
		font-family: var(--font-mono);
		font-size: 8px;
		color: #334155;
		margin-right: 4px;
	}

	.action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 4px;
		border: none;
		cursor: pointer;
		background: rgba(255, 255, 255, 0.05);
		color: #94a3b8;
		transition: all 0.12s;
	}

	.action-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: #e2e8f0;
	}

	.action-btn.done {
		color: #10b981;
	}

	.action-btn.done:hover {
		background: rgba(16, 185, 129, 0.15);
	}

</style>
