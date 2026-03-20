<script lang="ts">
	// Top header bar with File/Edit menus, coordinates, and share
	import { onMount } from 'svelte';

	interface Props {
		onToggleSidebar: () => void;
		sidebarOpen: boolean;
		onShare: () => void;
		onExport: () => void;
		onImport: () => void;
		onImportCsv: () => void;
		onExportCsv: () => void;
		onExportImage: () => void;
		onClearAll: () => void;
		onUndo: () => void;
		onRedo: () => void;
		canUndo: boolean;
		canRedo: boolean;
		cursorLat?: number;
		cursorLng?: number;
	}

	let {
		onToggleSidebar,
		sidebarOpen,
		onShare,
		onExport,
		onImport,
		onImportCsv,
		onExportCsv,
		onExportImage,
		onClearAll,
		onUndo,
		onRedo,
		canUndo,
		canRedo,
		cursorLat = 0,
		cursorLng = 0
	}: Props = $props();

	let copied = $state(false);
	let fileOpen = $state(false);
	let editOpen = $state(false);

	// Shows a brief "Copied" confirmation in the share button
	export function showCopied() {
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	// Closes all open dropdown menus
	function closeMenus() {
		fileOpen = false;
		editOpen = false;
	}

	// Toggles the File menu and closes Edit
	function handleFileClick() {
		editOpen = false;
		fileOpen = !fileOpen;
	}

	// Toggles the Edit menu and closes File
	function handleEditClick() {
		fileOpen = false;
		editOpen = !editOpen;
	}

	// Closes menus when clicking outside
	onMount(() => {
		const handler = () => closeMenus();
		window.addEventListener('click', handler);
		return () => window.removeEventListener('click', handler);
	});
</script>

<header class="header">
	<div class="left">
		<button class="icon-btn sidebar-toggle" onclick={onToggleSidebar} title="{sidebarOpen ? 'Close' : 'Open'} sidebar">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				{#if sidebarOpen}
					<path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
				{:else}
					<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
				{/if}
			</svg>
		</button>
		<div class="brand">
			<img src="/scatter_logo.png" alt="Scatter" class="brand-logo" />
			<span class="brand-text">SCATTER</span>
		</div>
		<div class="menu-bar">
			<div class="menu-item">
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<button class="menu-trigger" class:open={fileOpen} onclick={(e) => { e.stopPropagation(); handleFileClick(); }}>File</button>
				{#if fileOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
					<div class="menu-dropdown" onclick={(e) => e.stopPropagation()}>
						<button class="menu-option" onclick={() => { closeMenus(); onImport(); }}>
							<span class="menu-option-label">Import JSON</span>
						</button>
						<button class="menu-option" onclick={() => { closeMenus(); onImportCsv(); }}>
							<span class="menu-option-label">Import CSV</span>
						</button>
						<div class="menu-sep"></div>
						<button class="menu-option" onclick={() => { closeMenus(); onExport(); }}>
							<span class="menu-option-label">Export JSON</span>
						</button>
						<button class="menu-option" onclick={() => { closeMenus(); onExportCsv(); }}>
							<span class="menu-option-label">Export CSV</span>
						</button>
						<button class="menu-option" onclick={() => { closeMenus(); onExportImage(); }} title="Captures overlays only — map tiles may not render due to cross-origin restrictions">
							<span class="menu-option-label">Export Image</span>
						</button>
					</div>
				{/if}
			</div>
			<div class="menu-item">
				<button class="menu-trigger" class:open={editOpen} onclick={(e) => { e.stopPropagation(); handleEditClick(); }}>Edit</button>
				{#if editOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
					<div class="menu-dropdown" onclick={(e) => e.stopPropagation()}>
						<button class="menu-option" onclick={() => { closeMenus(); onUndo(); }} disabled={!canUndo}>
							<span class="menu-option-label">Undo</span>
							<span class="menu-option-shortcut">Ctrl+Z</span>
						</button>
						<button class="menu-option" onclick={() => { closeMenus(); onRedo(); }} disabled={!canRedo}>
							<span class="menu-option-label">Redo</span>
							<span class="menu-option-shortcut">Ctrl+Y</span>
						</button>
						<div class="menu-sep"></div>
						<button class="menu-option danger" onclick={() => { closeMenus(); onClearAll(); }}>
							<span class="menu-option-label">Clear All</span>
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<div class="center">
		<span class="coord-val">{cursorLat.toFixed(6)}</span>
		<span class="coord-sep">,</span>
		<span class="coord-val">{cursorLng.toFixed(6)}</span>
	</div>

	<div class="right">
		<button class="share-btn" onclick={onShare} title="Copy share link">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				{#if copied}
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
				{:else}
					<path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
				{/if}
			</svg>
			<span>{copied ? 'Copied' : 'Share'}</span>
		</button>
	</div>
</header>

<style>
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 36px;
		padding: 0 10px;
		background: #0c1021;
		border-bottom: 1px solid #1a2236;
		flex-shrink: 0;
		z-index: 50;
		position: relative;
	}

	.left {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.center {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 3px;
		font-family: var(--font-mono);
		font-size: 11px;
	}

	.coord-val {
		color: #64748b;
		font-variant-numeric: tabular-nums;
	}

	.coord-sep {
		color: #334155;
		margin: 0 1px;
	}

	.right {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	.brand-logo {
		width: 20px;
		height: 20px;
		border-radius: 4px;
		object-fit: contain;
	}

	.brand-text {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #94a3b8;
		line-height: 1;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 4px;
		color: #64748b;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.1s;
	}

	.icon-btn:hover:not(:disabled) {
		color: #e2e8f0;
		background: rgba(255, 255, 255, 0.05);
	}

	.menu-bar {
		display: flex;
		align-items: center;
		gap: 0;
		margin-left: 6px;
	}

	.menu-item {
		position: relative;
	}

	.menu-trigger {
		padding: 3px 10px;
		border-radius: 4px;
		border: none;
		background: transparent;
		color: #94a3b8;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.1s;
	}

	.menu-trigger:hover,
	.menu-trigger.open {
		color: #e2e8f0;
		background: rgba(255, 255, 255, 0.06);
	}

	.menu-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		min-width: 180px;
		background: #0f172a;
		border: 1px solid #1e293b;
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		padding: 4px;
		z-index: 200;
	}

	.menu-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 6px 10px;
		border-radius: 4px;
		border: none;
		background: transparent;
		color: #cbd5e1;
		font-family: var(--font-mono);
		font-size: 11px;
		cursor: pointer;
		transition: all 0.08s;
		text-align: left;
	}

	.menu-option:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.06);
		color: #f1f5f9;
	}

	.menu-option:disabled {
		color: #334155;
		cursor: default;
	}

	.menu-option.danger:hover {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	.menu-option-shortcut {
		color: #475569;
		font-size: 10px;
	}

	.menu-option-label {
		flex: 1;
	}

	.menu-sep {
		height: 1px;
		background: #1e293b;
		margin: 4px 6px;
	}

	.share-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 12px;
		border-radius: 5px;
		border: 1px solid #1e293b;
		background: transparent;
		color: #94a3b8;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: all 0.12s;
	}

	.share-btn:hover {
		color: #e2e8f0;
		border-color: #334155;
		background: rgba(255, 255, 255, 0.03);
	}

	@media (max-width: 640px) {
		.center {
			display: none;
		}
	}
</style>
