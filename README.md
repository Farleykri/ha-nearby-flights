# FR24 Nearby Flights Map Card for Home Assistant

This repository is being repurposed into a Lovelace custom card for the existing [home-assistant-flightradar24](https://github.com/AlexandrErohin/home-assistant-flightradar24) integration.

The goal is simple: take the flights already exposed by `sensor.flightradar24_current_in_area` and plot them on a map so a user can glance at nearby aircraft over their area.

## Target experience

- install the Flightradar24 integration you already like
- add this card to Lovelace
- point it at `sensor.flightradar24_current_in_area`
- see aircraft markers on a map with quick flight details

The card is intended to work with flight objects like:

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

## Planned card behavior

- plot each flight from the sensor's `flights` attribute using `latitude` and `longitude`
- show a details panel for the selected aircraft
- fall back cleanly when a field is missing
- support centering the map on the user's home area or a configured location
- stay lightweight and easy to configure

Example template data the card is being designed around:

```jinja
{% set flights = state_attr('sensor.flightradar24_current_in_area', 'flights') or [] %}

Flights in area: {{ flights | count }}

{% for flight in flights %}
Flight: {{ flight.flight_number | default(flight.callsign, true) | default(flight.aircraft_registration, true) | default('Unknown', true) }}
  Lat: {{ flight.latitude }}
  Lon: {{ flight.longitude }}
  Alt: {{ flight.altitude }}
  Speed: {{ flight.ground_speed }}
  Airline: {{ flight.airline_name }}
  Aircraft: {{ flight.aircraft_model }}
  From: {{ flight.airport_origin_name }}
  To: {{ flight.airport_destination_name }}

{% endfor %}
```

## Current status

This repository is not yet the finished Flightradar24 card.

What is true today:

- the repo branding and documentation now reflect the new goal
- the next implementation step is a frontend Lovelace map card that reads `sensor.flightradar24_current_in_area`
- the older `custom_components/adsb_exchange` code is legacy prototype work from the previous direction and should be treated as temporary while this repo is being pivoted

## Near-term roadmap

1. Build the custom Lovelace card around the Flightradar24 sensor data model.
2. Render aircraft markers and a selection/details experience on the map.
3. Update packaging so the repository is card-first instead of integration-first.
4. Add polished setup docs and screenshots once the card is working end to end.

## Repository note

If you are here looking for the established backend integration that provides the `flights` data, use [home-assistant-flightradar24](https://github.com/AlexandrErohin/home-assistant-flightradar24).

This repo's job is the map card layer that sits on top of that integration.
