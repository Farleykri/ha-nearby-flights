from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime
import math
import re
from typing import Any

from homeassistant.util import slugify


def normalize_identifier(value: str) -> str:
    """Normalize an aircraft identifier for matching."""
    return value.strip().upper().replace(" ", "")


def normalize_callsign(value: str | None) -> str | None:
    """Normalize a callsign from the feed."""
    if not value:
        return None
    normalized = value.strip().upper().replace(" ", "")
    return normalized or None


def parse_tracked_aircraft(value: str | Iterable[str]) -> tuple[str, ...]:
    """Parse a comma-separated string or iterable into unique identifiers."""
    if isinstance(value, str):
        candidates = value.replace("\n", ",").split(",")
    else:
        candidates = list(value)

    parsed: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = normalize_identifier(str(candidate))
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        parsed.append(normalized)

    return tuple(parsed)


def identifier_slug(value: str) -> str:
    """Build a stable slug for an identifier."""
    return slugify(normalize_identifier(value))


def is_hex_identifier(value: str) -> bool:
    """Return True when the identifier looks like an ICAO hex code."""
    return bool(re.fullmatch(r"[0-9A-F]{6}", normalize_identifier(value)))


def haversine_distance_nm(
    latitude_a: float,
    longitude_a: float,
    latitude_b: float,
    longitude_b: float,
) -> float:
    """Return the distance between two coordinates in nautical miles."""
    radius_nm = 3440.065

    lat1 = math.radians(latitude_a)
    lon1 = math.radians(longitude_a)
    lat2 = math.radians(latitude_b)
    lon2 = math.radians(longitude_b)

    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_nm * c


def coerce_float(value: Any) -> float | None:
    """Convert a value to float when possible."""
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def coerce_int(value: Any) -> int | None:
    """Convert a value to int when possible."""
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def meters_to_feet(value: Any) -> int | None:
    """Convert meters to feet when possible."""
    meters = coerce_float(value)
    if meters is None:
        return None
    return int(round(meters * 3.28084))


def meters_per_second_to_knots(value: Any) -> float | None:
    """Convert meters per second to knots when possible."""
    meters_per_second = coerce_float(value)
    if meters_per_second is None:
        return None
    return round(meters_per_second * 1.943844, 2)


def meters_per_second_to_fpm(value: Any) -> int | None:
    """Convert meters per second to feet per minute when possible."""
    meters_per_second = coerce_float(value)
    if meters_per_second is None:
        return None
    return int(round(meters_per_second * 196.8504))


