const DEFAULT_ENTITY = "sensor.flightradar24_current_in_area";
const DEFAULT_TITLE = "Nearby Flights";
const DEFAULT_TILE_URL = "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const DEFAULT_TILE_ATTRIBUTION = "Map data (C) OpenStreetMap, (C) CARTO";
const DEFAULT_OPEN_URL = "https://www.flightradar24.com/{lat},{lon}/{zoom}";
const TILE_SIZE = 256;
const ESRI_WORLD_IMAGERY_ATTRIBUTION =
  "Imagery (C) Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const TILE_THEME_PRESETS = {
  standard: {
    label: "Standard",
    tile_url: DEFAULT_TILE_URL,
    tile_attribution: DEFAULT_TILE_ATTRIBUTION,
  },
  light: {
    label: "Light",
    tile_url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    tile_attribution: DEFAULT_TILE_ATTRIBUTION,
  },
  dark: {
    label: "Dark",
    tile_url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    tile_attribution: DEFAULT_TILE_ATTRIBUTION,
  },
  satellite: {
    label: "Satellite",
    tile_url:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    tile_attribution: ESRI_WORLD_IMAGERY_ATTRIBUTION,
  },
};
const THEME_CHOICES = ["auto", "light", "dark", "satellite"];
const MIN_MAP_ZOOM = 2;
const MAX_MAP_ZOOM = 16;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const hasValue = (value) => value !== null && value !== undefined && value !== "";

const toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (!hasValue(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatValue = (value, suffix = "") => {
  if (!hasValue(value)) {
    return "Unknown";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value.toLocaleString()}${suffix}`;
  }

  return `${value}${suffix}`;
};

const formatDistanceNm = (value) => {
  const numeric = toNumber(value);
  return numeric === null ? "Unknown" : `${numeric.toFixed(1)} nm`;
};

const isHelicopterFlight = (flight) => {
  const haystack = [
    flight.aircraft_model,
    flight.aircraft_code,
    flight.aircraft_registration,
    flight.callsign,
    flight.flight_number,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /(helicopter|heli|rotor|rotorcraft|eurocopter|airbus helicopters|bell\s?(206|212|214|222|230|407|412|429|430|505|525)|robinson\s?r(22|44|66)|h125|h130|h135|h145|h160|ec120|ec130|ec135|ec145|as350|as355|aw109|aw119|aw139|s-?76|uh-?60|ch-?47|mh-?60)/.test(
    haystack,
  );
};

const renderAircraftIcon = (flight, selected) => {
  const heading = toNumber(flight.heading) ?? 0;
  const color = selected ? "#1f7bd8" : flight.on_ground ? "#637688" : "#c84d2c";
  const iconSvg = isHelicopterFlight(flight)
    ? `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M3 6h18M12 3v3M7 10h8a3 3 0 0 1 3 3v2H9a3 3 0 0 1-3-3v-2h1m11 5 3 3M9 15l-2 4m4-9 2-2h5"
        />
      </svg>
    `
    : `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M11.2 2.2h1.6l1.7 5.2 5.3 1.9v1.9l-5-.8v4.2l1.7 1.4v1.6L12 16.9l-4.8 1.7V17l1.8-1.4v-4.2l-5 .8V9.3l5.3-1.9z"
        />
      </svg>
    `;

  return `
    <span class="marker-rotator" style="transform: rotate(${heading}deg);">
      <span class="marker-badge" style="background:${color};">
        <span class="marker-icon">
          ${iconSvg}
        </span>
      </span>
    </span>
  `;
};

const project = (latitude, longitude, zoom) => {
  const lat = clamp(latitude, -85.05112878, 85.05112878);
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const scale = TILE_SIZE * 2 ** zoom;

  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
};

const unproject = (x, y, zoom) => {
  const scale = TILE_SIZE * 2 ** zoom;
  const wrappedX = ((x % scale) + scale) % scale;
  const clampedY = clamp(y, 0, scale);
  const longitude = (wrappedX / scale) * 360 - 180;
  const mercatorY = Math.PI - (2 * Math.PI * clampedY) / scale;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(mercatorY));

  return { latitude, longitude };
};

const parseTimestamp = (value) => {
  if (!hasValue(value)) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const formatAge = (ageMs) => {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 10) {
    return "just now";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
};

const wrapTileX = (value, zoom) => {
  const maxTiles = 2 ** zoom;
  return ((value % maxTiles) + maxTiles) % maxTiles;
};

const haversineDistanceNm = (startLat, startLon, endLat, endLon) => {
  const lat1 = (startLat * Math.PI) / 180;
  const lon1 = (startLon * Math.PI) / 180;
  const lat2 = (endLat * Math.PI) / 180;
  const lon2 = (endLon * Math.PI) / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = lon2 - lon1;

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 3440.065 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

class HaNearbyFlightsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._activeTheme = "auto";
    this._themeMenuOpen = false;
    this._detailsExpanded = false;
    this._selectedFlightId = null;
    this._viewCenter = null;
    this._viewZoom = null;
    this._activePointers = new Map();
    this._dragState = null;
    this._pinchState = null;
    this._mapRenderFrame = null;
    this._lastMapContext = null;
    this._lastStatusContext = null;
    this._statusTimer = null;
    this._mapSize = { width: 0, height: 0 };
    this._resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = Math.round(entry?.contentRect?.width || 0);
      const height = Math.round(entry?.contentRect?.height || 0);

      if (width !== this._mapSize.width || height !== this._mapSize.height) {
        this._mapSize = { width, height };
        this._updateCard();
      }
    });

    this._renderBase();
    this._bindMapInteractions();
  }

  connectedCallback() {
    if (this._mapEl) {
      this._resizeObserver.observe(this._mapEl);
    }
    if (!this._statusTimer) {
      this._statusTimer = window.setInterval(() => this._renderFreshnessStatus(), 30000);
    }
  }

  disconnectedCallback() {
    this._resizeObserver.disconnect();
    if (this._statusTimer) {
      window.clearInterval(this._statusTimer);
      this._statusTimer = null;
    }
    if (this._mapRenderFrame) {
      window.cancelAnimationFrame(this._mapRenderFrame);
      this._mapRenderFrame = null;
    }
  }

  static getConfigElement() {
    return document.createElement("ha-nearby-flights-card-editor");
  }

  static getStubConfig() {
    return {
      entity: DEFAULT_ENTITY,
    };
  }

  setConfig(config) {
    this._config = {
      entity: DEFAULT_ENTITY,
      title: DEFAULT_TITLE,
      height: 440,
      zoom: 10,
      max_flights: 60,
      map_theme: "auto",
      show_theme_toggle: true,
      interactive_map: true,
      details_expanded: false,
      stale_after_minutes: 5,
      show_center_label: false,
      compact_footer: true,
      show_home: true,
      show_list: true,
      follow_selected: false,
      tile_url: null,
      tile_attribution: null,
      open_url: DEFAULT_OPEN_URL,
      ...config,
    };
    this._activeTheme = this._resolveThemeChoice(this._config.map_theme);
    this._detailsExpanded = this._config.details_expanded === true;
    this._viewCenter = null;
    this._viewZoom = null;
    this._lastMapContext = null;

    this._updateCard();
  }

  set hass(hass) {
    this._hass = hass;
    this._updateCard();
  }

  getCardSize() {
    if (this._config?.show_list === false) {
      return 7;
    }
    return this._detailsExpanded ? 10 : 8;
  }

  _renderBase() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        ha-card {
          overflow: hidden;
          background:
            radial-gradient(circle at top left, rgba(255, 174, 74, 0.12), transparent 38%),
            linear-gradient(180deg, rgba(18, 38, 58, 0.06), rgba(18, 38, 58, 0));
        }

        .header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 16px 16px 12px;
        }

        .title {
          font-size: 1.05rem;
          font-weight: 700;
          letter-spacing: 0.01em;
        }

        .meta {
          margin-top: 4px;
          color: var(--secondary-text-color);
          font-size: 0.86rem;
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
        }

        .freshness {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .freshness-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #2d9d78;
          box-shadow: 0 0 0 3px rgba(45, 157, 120, 0.12);
        }

        .freshness.stale {
          color: var(--error-color);
          font-weight: 700;
        }

        .freshness.stale .freshness-dot {
          background: var(--error-color);
          box-shadow: 0 0 0 3px rgba(198, 52, 52, 0.12);
        }

        .open-link {
          color: var(--primary-color);
          text-decoration: none;
          font-size: 0.86rem;
          white-space: nowrap;
          padding-top: 2px;
        }

        .header-actions {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .theme-switch {
          position: relative;
        }

        .theme-switch[hidden] {
          display: none;
        }

        .theme-menu-button {
          width: 30px;
          height: 30px;
          border: 1px solid rgba(96, 120, 144, 0.24);
          background: var(--ha-card-background, var(--card-background-color));
          color: var(--primary-text-color);
          border-radius: 9px;
          padding: 6px;
          cursor: pointer;
          display: grid;
          place-items: center;
        }

        .theme-menu-button svg {
          width: 16px;
          height: 16px;
        }

        .theme-menu-panel {
          position: absolute;
          top: 36px;
          right: 0;
          z-index: 20;
          min-width: 150px;
          padding: 6px;
          border: 1px solid rgba(96, 120, 144, 0.22);
          border-radius: 12px;
          background: var(--ha-card-background, var(--card-background-color));
          box-shadow: 0 12px 28px rgba(12, 24, 37, 0.2);
        }

        .theme-option {
          width: 100%;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: var(--primary-text-color);
          padding: 8px 10px;
          text-align: left;
          cursor: pointer;
          font-size: 0.82rem;
        }

        .theme-option:hover,
        .theme-option:focus-visible,
        .theme-option.active {
          background: rgba(31, 123, 216, 0.12);
          color: var(--primary-color);
        }

        .map-shell {
          position: relative;
          padding: 0 16px 12px;
        }

        .map {
          position: relative;
          overflow: hidden;
          border-radius: 18px;
          background:
            linear-gradient(180deg, rgba(11, 21, 33, 0.28), rgba(11, 21, 33, 0.08)),
            #d9e7ef;
          border: 1px solid rgba(100, 122, 140, 0.18);
          touch-action: none;
          cursor: grab;
        }

        .map.dragging {
          cursor: grabbing;
        }

        .map-controls {
          position: absolute;
          top: 10px;
          right: 10px;
          z-index: 8;
          display: grid;
          gap: 5px;
        }

        .map-control {
          width: 30px;
          height: 30px;
          border: 1px solid rgba(255, 255, 255, 0.7);
          border-radius: 9px;
          background: rgba(12, 24, 37, 0.76);
          color: #ffffff;
          font-size: 1.05rem;
          line-height: 1;
          cursor: pointer;
          backdrop-filter: blur(6px);
        }

        .tiles {
          position: absolute;
          inset: 0;
        }

        .tile {
          position: absolute;
          width: ${TILE_SIZE}px;
          height: ${TILE_SIZE}px;
          user-select: none;
        }

        .markers {
          position: absolute;
          inset: 0;
        }

        .marker {
          position: absolute;
          transform: translate(-50%, -50%);
          border: 0;
          background: transparent;
          padding: 0;
          cursor: pointer;
        }

        .marker-rotator {
          display: block;
          transform-origin: center center;
        }

        .marker-badge {
          display: block;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          border: 2px solid rgba(255, 255, 255, 0.96);
          box-shadow: 0 4px 12px rgba(17, 26, 33, 0.28);
          transition: transform 120ms ease, box-shadow 120ms ease;
          position: relative;
        }

        .marker-icon {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          color: #ffffff;
        }

        .marker-icon svg {
          display: block;
          width: 12px;
          height: 12px;
          overflow: visible;
        }

        .marker:hover .marker-badge,
        .marker:focus-visible .marker-badge,
        .marker.selected .marker-badge {
          transform: scale(1.1);
          box-shadow: 0 6px 16px rgba(17, 26, 33, 0.36);
        }

        .marker-home-dot {
          width: 12px;
          height: 12px;
          border-radius: 4px;
          border: 2px solid rgba(255, 255, 255, 0.92);
          background: #1d5f52;
          box-shadow: 0 4px 12px rgba(17, 26, 33, 0.25);
          transform: rotate(45deg);
        }

        .marker-label {
          position: absolute;
          top: -30px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(12, 24, 37, 0.88);
          color: #f5f8fb;
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 0.74rem;
          white-space: nowrap;
          pointer-events: none;
        }

        .map-empty {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 24px;
          text-align: center;
          color: var(--secondary-text-color);
          font-size: 0.95rem;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.12));
        }

        .map-footer {
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          pointer-events: none;
        }

        .map-footer.compact {
          left: 8px;
          right: 8px;
          bottom: 8px;
          gap: 8px;
        }

        .map-footer.compact.right-only {
          justify-content: flex-end;
        }

        .pill {
          border-radius: 999px;
          background: rgba(12, 24, 37, 0.78);
          color: #f5f8fb;
          padding: 6px 10px;
          font-size: 0.74rem;
          backdrop-filter: blur(6px);
        }

        .map-footer.compact .pill {
          padding: 3px 7px;
          font-size: 0.63rem;
          line-height: 1.15;
          background: rgba(12, 24, 37, 0.72);
        }

        .center-pill {
          white-space: nowrap;
        }

        .attribution-pill {
          max-width: min(60%, 240px);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: right;
        }

        .details {
          padding: 0 16px 16px;
          display: grid;
          gap: 12px;
        }

        .details-toggle {
          width: 100%;
          border: 1px solid rgba(96, 120, 144, 0.18);
          border-radius: 12px;
          background: transparent;
          color: var(--primary-color);
          padding: 9px 12px;
          font-size: 0.84rem;
          font-weight: 700;
          cursor: pointer;
        }

        .selected {
          border: 1px solid rgba(96, 120, 144, 0.18);
          border-radius: 18px;
          padding: 14px 15px;
          background: rgba(255, 255, 255, 0.52);
        }

        .selected-title {
          font-size: 1rem;
          font-weight: 700;
          margin-bottom: 4px;
        }

        .selected-subtitle {
          color: var(--secondary-text-color);
          font-size: 0.86rem;
          margin-bottom: 12px;
        }

        .field-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 10px 14px;
        }

        .field-label {
          color: var(--secondary-text-color);
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 2px;
        }

        .field-value {
          font-size: 0.92rem;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .flight-list {
          display: grid;
          gap: 10px;
        }

        .flight-row {
          text-align: left;
          border: 1px solid rgba(96, 120, 144, 0.18);
          border-radius: 16px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.44);
          cursor: pointer;
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
        }

        .flight-row:hover,
        .flight-row:focus-visible {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.62);
        }

        .flight-row.selected {
          border-color: rgba(31, 123, 216, 0.56);
          background: rgba(31, 123, 216, 0.08);
        }

        .flight-top {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
        }

        .flight-name {
          font-size: 0.97rem;
          font-weight: 700;
        }

        .flight-subtitle {
          color: var(--secondary-text-color);
          font-size: 0.83rem;
          margin-top: 2px;
        }

        .flight-distance {
          color: var(--primary-color);
          font-size: 0.82rem;
          font-weight: 700;
          white-space: nowrap;
        }

        .mini-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 8px 12px;
        }

        .mini-label {
          color: var(--secondary-text-color);
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 2px;
        }

        .mini-value {
          font-size: 0.88rem;
        }

        .error {
          padding: 0 16px 16px;
          color: var(--error-color);
        }
      </style>
      <ha-card>
        <div class="header">
          <div>
            <div class="title"></div>
            <div class="meta"></div>
          </div>
          <div class="header-actions">
            <div class="theme-switch"></div>
            <a class="open-link" target="_blank" rel="noreferrer">Open map</a>
          </div>
        </div>
        <div class="map-shell">
          <div class="map"></div>
        </div>
        <div class="details"></div>
        <div class="error"></div>
      </ha-card>
    `;

    this._titleEl = this.shadowRoot.querySelector(".title");
    this._metaEl = this.shadowRoot.querySelector(".meta");
    this._themeSwitchEl = this.shadowRoot.querySelector(".theme-switch");
    this._openLinkEl = this.shadowRoot.querySelector(".open-link");
    this._mapEl = this.shadowRoot.querySelector(".map");
    this._detailsEl = this.shadowRoot.querySelector(".details");
    this._errorEl = this.shadowRoot.querySelector(".error");
  }

  _getEntityState() {
    return this._hass?.states?.[this._config?.entity || DEFAULT_ENTITY];
  }

  _resolveThemeChoice(theme) {
    const choice = String(theme || "auto").toLowerCase();
    if (choice === "standard") {
      return "light";
    }
    return THEME_CHOICES.includes(choice) ? choice : "auto";
  }

  _isDarkMode() {
    if (typeof this._hass?.themes?.darkMode === "boolean") {
      return this._hass.themes.darkMode;
    }
    return Boolean(window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
  }

  _usingCustomTileSource() {
    return hasValue(this._config?.tile_url);
  }

  _getTileSource() {
    if (this._usingCustomTileSource()) {
      return {
        key: "custom",
        tile_url: String(this._config.tile_url),
        tile_attribution: String(
          this._config.tile_attribution || DEFAULT_TILE_ATTRIBUTION,
        ),
      };
    }

    const choice = this._resolveThemeChoice(this._activeTheme || this._config?.map_theme);
    const key = choice === "auto" ? (this._isDarkMode() ? "dark" : "light") : choice;
    return {
      ...TILE_THEME_PRESETS[key],
      key,
      choice,
      label: choice === "auto" ? `Auto (${TILE_THEME_PRESETS[key].label})` : TILE_THEME_PRESETS[key].label,
    };
  }

  _renderThemeSwitch() {
    if (!this._themeSwitchEl) {
      return;
    }

    if (this._config?.show_theme_toggle === false || this._usingCustomTileSource()) {
      this._themeSwitchEl.hidden = true;
      this._themeSwitchEl.innerHTML = "";
      return;
    }

    const activeChoice = this._resolveThemeChoice(this._activeTheme || this._config?.map_theme);
    const labels = {
      auto: `Auto (${this._isDarkMode() ? "Dark" : "Light"})`,
      light: "Light",
      dark: "Dark",
      satellite: "Satellite",
    };

    this._themeSwitchEl.hidden = false;
    this._themeSwitchEl.innerHTML = `
      <button class="theme-menu-button" type="button" aria-label="Map theme" title="Map theme">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="m12 2 9 5-9 5-9-5zm-7.6 9.2L12 15.4l7.6-4.2L21 12l-9 5-9-5zm0 5L12 20.4l7.6-4.2L21 17l-9 5-9-5z"/>
        </svg>
      </button>
      ${
        this._themeMenuOpen
          ? `<div class="theme-menu-panel">${THEME_CHOICES.map((choice) => {
              const active = activeChoice === choice;
              return `
                <button class="theme-option ${active ? "active" : ""}" type="button" data-theme="${choice}">
                  ${active ? "&#10003; " : ""}${escapeHtml(labels[choice])}
                </button>
              `;
            }).join("")}</div>`
          : ""
      }
    `;

    this._themeSwitchEl.querySelector(".theme-menu-button")?.addEventListener("click", () => {
      this._themeMenuOpen = !this._themeMenuOpen;
      this._renderThemeSwitch();
    });

    this._themeSwitchEl.querySelectorAll("[data-theme]").forEach((button) => {
      button.addEventListener("click", () => {
        this._activeTheme = this._resolveThemeChoice(button.dataset.theme);
        this._themeMenuOpen = false;
        this._updateCard();
      });
    });
  }

  _ensureMapView(center) {
    if (!this._viewCenter) {
      this._viewCenter = {
        latitude: center.latitude,
        longitude: center.longitude,
      };
    }
    if (!Number.isFinite(this._viewZoom)) {
      this._viewZoom = clamp(
        Math.round(toNumber(this._config?.zoom) || 10),
        MIN_MAP_ZOOM,
        MAX_MAP_ZOOM,
      );
    }
  }

  _scheduleMapRender() {
    if (this._mapRenderFrame || !this._lastMapContext) {
      return;
    }

    this._mapRenderFrame = window.requestAnimationFrame(() => {
      this._mapRenderFrame = null;
      const { center, flights, selectedFlight } = this._lastMapContext;
      this._renderMap(center, flights, selectedFlight);
      this._openLinkEl.href = this._buildOpenUrl(this._viewCenter || center, selectedFlight);
    });
  }

  _mapPointFromClient(clientX, clientY) {
    const rect = this._mapEl.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  _panViewBy(deltaX, deltaY) {
    if (!this._viewCenter || !Number.isFinite(this._viewZoom)) {
      return;
    }

    const centerPoint = project(
      this._viewCenter.latitude,
      this._viewCenter.longitude,
      this._viewZoom,
    );
    this._viewCenter = unproject(
      centerPoint.x - deltaX,
      centerPoint.y - deltaY,
      this._viewZoom,
    );
    this._scheduleMapRender();
  }

  _zoomViewAt(nextZoom, clientX, clientY) {
    if (!this._viewCenter || !Number.isFinite(this._viewZoom)) {
      return;
    }

    const zoom = clamp(Math.round(nextZoom), MIN_MAP_ZOOM, MAX_MAP_ZOOM);
    if (zoom === this._viewZoom) {
      return;
    }

    const point = this._mapPointFromClient(clientX, clientY);
    const offsetX = point.x - point.width / 2;
    const offsetY = point.y - point.height / 2;
    const oldCenter = project(
      this._viewCenter.latitude,
      this._viewCenter.longitude,
      this._viewZoom,
    );
    const scale = 2 ** (zoom - this._viewZoom);
    const anchorX = (oldCenter.x + offsetX) * scale;
    const anchorY = (oldCenter.y + offsetY) * scale;

    this._viewZoom = zoom;
    this._viewCenter = unproject(anchorX - offsetX, anchorY - offsetY, zoom);
    this._scheduleMapRender();
  }

  _bindMapInteractions() {
    this._mapEl.addEventListener("wheel", (event) => {
      if (this._config?.interactive_map === false) {
        return;
      }
      event.preventDefault();
      const delta = event.deltaY < 0 ? 1 : -1;
      this._zoomViewAt(this._viewZoom + delta, event.clientX, event.clientY);
    }, { passive: false });

    this._mapEl.addEventListener("click", (event) => {
      const control = event.target.closest?.("[data-map-control]");
      if (!control || this._config?.interactive_map === false) {
        return;
      }
      event.preventDefault();
      const rect = this._mapEl.getBoundingClientRect();
      const delta = control.dataset.mapControl === "zoom-in" ? 1 : -1;
      this._zoomViewAt(
        this._viewZoom + delta,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
    });

    this._mapEl.addEventListener("pointerdown", (event) => {
      if (
        this._config?.interactive_map === false ||
        event.button !== 0 ||
        event.target.closest?.("button, a")
      ) {
        return;
      }

      event.preventDefault();
      this._activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this._mapEl.setPointerCapture?.(event.pointerId);
      this._mapEl.classList.add("dragging");

      if (this._activePointers.size === 1) {
        this._dragState = {
          x: event.clientX,
          y: event.clientY,
          center: project(
            this._viewCenter.latitude,
            this._viewCenter.longitude,
            this._viewZoom,
          ),
        };
      } else if (this._activePointers.size >= 2) {
        const [first, second] = [...this._activePointers.values()];
        this._pinchState = {
          distance: Math.hypot(second.x - first.x, second.y - first.y),
          midpoint: {
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
          },
        };
        this._dragState = null;
      }
    });

    this._mapEl.addEventListener("pointermove", (event) => {
      if (!this._activePointers.has(event.pointerId)) {
        return;
      }

      event.preventDefault();
      this._activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this._activePointers.size >= 2) {
        const [first, second] = [...this._activePointers.values()];
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        const midpoint = {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
        };

        if (this._pinchState) {
          this._panViewBy(
            midpoint.x - this._pinchState.midpoint.x,
            midpoint.y - this._pinchState.midpoint.y,
          );
          const ratio = distance / Math.max(this._pinchState.distance, 1);
          if (ratio > 1.22) {
            this._zoomViewAt(this._viewZoom + 1, midpoint.x, midpoint.y);
            this._pinchState.distance = distance;
          } else if (ratio < 0.82) {
            this._zoomViewAt(this._viewZoom - 1, midpoint.x, midpoint.y);
            this._pinchState.distance = distance;
          }
          this._pinchState.midpoint = midpoint;
        }
        return;
      }

      if (this._dragState) {
        const deltaX = event.clientX - this._dragState.x;
        const deltaY = event.clientY - this._dragState.y;
        this._viewCenter = unproject(
          this._dragState.center.x - deltaX,
          this._dragState.center.y - deltaY,
          this._viewZoom,
        );
        this._scheduleMapRender();
      }
    });

    const endPointer = (event) => {
      if (!this._activePointers.has(event.pointerId)) {
        return;
      }
      this._activePointers.delete(event.pointerId);
      this._mapEl.releasePointerCapture?.(event.pointerId);
      this._pinchState = null;

      if (this._activePointers.size === 1) {
        const remaining = [...this._activePointers.values()][0];
        this._dragState = {
          x: remaining.x,
          y: remaining.y,
          center: project(
            this._viewCenter.latitude,
            this._viewCenter.longitude,
            this._viewZoom,
          ),
        };
      } else {
        this._dragState = null;
        this._mapEl.classList.remove("dragging");
      }
    };

    this._mapEl.addEventListener("pointerup", endPointer);
    this._mapEl.addEventListener("pointercancel", endPointer);
  }

  _normalizeFlights(entity) {
    const rawFlights = entity?.attributes?.flights;
    if (!Array.isArray(rawFlights)) {
      return { flights: [], skipped: 0, total: 0 };
    }

    const flights = [];
    let skipped = 0;

    rawFlights.forEach((flight, index) => {
      const latitude = toNumber(flight.latitude);
      const longitude = toNumber(flight.longitude);

      if (latitude === null || longitude === null) {
        skipped += 1;
        return;
      }

      const title =
        flight.flight_number ||
        flight.callsign ||
        flight.aircraft_registration ||
        flight.aircraft_model ||
        "Unknown flight";

      const identifier =
        flight.flight_number ||
        flight.callsign ||
        flight.aircraft_registration ||
        `${latitude.toFixed(4)},${longitude.toFixed(4)}:${index}`;

      const airline = flight.airline_name || "";
      const aircraft = flight.aircraft_model || flight.aircraft_code || "";

      flights.push({
        id: String(identifier),
        title,
        subtitle: [airline, aircraft].filter(Boolean).join(" | "),
        latitude,
        longitude,
        altitude: toNumber(flight.altitude),
        ground_speed: toNumber(flight.ground_speed),
        heading: toNumber(flight.heading ?? flight.track ?? flight.bearing),
        callsign: flight.callsign || "",
        flight_number: flight.flight_number || "",
        aircraft_registration: flight.aircraft_registration || "",
        aircraft_code: flight.aircraft_code || "",
        airline_name: airline,
        aircraft_model: aircraft,
        airport_origin_name: flight.airport_origin_name || "",
        airport_destination_name: flight.airport_destination_name || "",
        on_ground: Boolean(flight.on_ground) || toNumber(flight.altitude) === 0,
      });
    });

    return {
      flights,
      skipped,
      total: rawFlights.length,
    };
  }

  _getUpdatedTimestamp(entity) {
    const attributes = entity?.attributes || {};
    const candidates = [
      attributes.last_update,
      attributes.last_updated,
      attributes.updated_at,
      entity?.last_updated,
      entity?.last_changed,
    ];

    for (const candidate of candidates) {
      const parsed = parseTimestamp(candidate);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  _renderFreshnessStatus() {
    if (!this._lastStatusContext || !this._metaEl) {
      return;
    }

    const { entity, normalized } = this._lastStatusContext;
    const updatedAt = this._getUpdatedTimestamp(entity);
    const ageMs = updatedAt === null ? null : Math.max(0, Date.now() - updatedAt);
    const staleAfterMinutes = Math.max(
      toNumber(this._config?.stale_after_minutes) || 5,
      1,
    );
    const unavailable = ["unavailable", "unknown"].includes(String(entity?.state));
    const stale = unavailable || ageMs === null || ageMs > staleAfterMinutes * 60 * 1000;
    const freshnessLabel = unavailable
      ? "Source unavailable"
      : ageMs === null
        ? "Update time unknown"
        : `${stale ? "Stale: " : "Updated "}${formatAge(ageMs)}`;
    const skippedLabel = normalized.skipped > 0
      ? ` (${normalized.skipped} without coordinates)`
      : "";

    this._metaEl.innerHTML = `
      <span>${normalized.flights.length} aircraft${escapeHtml(skippedLabel)}</span>
      <span class="freshness ${stale ? "stale" : ""}">
        <span class="freshness-dot"></span>
        ${escapeHtml(freshnessLabel)}
      </span>
    `;
  }

  _getConfiguredCenter() {
    const configuredLat = toNumber(this._config.latitude);
    const configuredLon = toNumber(this._config.longitude);

    if (configuredLat !== null && configuredLon !== null) {
      return { latitude: configuredLat, longitude: configuredLon, source: "configured" };
    }

    const hassLat = toNumber(this._hass?.config?.latitude);
    const hassLon = toNumber(this._hass?.config?.longitude);

    if (hassLat !== null && hassLon !== null) {
      return { latitude: hassLat, longitude: hassLon, source: "home" };
    }

    return null;
  }

  _pickSelectedFlight(flights) {
    if (!flights.length) {
      this._selectedFlightId = null;
      return null;
    }

    const focusedId = this._config.focus_id;
    if (hasValue(focusedId)) {
      const needle = String(focusedId);
      const focused = flights.find((flight) => flight.id === needle);
      if (focused) {
        this._selectedFlightId = focused.id;
        return focused;
      }
    }

    if (this._selectedFlightId) {
      const selected = flights.find((flight) => flight.id === this._selectedFlightId);
      if (selected) {
        return selected;
      }
    }

    this._selectedFlightId = flights[0].id;
    return flights[0];
  }

  _deriveCenter(flights, selectedFlight) {
    if (this._config.follow_selected && selectedFlight) {
      return {
        latitude: selectedFlight.latitude,
        longitude: selectedFlight.longitude,
        source: "selected",
      };
    }

    const configured = this._getConfiguredCenter();
    if (configured) {
      return configured;
    }

    if (selectedFlight) {
      return {
        latitude: selectedFlight.latitude,
        longitude: selectedFlight.longitude,
        source: "selected",
      };
    }

    if (!flights.length) {
      return {
        latitude: 39.5,
        longitude: -98.35,
        source: "fallback",
      };
    }

    const totals = flights.reduce(
      (accumulator, flight) => ({
        latitude: accumulator.latitude + flight.latitude,
        longitude: accumulator.longitude + flight.longitude,
      }),
      { latitude: 0, longitude: 0 },
    );

    return {
      latitude: totals.latitude / flights.length,
      longitude: totals.longitude / flights.length,
      source: "average",
    };
  }

  _buildOpenUrl(center, selectedFlight) {
    const template = String(this._config.open_url || DEFAULT_OPEN_URL);
    const latitude = center.latitude.toFixed(5);
    const longitude = center.longitude.toFixed(5);
    const zoom = String(
      clamp(
        Math.round(this._viewZoom ?? toNumber(this._config.zoom) ?? 10),
        MIN_MAP_ZOOM,
        MAX_MAP_ZOOM,
      ),
    );

    return template
      .replaceAll("{lat}", latitude)
      .replaceAll("{lon}", longitude)
      .replaceAll("{zoom}", zoom)
      .replaceAll("{flight_number}", encodeURIComponent(selectedFlight?.flight_number || ""))
      .replaceAll("{callsign}", encodeURIComponent(selectedFlight?.callsign || ""))
      .replaceAll("{registration}", encodeURIComponent(selectedFlight?.aircraft_registration || ""));
  }

  _markerPoint(latitude, longitude, center, zoom, width, height) {
    const worldPoint = project(latitude, longitude, zoom);
    const centerPoint = project(center.latitude, center.longitude, zoom);
    const left = worldPoint.x - centerPoint.x + width / 2;
    const top = worldPoint.y - centerPoint.y + height / 2;

    return { left, top };
  }

  _renderMap(center, flights, selectedFlight) {
    this._ensureMapView(center);
    const width = Math.max(this._mapSize.width || 0, 320);
    const height = Math.max(Math.round(toNumber(this._config.height) || 440), 220);
    const zoom = this._viewZoom;
    const mapCenter = this._viewCenter;
    const maxFlights = clamp(Math.round(toNumber(this._config.max_flights) || 60), 1, 500);
    const visibleFlights = flights.slice(0, maxFlights);
    const tileSource = this._getTileSource();

    this._mapEl.style.height = `${height}px`;
    this._mapEl.style.cursor = this._config.interactive_map === false ? "default" : "grab";
    this._mapEl.style.touchAction = this._config.interactive_map === false ? "auto" : "none";

    const centerPoint = project(mapCenter.latitude, mapCenter.longitude, zoom);
    const startX = centerPoint.x - width / 2;
    const startY = centerPoint.y - height / 2;
    const endX = centerPoint.x + width / 2;
    const endY = centerPoint.y + height / 2;
    const maxTile = 2 ** zoom - 1;
    const tileMinX = Math.floor(startX / TILE_SIZE);
    const tileMaxX = Math.floor(endX / TILE_SIZE);
    const tileMinY = clamp(Math.floor(startY / TILE_SIZE), 0, maxTile);
    const tileMaxY = clamp(Math.floor(endY / TILE_SIZE), 0, maxTile);

    const tiles = [];
    for (let tileX = tileMinX; tileX <= tileMaxX; tileX += 1) {
      for (let tileY = tileMinY; tileY <= tileMaxY; tileY += 1) {
        const wrappedTileX = wrapTileX(tileX, zoom);
        const left = tileX * TILE_SIZE - startX;
        const top = tileY * TILE_SIZE - startY;
        const retinaSuffix = window.devicePixelRatio > 1 ? "@2x" : "";
        const subdomain = ["a", "b", "c", "d"][Math.abs(tileX + tileY) % 4];
        const url = String(tileSource.tile_url || DEFAULT_TILE_URL)
          .replaceAll("{z}", String(zoom))
          .replaceAll("{x}", String(wrappedTileX))
          .replaceAll("{y}", String(tileY))
          .replaceAll("{r}", retinaSuffix)
          .replaceAll("{s}", subdomain);

        tiles.push(`
          <img
            class="tile"
            alt=""
            loading="lazy"
            decoding="async"
            draggable="false"
            referrerpolicy="strict-origin-when-cross-origin"
            src="${escapeHtml(url)}"
            style="left:${left}px;top:${top}px;"
          >
        `);
      }
    }

    const markers = visibleFlights
      .map((flight) => {
        const point = this._markerPoint(flight.latitude, flight.longitude, mapCenter, zoom, width, height);
        const inBounds =
          point.left >= -28 &&
          point.left <= width + 28 &&
          point.top >= -28 &&
          point.top <= height + 28;

        if (!inBounds) {
          return "";
        }

        const selected = selectedFlight?.id === flight.id;
        const classes = ["marker"];
        if (selected) {
          classes.push("selected");
        }

        const label = selected
          ? `<span class="marker-label">${escapeHtml(flight.title)}</span>`
          : "";

        return `
          <button
            class="${classes.join(" ")}"
            type="button"
            data-flight-id="${escapeHtml(flight.id)}"
            title="${escapeHtml(flight.title)}"
            style="left:${point.left}px;top:${point.top}px;"
          >
            ${label}
            ${renderAircraftIcon(flight, selected)}
          </button>
        `;
      })
      .join("");

    const configuredCenter = this._getConfiguredCenter();
    const centerMarker =
      this._config.show_home && configuredCenter
        ? (() => {
            const homePoint = this._markerPoint(
              configuredCenter.latitude,
              configuredCenter.longitude,
              mapCenter,
              zoom,
              width,
              height,
            );

            return `
              <button
                class="marker home"
                type="button"
                title="Home"
                style="left:${homePoint.left}px;top:${homePoint.top}px;"
              >
                <span class="marker-home-dot"></span>
              </button>
            `;
          })()
        : "";

    const emptyState = visibleFlights.length
      ? ""
      : `
        <div class="map-empty">
          No aircraft with mappable coordinates are available from this entity right now.
        </div>
      `;

    const centerLabel =
      center.source === "home"
        ? "Centered on Home Assistant home"
        : center.source === "configured"
          ? "Centered on configured location"
          : center.source === "selected"
            ? "Centered on selected aircraft"
            : "Centered on nearby aircraft";

    const attribution = escapeHtml(tileSource.tile_attribution || DEFAULT_TILE_ATTRIBUTION);
    const showCenterLabel = this._config.show_center_label === true;
    const compactFooter = this._config.compact_footer !== false;
    const footerClasses = ["map-footer"];
    if (compactFooter) {
      footerClasses.push("compact");
    }
    if (!showCenterLabel) {
      footerClasses.push("right-only");
    }

    this._mapEl.innerHTML = `
      <div class="tiles">${tiles.join("")}</div>
      <div class="markers">
        ${centerMarker}
        ${markers}
      </div>
      ${emptyState}
      ${
        this._config.interactive_map === false
          ? ""
          : `
            <div class="map-controls">
              <button class="map-control" type="button" data-map-control="zoom-in" aria-label="Zoom in">+</button>
              <button class="map-control" type="button" data-map-control="zoom-out" aria-label="Zoom out">-</button>
            </div>
          `
      }
      <div class="${footerClasses.join(" ")}">
        ${showCenterLabel ? `<div class="pill center-pill">${escapeHtml(centerLabel)}</div>` : ""}
        <div class="pill attribution-pill" title="${attribution}">${attribution}</div>
      </div>
    `;

    this._mapEl.querySelectorAll("[data-flight-id]").forEach((button) => {
      button.addEventListener("click", () => {
        this._selectedFlightId = button.dataset.flightId || null;
        if (this._config.follow_selected) {
          const flight = flights.find((item) => item.id === this._selectedFlightId);
          if (flight) {
            this._viewCenter = {
              latitude: flight.latitude,
              longitude: flight.longitude,
            };
          }
        }
        this._updateCard();
      });
    });
  }

  _renderDetails(flights, selectedFlight, center) {
    if (!this._config.show_list) {
      this._detailsEl.innerHTML = "";
      return;
    }

    if (!flights.length) {
      this._detailsEl.innerHTML = `
        <div class="selected">
          <div class="selected-title">No flights available</div>
          <div class="selected-subtitle">
            Make sure ${escapeHtml(this._config.entity || DEFAULT_ENTITY)} exists and exposes a flights attribute.
          </div>
        </div>
      `;
      return;
    }

    const withDistance = flights
      .map((flight) => ({
        ...flight,
        distance_nm: haversineDistanceNm(
          center.latitude,
          center.longitude,
          flight.latitude,
          flight.longitude,
        ),
      }))
      .sort((left, right) => left.distance_nm - right.distance_nm);

    const selectedDistance = withDistance.find((flight) => flight.id === selectedFlight?.id)?.distance_nm;
    const selectedSubtitleParts = [
      selectedFlight?.airline_name,
      selectedFlight?.aircraft_model,
      selectedFlight?.callsign,
      selectedFlight?.aircraft_registration,
    ].filter(Boolean);

    const selectedMarkup = selectedFlight
      ? `
        <div class="selected">
          <div class="selected-title">${escapeHtml(selectedFlight.title)}</div>
          <div class="selected-subtitle">${escapeHtml(selectedSubtitleParts.join(" | ") || "Nearby aircraft")}</div>
          <div class="field-grid">
            <div>
              <div class="field-label">Altitude</div>
              <div class="field-value">${selectedFlight.on_ground ? "Ground" : formatValue(selectedFlight.altitude, " ft")}</div>
            </div>
            <div>
              <div class="field-label">Ground speed</div>
              <div class="field-value">${formatValue(selectedFlight.ground_speed, " kt")}</div>
            </div>
            <div>
              <div class="field-label">Heading</div>
              <div class="field-value">${formatValue(selectedFlight.heading, " deg")}</div>
            </div>
            <div>
              <div class="field-label">Distance</div>
              <div class="field-value">${formatDistanceNm(selectedDistance)}</div>
            </div>
            <div>
              <div class="field-label">Route</div>
              <div class="field-value">${escapeHtml(selectedFlight.airport_origin_name || "Unknown")} to ${escapeHtml(selectedFlight.airport_destination_name || "Unknown")}</div>
            </div>
          </div>
        </div>
      `
      : "";

    const listMarkup = withDistance
      .map((flight) => {
        const selected = flight.id === selectedFlight?.id;
        const subtitle = [flight.callsign, flight.airline_name, flight.aircraft_model]
          .filter(Boolean)
          .join(" | ");

        return `
          <button class="flight-row ${selected ? "selected" : ""}" type="button" data-flight-id="${escapeHtml(flight.id)}">
            <div class="flight-top">
              <div>
                <div class="flight-name">${escapeHtml(flight.title)}</div>
                <div class="flight-subtitle">${escapeHtml(subtitle || "Nearby aircraft")}</div>
              </div>
              <div class="flight-distance">${formatDistanceNm(flight.distance_nm)}</div>
            </div>
            <div class="mini-grid">
              <div>
                <div class="mini-label">Altitude</div>
                <div class="mini-value">${flight.on_ground ? "Ground" : formatValue(flight.altitude, " ft")}</div>
              </div>
              <div>
                <div class="mini-label">Speed</div>
                <div class="mini-value">${formatValue(flight.ground_speed, " kt")}</div>
              </div>
              <div>
                <div class="mini-label">From</div>
                <div class="mini-value">${escapeHtml(flight.airport_origin_name || "Unknown")}</div>
              </div>
              <div>
                <div class="mini-label">To</div>
                <div class="mini-value">${escapeHtml(flight.airport_destination_name || "Unknown")}</div>
              </div>
            </div>
          </button>
        `;
      })
      .join("");

    const toggleMarkup = flights.length > 1
      ? `
        <button class="details-toggle" type="button" data-details-toggle>
          ${this._detailsExpanded ? "Hide flight list" : `Show all ${flights.length} flights`}
        </button>
      `
      : "";

    this._detailsEl.innerHTML = `
      ${selectedMarkup}
      ${toggleMarkup}
      ${this._detailsExpanded ? `<div class="flight-list">${listMarkup}</div>` : ""}
    `;

    this._detailsEl.querySelector("[data-details-toggle]")?.addEventListener("click", () => {
      this._detailsExpanded = !this._detailsExpanded;
      this._renderDetails(flights, selectedFlight, center);
    });

    this._detailsEl.querySelectorAll("[data-flight-id]").forEach((button) => {
      button.addEventListener("click", () => {
        this._selectedFlightId = button.dataset.flightId || null;
        if (this._config.follow_selected) {
          const flight = flights.find((item) => item.id === this._selectedFlightId);
          if (flight) {
            this._viewCenter = {
              latitude: flight.latitude,
              longitude: flight.longitude,
            };
          }
        }
        this._updateCard();
      });
    });
  }

  _updateCard() {
    if (!this._config || !this._hass) {
      return;
    }

    const entity = this._getEntityState();

    if (!entity) {
      this._lastStatusContext = null;
      this._titleEl.textContent = this._config.title || DEFAULT_TITLE;
      this._metaEl.textContent = `Entity not found: ${this._config.entity || DEFAULT_ENTITY}`;
      this._renderThemeSwitch();
      this._openLinkEl.href = DEFAULT_OPEN_URL
        .replaceAll("{lat}", "39.50000")
        .replaceAll("{lon}", "-98.35000")
        .replaceAll("{zoom}", String(this._config.zoom || 10));
      this._mapEl.style.height = `${Math.max(Math.round(toNumber(this._config.height) || 440), 220)}px`;
      this._mapEl.style.touchAction = "auto";
      this._mapEl.innerHTML = `
        <div class="map-empty">
          Set the card entity to a Flightradar24 sensor with a flights attribute.
        </div>
      `;
      this._detailsEl.innerHTML = "";
      this._errorEl.textContent = "";
      return;
    }

    const normalized = this._normalizeFlights(entity);
    const selectedFlight = this._pickSelectedFlight(normalized.flights);
    const center = this._deriveCenter(normalized.flights, selectedFlight);
    this._ensureMapView(center);
    const openUrl = this._buildOpenUrl(this._viewCenter || center, selectedFlight);

    this._titleEl.textContent =
      this._config.title || entity.attributes.friendly_name || DEFAULT_TITLE;

    this._lastStatusContext = { entity, normalized };
    this._renderFreshnessStatus();
    this._openLinkEl.href = openUrl;
    this._renderThemeSwitch();

    this._lastMapContext = {
      center,
      flights: normalized.flights,
      selectedFlight,
    };
    this._renderMap(center, normalized.flights, selectedFlight);
    this._renderDetails(normalized.flights, selectedFlight, center);
    this._errorEl.textContent = "";
  }
}

class HaNearbyFlightsCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
  }

  set hass(hass) {
    const needsInitialRender = !this._hass;
    this._hass = hass;
    if (needsInitialRender) {
      this._render();
    }
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  _getValue(name, fallback) {
    return Object.hasOwn(this._config, name) ? this._config[name] : fallback;
  }

  _getEntityOptions() {
    const candidates = Object.entries(this._hass?.states || {})
      .filter(([entityId, state]) =>
        entityId.startsWith("sensor.") &&
        (entityId.includes("flightradar24") || Array.isArray(state.attributes?.flights)))
      .map(([entityId, state]) => ({
        entityId,
        name: state.attributes?.friendly_name || entityId,
      }));

    if (!candidates.some(({ entityId }) => entityId === DEFAULT_ENTITY)) {
      candidates.push({ entityId: DEFAULT_ENTITY, name: DEFAULT_ENTITY });
    }

    return candidates.sort((left, right) => left.name.localeCompare(right.name));
  }

  _updateConfig(name, value) {
    const config = { ...this._config };
    if (value === null || value === undefined || value === "") {
      delete config[name];
    } else {
      config[name] = value;
    }

    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config },
      bubbles: true,
      composed: true,
    }));
  }

  _render() {
    const entityOptions = this._getEntityOptions()
      .map(({ entityId, name }) =>
        `<option value="${escapeHtml(entityId)}">${escapeHtml(name)}</option>`)
      .join("");
    const checked = (name, fallback) => this._getValue(name, fallback) ? "checked" : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          color: var(--primary-text-color);
        }

        .editor {
          display: grid;
          gap: 18px;
          padding: 8px 0;
        }

        .section {
          display: grid;
          gap: 12px;
        }

        .section-title {
          color: var(--secondary-text-color);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .field-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        label.field {
          display: grid;
          gap: 6px;
          color: var(--secondary-text-color);
          font-size: 0.82rem;
        }

        input,
        select {
          box-sizing: border-box;
          width: 100%;
          min-height: 42px;
          padding: 9px 11px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          outline: none;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font: inherit;
        }

        input:focus,
        select:focus {
          border-color: var(--primary-color);
          box-shadow: 0 0 0 1px var(--primary-color);
        }

        .toggles {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px 16px;
        }

        .toggle {
          display: flex;
          align-items: center;
          gap: 9px;
          min-height: 34px;
          font-size: 0.9rem;
        }

        .toggle input {
          width: 18px;
          min-height: 18px;
          margin: 0;
          accent-color: var(--primary-color);
        }

        @media (max-width: 520px) {
          .field-grid,
          .toggles {
            grid-template-columns: 1fr;
          }
        }
      </style>
      <div class="editor">
        <section class="section">
          <div class="section-title">Source</div>
          <label class="field">
            Flight sensor
            <input
              type="text"
              list="flight-sensor-options"
              data-config="entity"
              value="${escapeHtml(this._getValue("entity", DEFAULT_ENTITY))}"
              placeholder="${DEFAULT_ENTITY}"
            >
          </label>
          <datalist id="flight-sensor-options">${entityOptions}</datalist>
          <label class="field">
            Card title
            <input
              type="text"
              data-config="title"
              value="${escapeHtml(this._getValue("title", DEFAULT_TITLE))}"
              placeholder="${DEFAULT_TITLE}"
            >
          </label>
        </section>

        <section class="section">
          <div class="section-title">Map</div>
          <div class="field-grid">
            <label class="field">
              Default theme
              <select data-config="map_theme">
                ${THEME_CHOICES.map((choice) => `
                  <option value="${choice}" ${this._resolveThemeChoice(this._getValue("map_theme", "auto")) === choice ? "selected" : ""}>
                    ${choice.charAt(0).toUpperCase()}${choice.slice(1)}
                  </option>
                `).join("")}
              </select>
            </label>
            <label class="field">
              Starting zoom
              <input type="number" min="${MIN_MAP_ZOOM}" max="${MAX_MAP_ZOOM}" step="1" data-config="zoom" value="${escapeHtml(this._getValue("zoom", 10))}">
            </label>
            <label class="field">
              Map height (px)
              <input type="number" min="220" step="10" data-config="height" value="${escapeHtml(this._getValue("height", 440))}">
            </label>
            <label class="field">
              Maximum flights
              <input type="number" min="1" max="500" step="1" data-config="max_flights" value="${escapeHtml(this._getValue("max_flights", 60))}">
            </label>
            <label class="field">
              Stale after (minutes)
              <input type="number" min="1" step="1" data-config="stale_after_minutes" value="${escapeHtml(this._getValue("stale_after_minutes", 5))}">
            </label>
          </div>
        </section>

        <section class="section">
          <div class="section-title">Display</div>
          <div class="toggles">
            <label class="toggle"><input type="checkbox" data-config="interactive_map" ${checked("interactive_map", true)}>Interactive map</label>
            <label class="toggle"><input type="checkbox" data-config="show_theme_toggle" ${checked("show_theme_toggle", true)}>Theme menu</label>
            <label class="toggle"><input type="checkbox" data-config="show_home" ${checked("show_home", true)}>Home marker</label>
            <label class="toggle"><input type="checkbox" data-config="show_list" ${checked("show_list", true)}>Flight details</label>
            <label class="toggle"><input type="checkbox" data-config="details_expanded" ${checked("details_expanded", false)}>Expand flight list</label>
            <label class="toggle"><input type="checkbox" data-config="follow_selected" ${checked("follow_selected", false)}>Follow selected flight</label>
            <label class="toggle"><input type="checkbox" data-config="show_center_label" ${checked("show_center_label", false)}>Center label</label>
            <label class="toggle"><input type="checkbox" data-config="compact_footer" ${checked("compact_footer", true)}>Compact attribution</label>
          </div>
        </section>
      </div>
    `;

    this.shadowRoot.querySelectorAll("[data-config]").forEach((input) => {
      input.addEventListener("change", () => {
        let value = input.value;
        if (input.type === "checkbox") {
          value = input.checked;
        } else if (input.type === "number") {
          value = input.value === "" ? null : Number(input.value);
        } else {
          value = input.value.trim();
        }
        this._updateConfig(input.dataset.config, value);
      });
    });
  }

  _resolveThemeChoice(theme) {
    const choice = String(theme || "auto").toLowerCase();
    if (choice === "standard") {
      return "light";
    }
    return THEME_CHOICES.includes(choice) ? choice : "auto";
  }
}

if (!customElements.get("ha-nearby-flights-card-editor")) {
  customElements.define("ha-nearby-flights-card-editor", HaNearbyFlightsCardEditor);
}

if (!customElements.get("ha-nearby-flights-card")) {
  customElements.define("ha-nearby-flights-card", HaNearbyFlightsCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "ha-nearby-flights-card")) {
  window.customCards.push({
    type: "ha-nearby-flights-card",
    name: "HA Nearby Flights Card",
    description: "Plots Flightradar24 nearby-flight sensor data on a Lovelace map.",
    preview: true,
  });
}
