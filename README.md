# ADS-B Exchange Watchlist for Home Assistant

`adsb_exchange` is a HACS-ready custom integration for tracking aircraft from an ADS-B Exchange-compatible source and surfacing them in Home Assistant as:

- one watchlist sensor with the current tracked aircraft list
- one sensor per tracked aircraft identifier
- one device tracker per tracked aircraft identifier
- a Lovelace custom card that embeds an ADS-B Exchange map and a synced details panel

## What it shows

Each tracked aircraft can expose:

- tail number
- ICAO hex
- callsign
- latitude / longitude
- altitude
- ground speed
- heading
- type / description
- last seen age

## Installation

1. Add this repository to HACS as an `Integration` repository.
2. Install `ADS-B Exchange Watchlist`.
3. Restart Home Assistant.
4. Add the integration from `Settings -> Devices & Services -> Add Integration`.

## Initial setup

During config flow you can set:

- `Tracked aircraft`: comma-separated tail numbers, ICAO hex codes, or callsigns
- `Aircraft feed URL`: defaults to `https://gateway.adsbexchange.com/api/aircraft/v2`
- `ADS-B Exchange API key`: required when using the official ADS-B Exchange gateway
- `Map URL`: defaults to `https://globe.adsbexchange.com/`
- `Update interval`: polling interval in seconds
- `Request timeout`: timeout for each refresh

Example tracked aircraft list:

```text
N123AB, A1B2C3, UAL123
```

## Supported data sources

### Official ADS-B Exchange API

Use:

- `Aircraft feed URL`: `https://gateway.adsbexchange.com/api/aircraft/v2`
- `ADS-B Exchange API key`: your ADS-B Exchange API key

The integration will query:

- `/hex` for ICAO hex lookups
- `/registration` for tail number lookups
- `/callsign/{callsign}` for callsign lookups

### Local tar1090 / readsb feed

If you run your own receiver, point `Aircraft feed URL` to a local or self-hosted `aircraft.json`, for example:

```text
http://your-host/data/aircraft.json
```

No API key is required for local feeds.

## Entities created

For a config entry named `NYC Flights`, the integration creates:

- a watchlist sensor like `sensor.nyc_flights_watchlist`
- one aircraft sensor per tracked identifier
- one device tracker per tracked identifier

The watchlist sensor exposes a rich `aircraft` attribute that the Lovelace card reads directly.

Because the integration also creates `device_tracker` entities, you can use Home Assistant's built-in map card even if you do not want the custom ADS-B Exchange iframe card.

### Native Home Assistant map fallback

```yaml
type: map
entities:
  - device_tracker.nyc_flights_n123ab_location
  - device_tracker.nyc_flights_a1b2c3_location
default_zoom: 6
hours_to_show: 2
```

## Lovelace card

The card file is served by the integration at:

```text
/api/adsb_exchange/frontend/adsb-exchange-map-card.js
```

Add it as a dashboard resource:

1. Open `Settings -> Dashboards -> Resources`
2. Add a new resource
3. URL: `/api/adsb_exchange/frontend/adsb-exchange-map-card.js`
4. Resource type: `JavaScript Module`

### Example card

```yaml
type: custom:adsb-exchange-map-card
entity: sensor.nyc_flights_watchlist
title: NYC Flights
height: 460
zoom: 8
site_lat: 40.7128
site_lon: -74.0060
hide_sidebar: true
hide_buttons: true
filter_to_tracked: true
show_details: true
```

### Card options

- `entity`: required watchlist sensor
- `title`: card title
- `height`: iframe height in pixels
- `map_url`: optional map URL override
- `focus_identifier`: select a specific tail number / hex / callsign first
- `zoom`: map zoom value
- `site_lat`: map center latitude
- `site_lon`: map center longitude
- `hide_sidebar`: hide the ADS-B Exchange sidebar
- `hide_buttons`: hide on-map controls
- `enable_labels`: request map labels
- `track_labels`: request track labels
- `filter_alt_min`: minimum altitude filter
- `filter_alt_max`: maximum altitude filter
- `filter_to_tracked`: keep the map focused on tracked aircraft
- `show_details`: show the details list below the map
- `extra_query`: raw query string to append to the map URL

## Notes

- On April 9, 2026, the public globe feed URL `https://globe.adsbexchange.com/data/aircraft.json` returned HTTP 403 in direct server-side requests. The integration now treats that public feed as unsupported for backend polling.
- The map card uses the configured map URL and ADS-B Exchange query parameters, so users can center the map on any region they want.
- If you already run your own `tar1090` or other ADS-B Exchange-compatible feed, point `Aircraft feed URL` at that endpoint instead.
- If the embedded ADS-B Exchange map is blocked by browser or remote framing policy, use the built-in Home Assistant map card with the generated `device_tracker` entities.
