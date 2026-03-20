// Custom OverlayView-based marker using composition so it can be imported before the Google Maps API loads
export class CustomMarker {
	private overlay: google.maps.OverlayView;
	private _position: google.maps.LatLngLiteral;
	private _content: HTMLElement;
	private _clickable: boolean;
	private _draggable: boolean;
	private _anchor: string;
	private container: HTMLDivElement | null = null;
	private clickHandlers: (() => void)[] = [];
	private dragEndHandlers: (() => void)[] = [];

	// Initializes the overlay, binds lifecycle hooks, and optionally attaches to a map
	constructor(options: {
		position: google.maps.LatLngLiteral;
		content: HTMLElement;
		map?: google.maps.Map | null;
		clickable?: boolean;
		draggable?: boolean;
		anchor?: 'top' | 'center';
	}) {
		this._position = options.position;
		this._content = options.content;
		this._clickable = options.clickable ?? false;
		this._draggable = options.draggable ?? false;
		this._anchor = options.anchor === 'center' ? 'translate(-50%, -50%)' : 'translate(-50%, -100%)';

		this.overlay = new google.maps.OverlayView();
		this.overlay.onAdd = () => this.onAdd();
		this.overlay.draw = () => this.draw();
		this.overlay.onRemove = () => this.onRemove();

		if (options.map) this.overlay.setMap(options.map);
	}

	get position(): google.maps.LatLngLiteral {
		return this._position;
	}

	set position(pos: google.maps.LatLngLiteral) {
		this._position = pos;
		this.draw();
	}

	get content(): HTMLElement {
		return this._content;
	}

	set content(el: HTMLElement) {
		this._content = el;
		if (this.container) {
			this.container.innerHTML = '';
			this.container.appendChild(el);
		}
	}

	get map(): google.maps.Map | null {
		return this.overlay.getMap() as google.maps.Map | null;
	}

	set map(m: google.maps.Map | null) {
		this.overlay.setMap(m);
	}

	// Returns the current map instance
	getMap(): google.maps.Map | null {
		return this.overlay.getMap() as google.maps.Map | null;
	}

	// Sets or removes the marker from a map
	setMap(m: google.maps.Map | null) {
		this.overlay.setMap(m);
	}

	// Creates the container element and appends it to the appropriate map pane
	private onAdd() {
		this.container = document.createElement('div');
		this.container.style.position = 'absolute';
		this.container.appendChild(this._content);

		const panes = this.overlay.getPanes()!;
		if (this._clickable || this._draggable) {
			panes.overlayMouseTarget.appendChild(this.container);
		} else {
			panes.floatPane.appendChild(this.container);
		}

		if (this._clickable && !this._draggable) {
			this.container.addEventListener('click', (e) => {
				e.stopPropagation();
				for (const handler of this.clickHandlers) handler();
			});
		}

		if (this._draggable) {
			this.setupDrag();
		}
	}

	// Positions the container at the correct pixel location for the current lat/lng
	private draw() {
		if (!this.container) return;
		const projection = this.overlay.getProjection();
		if (!projection) return;
		const point = projection.fromLatLngToDivPixel(
			new google.maps.LatLng(this._position.lat, this._position.lng)
		);
		if (!point) return;
		this.container.style.left = `${point.x}px`;
		this.container.style.top = `${point.y}px`;
		this.container.style.transform = this._anchor;
	}

	// Removes the container element from the DOM
	private onRemove() {
		if (this.container) {
			this.container.parentNode?.removeChild(this.container);
			this.container = null;
		}
	}

	// Registers a click or dragend event handler
	addEventListener(event: string, handler: () => void) {
		if (event === 'click') {
			this.clickHandlers.push(handler);
		} else if (event === 'dragend') {
			this.dragEndHandlers.push(handler);
		}
	}

	// Attaches mousedown/mousemove/mouseup listeners for drag-to-reposition behavior
	private setupDrag() {
		if (!this.container) return;
		this.container.style.cursor = 'grab';

		const DRAG_THRESHOLD = 5;
		let isPointerDown = false;
		let hasDragged = false;
		let startX = 0;
		let startY = 0;
		let origPos: google.maps.LatLngLiteral;

		const onMouseDown = (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			isPointerDown = true;
			hasDragged = false;
			startX = e.clientX;
			startY = e.clientY;
			origPos = { ...this._position };
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		};

		const onMouseMove = (e: MouseEvent) => {
			if (!isPointerDown) return;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			if (!hasDragged) {
				if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
				hasDragged = true;
				this.container!.style.cursor = 'grabbing';
				this.container!.style.zIndex = '999999';
				(this.overlay.getMap() as google.maps.Map)?.setOptions({ draggable: false });
			}
			const projection = this.overlay.getProjection();
			if (!projection) return;
			const startPixel = projection.fromLatLngToDivPixel(
				new google.maps.LatLng(origPos.lat, origPos.lng)
			);
			if (!startPixel) return;
			const newLatLng = projection.fromDivPixelToLatLng(
				new google.maps.Point(startPixel.x + dx, startPixel.y + dy)
			);
			if (!newLatLng) return;
			this._position = { lat: newLatLng.lat(), lng: newLatLng.lng() };
			this.draw();
		};

		const onMouseUp = () => {
			const wasDrag = hasDragged;
			isPointerDown = false;
			hasDragged = false;
			if (this.container) {
				this.container.style.cursor = 'grab';
				this.container.style.zIndex = '';
			}
			(this.overlay.getMap() as google.maps.Map)?.setOptions({ draggable: true });
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			if (wasDrag) {
				for (const handler of this.dragEndHandlers) handler();
			} else {
				for (const handler of this.clickHandlers) handler();
			}
		};

		this.container.addEventListener('mousedown', onMouseDown);
	}
}
