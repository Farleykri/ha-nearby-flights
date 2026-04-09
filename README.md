# HA Nearby Flights Card

`ha-nearby-flights` is a HACS dashboard/plugin repository for a Lovelace card that works with the existing [home-assistant-flightradar24](https://github.com/AlexandrErohin/home-assistant-flightradar24) integration.

It reads the `flights` attribute from `sensor.flightradar24_current_in_area` and plots nearby aircraft on a map with a selectable details list.

## What it needs

- Home Assistant
- HACS
- the [home-assistant-flightradar24](https://github.com/AlexandrErohin/home-assistant-flightradar24) integration
- an entity like `sensor.flightradar24_current_in_area` with a `flights` attribute

The card is designed around flight data like:

- `flight_number`
- `callsign`
- `aircraft_registration`
- `latitude`
- `longitude`
- `altitude`
- `ground_speed`
- `airline_name`
- `aircraft_model`
- `airport_origin_name`
- `airport_destination_name`

## Installation

1. Add this repository to HACS as a `Dashboard` repository.
2. Install `HA Nearby Flights Card`.
3. Ensure the Lovelace resource exists.
4. If HACS does not register it automatically, add `/hacsfiles/ha-nearby-flights/ha-nearby-flights.js` as a `JavaScript Module`.

## Example card

```yaml
type: custom:ha-nearby-flights-card
entity: sensor.flightradar24_current_in_area
title: Flights Over Home
height: 460
zoom: 10
show_home: true
show_list: true
```

## Card options

- `entity`: Flightradar24 area sensor, defaults to `sensor.flightradar24_current_in_area`
- `title`: card title
- `height`: map height in pixels
- `zoom`: slippy-map zoom level
- `latitude`: optional map center latitude override
- `longitude`: optional map center longitude override
- `max_flights`: maximum number of aircraft markers to render
- `focus_id`: optional initial flight identifier to select
- `map_theme`: built-in map style preset: `standard`, `light`, `dark`, or `satellite`
- `show_theme_toggle`: show map-style buttons in the card header
- `show_center_label`: show the "centered on..." footer label
- `compact_footer`: use the smaller low-profile footer style
- `show_home`: show a home marker using the Home Assistant location when available
- `show_list`: show the selectable aircraft list below the map
- `follow_selected`: center the map on the selected aircraft instead of the home area
- `tile_url`: optional tile URL template, defaults to `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png`
- `tile_attribution`: attribution text shown on the map
- `open_url`: optional external map URL template. Supported placeholders are `{lat}`, `{lon}`, `{zoom}`, `{flight_number}`, `{callsign}`, and `{registration}`

## Notes

- The default map tiles now use the same CARTO Voyager raster basemap pattern Home Assistant's own frontend map code uses.
- Built-in `light`, `dark`, and `satellite` themes are available when you are not overriding `tile_url`.
- Built-in `light` and `dark` use CARTO raster tiles, and `satellite` uses Esri World Imagery, so keep the visible attribution in place.
- The "centered on..." footer label is hidden by default now, and the attribution chip uses a smaller compact footer style by default.
- If you set `tile_url`, it takes priority over `map_theme` and the theme toggle is hidden.
- If you prefer a different tile source, override `tile_url` and `tile_attribution`.
- The card only reads Lovelace-visible Home Assistant state. It does not create entities and does not require a companion custom integration.
- Flights without valid latitude and longitude are skipped on the map but still count toward the source sensor's total.
