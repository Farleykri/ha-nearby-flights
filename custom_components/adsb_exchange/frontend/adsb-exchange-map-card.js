const DEFAULT_MAP_URL = "https://globe.adsbexchange.com/";

const formatNumber = (value, suffix = "") => {
  if (value === null || value === undefined || value === "") {
    return "Unknown";
  }

  if (typeof value === "number") {
    return `${value.toLocaleString()}${suffix}`;
  }

  return `${value}${suffix}`;
};

const hasValue = (value) => value !== null && value !== undefined && value !== "";

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

class AdsbExchangeMapCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._selectedHex = null;
    this._renderBase();
  }

  static getStubConfig() {
    return {
      entity: "sensor.adsb_exchange_watchlist",
    };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("The card requires an entity.");
    }

    this._config = {
      height: 420,
      hide_sidebar: true,
      hide_buttons: true,
      filter_to_tracked: true,
      show_details: true,
      ...config,
    };

    this._updateCard();
  }

  set hass(hass) {
    this._hass = hass;
    this._updateCard();
  }

  getCardSize() {
    return 8;
  }

  _renderBase() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        ha-card {
          overflow: hidden;
        }

        .frame-wrap {
          border-bottom: 1px solid rgba(120, 136, 160, 0.18);
          background:
            radial-gradient(circle at top left, rgba(36, 96, 147, 0.12), transparent 42%),
            linear-gradient(180deg, rgba(11, 20, 32, 0.04), rgba(11, 20, 32, 0));
          padding: 12px;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }

        .title {
          font-size: 1.05rem;
          font-weight: 700;
          letter-spacing: 0.01em;
        }

        .meta {
          color: var(--secondary-text-color);
          font-size: 0.85rem;
        }

        .open-link {
          color: var(--primary-color);
          text-decoration: none;
          font-size: 0.85rem;
          white-space: nowrap;
        }

        iframe {
          display: block;
          width: 100%;
          border: 0;
          border-radius: 14px;
          background: #0f1720;
        }

        .details {
          display: grid;
          gap: 10px;
          padding: 12px;
        }

        .empty {
          color: var(--secondary-text-color);
          font-size: 0.92rem;
          padding: 6px 0 2px;
        }

        .aircraft-list {
          display: grid;
          gap: 10px;
        }

        .aircraft-row {
          border: 1px solid rgba(120, 136, 160, 0.18);
          border-radius: 14px;
          padding: 12px 14px;
          cursor: pointer;
          background: rgba(32, 48, 64, 0.03);
          transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
        }

        .aircraft-row:hover {
          background: rgba(32, 48, 64, 0.06);
          transform: translateY(-1px);
        }

        .aircraft-row.selected {
          border-color: rgba(18, 120, 201, 0.6);
          background: rgba(18, 120, 201, 0.08);
        }

        .row-top {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
        }

        .row-title {
          font-size: 0.98rem;
          font-weight: 700;
        }

        .row-subtitle {
          color: var(--secondary-text-color);
          font-size: 0.84rem;
          margin-top: 2px;
        }

        .status {
          font-size: 0.8rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--primary-color);
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 8px 14px;
        }

        .field {
          min-width: 0;
        }

        .field-label {
          color: var(--secondary-text-color);
          font-size: 0.74rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 2px;
        }

        .field-value {
          font-size: 0.92rem;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .error {
          padding: 16px;
          color: var(--error-color);
        }
      </style>
      <ha-card>
        <div class="frame-wrap">
          <div class="header">
            <div>
              <div class="title"></div>
              <div class="meta"></div>
            </div>
            <a class="open-link" target="_blank" rel="noreferrer">Open map</a>
          </div>
          <iframe referrerpolicy="no-referrer"></iframe>
        </div>
        <div class="details"></div>
      </ha-card>
    `;

    this._titleEl = this.shadowRoot.querySelector(".title");
    this._metaEl = this.shadowRoot.querySelector(".meta");
    this._linkEl = this.shadowRoot.querySelector(".open-link");
    this._frameEl = this.shadowRoot.querySelector("iframe");
    this._detailsEl = this.shadowRoot.querySelector(".details");
  }

  _entityState() {
    return this._hass?.states?.[this._config?.entity];
  }

  _normalizeAircraft(entity) {
    const aircraft = entity?.attributes?.aircraft;
    return Array.isArray(aircraft) ? aircraft : [];
  }

  _pickSelectedAircraft(aircraft) {
    if (!aircraft.length) {
      this._selectedHex = null;
      return null;
    }

    const configuredTarget = this._config.focus_identifier;
    if (configuredTarget) {
      const needle = String(configuredTarget).trim().toUpperCase();
      const configured = aircraft.find((item) => {
        const matches = [
          item.tail_number,
          item.icao_hex,
          item.callsign,
          ...(Array.isArray(item.matched_targets) ? item.matched_targets : []),
        ]
          .filter(Boolean)
          .map((value) => String(value).toUpperCase());
        return matches.includes(needle);
      });
      if (configured) {
        this._selectedHex = configured.icao_hex || null;
        return configured;
      }
    }

    if (this._selectedHex) {
      const selected = aircraft.find((item) => item.icao_hex === this._selectedHex);
      if (selected) {
        return selected;
      }
    }

    const first = aircraft[0];
    this._selectedHex = first.icao_hex || null;
    return first;
  }

  _buildMapUrl(entity, aircraft, selected) {
    const baseUrl = this._config.map_url || entity?.attributes?.map_url || DEFAULT_MAP_URL;
    let url;
    try {
      url = new URL(baseUrl);
    } catch (_error) {
      url = new URL(DEFAULT_MAP_URL);
    }
    const params = url.searchParams;

    const booleanParams = [
      ["hide_sidebar", "hideSideBar"],
      ["hide_buttons", "hideButtons"],
      ["enable_labels", "enableLabels"],
      ["track_labels", "trackLabels"],
    ];

    booleanParams.forEach(([configKey, queryKey]) => {
      if (this._config[configKey]) {
        params.set(queryKey, "");
      }
    });

    const numericParams = [
      ["zoom", "zoom"],
      ["site_lat", "SiteLat"],
      ["site_lon", "SiteLon"],
      ["filter_alt_min", "filterAltMin"],
      ["filter_alt_max", "filterAltMax"],
    ];

    numericParams.forEach(([configKey, queryKey]) => {
      if (hasValue(this._config[configKey])) {
        params.set(queryKey, String(this._config[configKey]));
      }
    });

    if (!hasValue(this._config.site_lat) && hasValue(entity?.attributes?.home_latitude)) {
      params.set("SiteLat", String(entity.attributes.home_latitude));
    }

    if (!hasValue(this._config.site_lon) && hasValue(entity?.attributes?.home_longitude)) {
      params.set("SiteLon", String(entity.attributes.home_longitude));
    }

    if (hasValue(this._config.extra_query)) {
      const extraParams = new URLSearchParams(String(this._config.extra_query));
      extraParams.forEach((value, key) => params.set(key, value));
    }

    const hexes = [...new Set(aircraft.map((item) => item.icao_hex).filter(Boolean))];
    if (this._config.filter_to_tracked && hexes.length > 1) {
      params.set("icaoFilter", hexes.join(","));
    }

    if (selected?.icao_hex) {
      params.set("icao", selected.icao_hex);
    } else if (selected?.tail_number) {
      params.set("reg", selected.tail_number);
    }

    return url.toString();
  }

  _renderAircraftRows(aircraft, selectedHex) {
    if (!this._config.show_details) {
      this._detailsEl.innerHTML = "";
      return;
    }

    if (!aircraft.length) {
      const backendError = this._entityState()?.attributes?.last_error;
      this._detailsEl.innerHTML = `
        <div class="empty">
          ${
            backendError
              ? `Live aircraft data is temporarily unavailable: ${escapeHtml(backendError)}`
              : "No nearby or tracked aircraft are visible right now. The card will update automatically when the feed sees them again."
          }
        </div>
      `;
      return;
    }

    const rows = aircraft
      .map((item) => {
        const selected = item.icao_hex && item.icao_hex === selectedHex;
        const targetList = Array.isArray(item.matched_targets) ? item.matched_targets.join(", ") : "Unknown";
        const latitude = hasValue(item.latitude) ? Number(item.latitude).toFixed(4) : "Unknown";
        const longitude = hasValue(item.longitude) ? Number(item.longitude).toFixed(4) : "Unknown";
        const title = escapeHtml(item.tail_number || item.callsign || item.icao_hex || "Tracked aircraft");
        const callsign = escapeHtml(item.callsign || "No callsign");
        const icaoHex = escapeHtml(item.icao_hex || "No ICAO hex");
        const targets = escapeHtml(targetList);
        const status = escapeHtml(item.status || "unknown");
        const typeLabel = escapeHtml(item.aircraft_type || item.description || "Unknown");
        const dataHex = escapeHtml(item.icao_hex || "");
        const distance = hasValue(item.distance_nm) ? `${Number(item.distance_nm).toFixed(1)} nm` : "Unknown";
        return `
          <div class="aircraft-row ${selected ? "selected" : ""}" data-hex="${dataHex}">
            <div class="row-top">
              <div>
                <div class="row-title">${title}</div>
                <div class="row-subtitle">${callsign} | ${icaoHex} | Targets: ${targets}</div>
              </div>
              <div class="status">${status}</div>
            </div>
            <div class="grid">
              <div class="field">
                <div class="field-label">Altitude</div>
                <div class="field-value">${item.on_ground ? "Ground" : formatNumber(item.altitude_ft, " ft")}</div>
              </div>
              <div class="field">
                <div class="field-label">Ground speed</div>
                <div class="field-value">${formatNumber(item.ground_speed_kt, " kt")}</div>
              </div>
              <div class="field">
                <div class="field-label">Heading</div>
                <div class="field-value">${formatNumber(item.track_deg, " deg")}</div>
              </div>
              <div class="field">
                <div class="field-label">Coordinates</div>
                <div class="field-value">${latitude}, ${longitude}</div>
              </div>
              <div class="field">
                <div class="field-label">Distance</div>
                <div class="field-value">${distance}</div>
              </div>
              <div class="field">
                <div class="field-label">Type</div>
                <div class="field-value">${typeLabel}</div>
              </div>
              <div class="field">
                <div class="field-label">Last seen</div>
                <div class="field-value">${formatNumber(item.seen_seconds, " s ago")}</div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    this._detailsEl.innerHTML = `<div class="aircraft-list">${rows}</div>`;
    this._detailsEl.querySelectorAll(".aircraft-row").forEach((row) => {
      row.addEventListener("click", () => {
        const hex = row.dataset.hex || null;
        this._selectedHex = hex;
        this._updateCard();
      });
    });
  }

  _updateCard() {
    if (!this._config || !this._hass) {
      return;
    }

    const entity = this._entityState();

    if (!entity) {
      this._titleEl.textContent = this._config.title || "Nearby Flights";
      this._metaEl.textContent = `Entity not found: ${this._config.entity}`;
      this._linkEl.href = DEFAULT_MAP_URL;
      this._frameEl.src = "about:blank";
      this._detailsEl.innerHTML = `<div class="error">Set the card's entity to the watchlist sensor created by the integration.</div>`;
      return;
    }

    const aircraft = this._normalizeAircraft(entity);
    const selected = this._pickSelectedAircraft(aircraft);
    const mapUrl = this._buildMapUrl(entity, aircraft, selected);
    const derivedTitle = this._config.title || entity.attributes.entry_title || "Nearby Flights";
    const backendError = entity.attributes.last_error;

    this._titleEl.textContent = derivedTitle;
    const nearbyEnabled = Boolean(entity.attributes.nearby_enabled);
    const radius = entity.attributes.nearby_radius_nm;
    this._metaEl.textContent = backendError
      ? "Map available, live aircraft data temporarily unavailable"
      : nearbyEnabled
        ? `${aircraft.length} aircraft visible within ${radius} nm`
        : `${aircraft.length} tracked aircraft visible`;
    this._linkEl.href = mapUrl;
    this._frameEl.style.height = `${Number(this._config.height) || 420}px`;

    if (this._frameEl.src !== mapUrl) {
      this._frameEl.src = mapUrl;
    }

    this._renderAircraftRows(aircraft, selected?.icao_hex || null);
  }
}

if (!customElements.get("adsb-exchange-map-card")) {
  customElements.define("adsb-exchange-map-card", AdsbExchangeMapCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "adsb-exchange-map-card")) {
  window.customCards.push({
    type: "adsb-exchange-map-card",
    name: "Nearby Flights Map Card",
    description: "Shows nearby or tracked aircraft details with an embeddable flight map.",
    preview: true,
  });
}