def iso_timestamp(value: float | int | None) -> str | None:
    """Convert an epoch timestamp to ISO8601."""
    if value in (None, ""):
        return None
    try:
        timestamp = float(value)
        if timestamp > 100_000_000_000:
            timestamp /= 1000
        return datetime.fromtimestamp(timestamp, UTC).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def summarize_aircraft(aircraft: dict[str, Any], fetched_at: datetime) -> dict[str, Any]:
    """Convert a raw ADS-B aircraft record to a Home Assistant-friendly summary."""
    altitude_baro = aircraft.get("alt_baro")
    altitude_geom = aircraft.get("alt_geom")
    altitude_ft = coerce_int(altitude_baro)
    if altitude_ft is None:
        altitude_ft = coerce_int(altitude_geom)

    on_ground = altitude_baro == "ground" or altitude_geom == "ground" or aircraft.get("gnd") is True
    latitude = coerce_float(aircraft.get("lat"))
    longitude = coerce_float(aircraft.get("lon"))
    last_position = aircraft.get("lastPosition")
    if (latitude is None or longitude is None) and isinstance(last_position, dict):
        latitude = latitude if latitude is not None else coerce_float(last_position.get("lat"))
        longitude = longitude if longitude is not None else coerce_float(last_position.get("lon"))
    seen_seconds = coerce_float(aircraft.get("seen"))
    seen_pos_seconds = coerce_float(aircraft.get("seen_pos"))

    status = "airborne"
    if on_ground:
        status = "ground"
    elif latitude is None or longitude is None:
        status = "signal_only"
    if seen_seconds is not None and seen_seconds > 60:
        status = "stale"

    tail_number = aircraft.get("r")
    callsign = aircraft.get("flight")
    icao_hex = aircraft.get("hex")

    baro_rate = coerce_int(aircraft.get("baro_rate"))
    geom_rate = coerce_int(aircraft.get("geom_rate"))

    summary = {
        "tail_number": tail_number.strip().upper() if isinstance(tail_number, str) and tail_number.strip() else None,
        "icao_hex": icao_hex.strip().upper() if isinstance(icao_hex, str) and icao_hex.strip() else None,
        "callsign": normalize_callsign(callsign),
        "altitude_ft": altitude_ft,
        "ground_speed_kt": coerce_float(aircraft.get("gs")),
        "track_deg": coerce_float(aircraft.get("track")),
        "vertical_rate_fpm": baro_rate if baro_rate is not None else geom_rate,
        "latitude": latitude,
        "longitude": longitude,
        "position_source": "last_known"
        if latitude is not None
        and longitude is not None
        and (aircraft.get("lat") is None or aircraft.get("lon") is None)
        else "live",
        "squawk": aircraft.get("squawk"),
        "emergency": aircraft.get("emergency"),
        "category": aircraft.get("category"),
        "aircraft_type": aircraft.get("t"),
        "description": aircraft.get("desc"),
        "operator": aircraft.get("ownOp"),
        "source": aircraft.get("type"),
        "status": status,
        "on_ground": on_ground,
        "seen_seconds": seen_seconds,
        "seen_position_seconds": seen_pos_seconds,
        "messages": coerce_int(aircraft.get("messages")),
        "updated_at": fetched_at.isoformat(),
        "last_seen_at": (
            datetime.fromtimestamp(fetched_at.timestamp() - seen_seconds, UTC).isoformat()
            if seen_seconds is not None
            else None
        ),
        "last_position_at": (
            datetime.fromtimestamp(fetched_at.timestamp() - seen_pos_seconds, UTC).isoformat()
            if seen_pos_seconds is not None
            else None
        ),
        "first_seen_at": iso_timestamp(aircraft.get("seen_pos_start")),
    }

    return summary


def opensky_state_to_aircraft(
    state: list[Any],
    response_time: int | float | None,
) -> dict[str, Any] | None:
    """Convert an OpenSky state vector row to the internal aircraft shape."""
    if len(state) < 17:
        return None

    response_timestamp = coerce_float(response_time)
    last_contact = coerce_float(state[4])
    time_position = coerce_float(state[3])

    return {
        "hex": str(state[0]).upper() if state[0] else None,
        "flight": normalize_callsign(state[1]),
        "lat": coerce_float(state[6]),
        "lon": coerce_float(state[5]),
        "alt_baro": meters_to_feet(state[7]),
        "alt_geom": meters_to_feet(state[13]),
        "gnd": state[8] is True,
        "gs": meters_per_second_to_knots(state[9]),
        "track": coerce_float(state[10]),
        "baro_rate": meters_per_second_to_fpm(state[11]),
        "squawk": state[14],
        "category": coerce_int(state[17]) if len(state) > 17 else None,
        "type": "opensky",
        "desc": state[2],
        "seen": response_timestamp - last_contact
        if response_timestamp is not None and last_contact is not None
        else None,
        "seen_pos": response_timestamp - time_position
        if response_timestamp is not None and time_position is not None
        else None,
    }


def aircraft_candidates(aircraft: dict[str, Any]) -> dict[str, str]:
    """Return normalized identifiers that can match a tracked aircraft."""
    candidates: dict[str, str] = {}

    raw_hex = aircraft.get("hex")
    if isinstance(raw_hex, str) and raw_hex.strip():
        candidates[normalize_identifier(raw_hex)] = "icao_hex"

    raw_reg = aircraft.get("r")
    if isinstance(raw_reg, str) and raw_reg.strip():
        candidates[normalize_identifier(raw_reg)] = "tail_number"

    raw_callsign = aircraft.get("flight")
    normalized_callsign = normalize_callsign(raw_callsign)
    if normalized_callsign:
        candidates[normalized_callsign] = "callsign"

    return candidates
