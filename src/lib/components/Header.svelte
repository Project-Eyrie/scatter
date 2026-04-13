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
		onExportEncrypted: () => void;
		onClearAll: () => void;
		onUndo: () => void;
		onRedo: () => void;
		canUndo: boolean;
		canRedo: boolean;
		cursorLat?: number;
		cursorLng?: number;
		bottomPanelOpen?: boolean;
		onToggleBottomPanel?: () => void;
		onToolOpen?: (tool: string) => void;
		savedViews?: Array<{ id: string; name: string }>;
		onSaveView?: () => void;
		onLoadView?: (id: string) => void;
		onDeleteView?: (id: string) => void;
	}

	let {
		onToggleSidebar,
		sidebarOpen,
		onShare,
		onExport,
		onImport,
		onImportCsv,
		onExportCsv,
		onExportEncrypted,
		onClearAll,
		onUndo,
		onRedo,
		canUndo,
		canRedo,
		cursorLat = 0,
		cursorLng = 0,
		bottomPanelOpen = false,
		onToggleBottomPanel,
		onToolOpen,
		savedViews = [],
		onSaveView,
		onLoadView,
		onDeleteView
	}: Props = $props();

	let copied = $state(false);
	let fileOpen = $state(false);
	let editOpen = $state(false);
	let viewOpen = $state(false);
	let toolsOpen = $state(false);

	// Shows a brief "Copied" confirmation in the share button
	export function showCopied() {
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	// Closes all open dropdown menus
	function closeMenus() {
		fileOpen = false;
		editOpen = false;
		viewOpen = false;
		toolsOpen = false;
	}

	// Toggles the File dropdown menu and closes others
	function handleFileClick() {
		editOpen = false; viewOpen = false; toolsOpen = false;
		fileOpen = !fileOpen;
	}

	// Toggles the Edit dropdown menu and closes others
	function handleEditClick() {
		fileOpen = false; viewOpen = false; toolsOpen = false;
		editOpen = !editOpen;
	}

	// Toggles the View dropdown menu and closes others
	function handleViewClick() {
		fileOpen = false; editOpen = false; toolsOpen = false;
		viewOpen = !viewOpen;
	}

	// Toggles the Tools dropdown menu and closes others
	function handleToolsClick() {
		fileOpen = false; editOpen = false; viewOpen = false;
		toolsOpen = !toolsOpen;
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
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				{#if sidebarOpen}
					<path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
				{:else}
					<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
				{/if}
			</svg>
		</button>
		<img src="/scatter_logo.png" alt="Scatter" class="brand-logo" />
		<span class="brand-text">SCATTER</span>
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
						<button class="menu-option" onclick={() => { closeMenus(); onExportEncrypted(); }}>
							<span class="menu-option-label">Export Encrypted</span>
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
			<div class="menu-item">
				<button class="menu-trigger" class:open={viewOpen} onclick={(e) => { e.stopPropagation(); handleViewClick(); }}>View</button>
				{#if viewOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
					<div class="menu-dropdown" onclick={(e) => e.stopPropagation()}>
						<button class="menu-option" onclick={() => { closeMenus(); onSaveView?.(); }}>
							<span class="menu-option-label">Save Current View</span>
							<span class="menu-option-shortcut">Ctrl+S</span>
						</button>
						{#if savedViews.length > 0}
							<div class="menu-sep"></div>
							{#each savedViews as view}
								<div class="menu-view-row">
									<button class="menu-option menu-view-btn" onclick={() => { closeMenus(); onLoadView?.(view.id); }}>
										<span class="menu-option-label">{view.name}</span>
									</button>
									<button class="menu-view-del" onclick={(e) => { e.stopPropagation(); onDeleteView?.(view.id); }} title="Delete view">×</button>
								</div>
							{/each}
						{:else}
							<div class="menu-empty">No saved views</div>
						{/if}
					</div>
				{/if}
			</div>
			<div class="menu-item">
				<button class="menu-trigger" class:open={toolsOpen} onclick={(e) => { e.stopPropagation(); handleToolsClick(); }}>Tools</button>
				{#if toolsOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
					<div class="menu-dropdown" onclick={(e) => e.stopPropagation()}>
						<button class="menu-option" onclick={() => { closeMenus(); onToolOpen?.('distance'); }}>
							<span class="menu-option-label">Distance Circles</span>
						</button>
						<button class="menu-option" onclick={() => { closeMenus(); onToolOpen?.('matrix'); }}>
							<span class="menu-option-label">Distance Matrix</span>
						</button>
						<button class="menu-option" onclick={() => { closeMenus(); onToolOpen?.('crowd'); }}>
							<span class="menu-option-label">Crowd Estimator</span>
						</button>
						<button class="menu-option" onclick={() => { closeMenus(); onToolOpen?.('sun'); }}>
							<span class="menu-option-label">Sun Position</span>
						</button>
						<button class="menu-option" onclick={() => { closeMenus(); onToolOpen?.('timezone'); }}>
							<span class="menu-option-label">Timezone</span>
						</button>
						<button class="menu-option" onclick={() => { closeMenus(); onToolOpen?.('weather'); }}>
							<span class="menu-option-label">Weather Overlay</span>
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
		{#if onToggleBottomPanel}
			<button class="header-toggle" class:active={bottomPanelOpen} onclick={onToggleBottomPanel} title={bottomPanelOpen ? 'Hide panels' : 'Show panels'}>
				<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
				</svg>
				<span>Panels</span>
			</button>
		{/if}
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
		height: 30px;
		padding: 0 8px;
		background: #f8f9fa;
		border-bottom: 1px solid #ddd;
		flex-shrink: 0;
		z-index: 10000;
		position: relative;
	}

	.left {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 100%;
	}

	.center {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 2px;
		font-family: var(--font-mono);
		font-size: 10px;
	}

	.coord-val {
		color: #666;
		font-variant-numeric: tabular-nums;
	}

	.coord-sep {
		color: #ccc;
		margin: 0 1px;
	}

	.right {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 100%;
	}

	.brand-logo {
		width: 18px;
		height: 18px;
		border-radius: 3px;
		object-fit: contain;
		flex-shrink: 0;
	}

	.brand-text {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #999;
		text-transform: uppercase;
		display: flex;
		align-items: center;
		height: 100%;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 100%;
		border-radius: 0;
		color: #888;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.08s;
		flex-shrink: 0;
	}

	.icon-btn:hover:not(:disabled) {
		color: #1a1a1a;
		background: #eee;
	}

	.menu-bar {
		display: flex;
		align-items: center;
		gap: 0;
		margin-left: 4px;
	}

	.menu-item {
		position: relative;
	}

	.menu-trigger {
		padding: 0 8px;
		border-radius: 2px;
		border: none;
		background: transparent;
		color: #666;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.08s;
		display: flex;
		align-items: center;
		height: 100%;
	}

	.menu-trigger:hover,
	.menu-trigger.open {
		color: #1a1a1a;
		background: #eee;
	}

	.menu-dropdown {
		position: absolute;
		top: calc(100% + 2px);
		left: 0;
		min-width: 170px;
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 3px;
		box-shadow: 0 3px 8px rgba(0, 0, 0, 0.08);
		padding: 2px;
		z-index: 99999;
	}

	.menu-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 4px 8px;
		border-radius: 2px;
		border: none;
		background: transparent;
		color: #333;
		font-family: var(--font-mono);
		font-size: 10px;
		cursor: pointer;
		transition: all 0.06s;
		text-align: left;
	}

	.menu-option:hover:not(:disabled) {
		background: #f5f5f5;
		color: #1a1a1a;
	}

	.menu-option:disabled {
		color: #ccc;
		cursor: default;
	}

	.menu-option.danger:hover {
		background: #fef2f2;
		color: #dc2626;
	}

	.menu-option-shortcut {
		color: #aaa;
		font-size: 9px;
	}

	.menu-option-label {
		flex: 1;
	}

	.menu-sep {
		height: 1px;
		background: #eee;
		margin: 2px 4px;
	}

	.menu-view-row {
		display: flex;
		align-items: center;
	}

	.menu-view-btn {
		flex: 1;
		min-width: 0;
	}

	.menu-view-btn .menu-option-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.menu-view-del {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: none;
		background: none;
		color: #ccc;
		font-size: 14px;
		cursor: pointer;
		flex-shrink: 0;
		border-radius: 2px;
	}

	.menu-view-del:hover {
		color: #dc2626;
		background: #fef2f2;
	}

	.menu-empty {
		padding: 6px 8px;
		font-size: 9px;
		color: #ccc;
		font-family: var(--font-mono);
	}

	.header-toggle {
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 2px 8px;
		border-radius: 2px;
		border: 1px solid #ddd;
		background: #fff;
		color: #666;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.08s;
	}

	.header-toggle:hover {
		color: #1a1a1a;
		border-color: #bbb;
	}

	.header-toggle.active {
		color: #2563eb;
		border-color: #2563eb;
		background: #f0f4ff;
	}

	.share-btn {
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 2px 8px;
		border-radius: 2px;
		border: 1px solid #ddd;
		background: #fff;
		color: #666;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: all 0.08s;
	}

	.share-btn:hover {
		color: #1a1a1a;
		border-color: #bbb;
		background: #f5f5f5;
	}

	@media (max-width: 640px) {
		.center {
			display: none;
		}
	}
</style>
