from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import logging
import math
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from aiohttp import ClientError, ClientResponseError, ClientTimeout

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    ATTR_AIRCRAFT,
    ATTR_MATCHED_TARGETS,
    BLOCKED_PUBLIC_FEED_URL,
    CONF_API_KEY,
    CONF_DATA_URL,
    CONF_ENABLE_NEARBY,
    CONF_NEARBY_RADIUS,
    CONF_REQUEST_TIMEOUT,
    CONF_SCAN_INTERVAL,
    CONF_TRACKED_AIRCRAFT,
    DOMAIN,
    OFFICIAL_API_BASE_PATH,
    OFFICIAL_API_HOST,
    OPENSKY_API_HOST,
    OPENSKY_API_PATH,
)
from .helpers import (
    aircraft_candidates,
    haversine_distance_nm,
    is_hex_identifier,
    opensky_state_to_aircraft,
    parse_tracked_aircraft,
    summarize_aircraft,
)

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class ADSBExchangeCoordinatorData:
    """Normalized state returned by the coordinator."""

    aircraft_by_target: dict[str, dict[str, Any] | None]
    aircraft: list[dict[str, Any]]
    source_url: str
    fetched_at: str
    source_timestamp: str | None
    nearby_enabled: bool
    nearby_radius_nm: float
    home_latitude: float | None
    home_longitude: float | None


class ADSBExchangeCoordinator(DataUpdateCoordinator[ADSBExchangeCoordinatorData]):
    """Fetch and normalize ADS-B aircraft data."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.config_entry = entry
        self._session = async_get_clientsession(hass)
        self._targets = parse_tracked_aircraft(self._config(CONF_TRACKED_AIRCRAFT))
        self._source_url = str(self._config(CONF_DATA_URL))
        self._api_key = str(self._config(CONF_API_KEY) or "").strip()
        self._enable_nearby = bool(self._config(CONF_ENABLE_NEARBY))
        self._nearby_radius_nm = float(self._config(CONF_NEARBY_RADIUS))
        self._home_latitude = hass.config.latitude
        self._home_longitude = hass.config.longitude
        self._timeout = int(self._config(CONF_REQUEST_TIMEOUT))

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}:{entry.title}",
            update_interval=timedelta(seconds=int(self._config(CONF_SCAN_INTERVAL))),
        )

    @property
    def targets(self) -> tuple[str, ...]:
        """Return tracked identifiers configured for this entry."""
        return self._targets

    @property
    def nearby_enabled(self) -> bool:
        """Return True when nearby mode is enabled."""
        return self._enable_nearby

    @property
    def nearby_radius_nm(self) -> float:
        """Return the configured nearby search radius."""
        return self._nearby_radius_nm

    @property
    def home_latitude(self) -> float | None:
        """Return the configured Home Assistant latitude."""
        return self._home_latitude

    @property
    def home_longitude(self) -> float | None:
        """Return the configured Home Assistant longitude."""
        return self._home_longitude

    @property
    def source_url(self) -> str:
        """Return the configured data source URL."""
        return self._source_url

    def _config(self, key: str) -> Any:
        """Get a config value with options preferred over data."""
        return self.config_entry.options.get(key, self.config_entry.data.get(key))

    def aircraft_for_target(self, target: str) -> dict[str, Any] | None:
        """Return the latest aircraft summary for a target."""
        if self.data is None:
            return None
        return self.data.aircraft_by_target.get(target)

    def _is_official_api_source(self) -> bool:
        """Return True when the configured source is the official ADS-B Exchange API."""
        parsed = urlsplit(self._source_url)
        return parsed.netloc.lower() == OFFICIAL_API_HOST and parsed.path.startswith(
            OFFICIAL_API_BASE_PATH
        )

    def _official_api_base_url(self) -> str:
        """Normalize any official API URL to the base API path."""
        parsed = urlsplit(self._source_url)
        return urlunsplit((parsed.scheme, parsed.netloc, OFFICIAL_API_BASE_PATH, "", ""))

    def _is_opensky_source(self) -> bool:
        """Return True when the configured source is OpenSky."""
        parsed = urlsplit(self._source_url)
        return parsed.netloc.lower() == OPENSKY_API_HOST and parsed.path.startswith(OPENSKY_API_PATH)

    def _opensky_base_url(self) -> str:
        """Normalize any OpenSky URL to the states endpoint."""
        parsed = urlsplit(self._source_url)
        return urlunsplit((parsed.scheme, parsed.netloc, OPENSKY_API_PATH, "", ""))

    async def _async_api_request(
        self,
        method: str,
        url: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Perform an authenticated request to the official ADS-B Exchange API."""
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
        }
        if self._api_key:
            headers["x-api-key"] = self._api_key

        try:
            async with self._session.request(
                method,
                url,
                json=json_body,
                headers=headers,
                timeout=ClientTimeout(total=self._timeout),
            ) as response:
                response.raise_for_status()
                payload = await response.json(content_type=None)
        except ClientResponseError as err:
            if err.status in (402, 403):
                raise UpdateFailed(
                    "ADS-B Exchange API rejected the request. Verify the API key and subscription "
                    f"for {self._official_api_base_url()}."
                ) from err
            if err.status == 429:
                raise UpdateFailed(
                    "ADS-B Exchange API rate limit exceeded. Increase the scan interval and try again."
                ) from err
            raise UpdateFailed(f"Unable to fetch ADS-B data: HTTP {err.status}") from err
        except (ClientError, TimeoutError, ValueError) as err:
            raise UpdateFailed(f"Unable to fetch ADS-B data: {err}") from err

        if not isinstance(payload, dict):
            raise UpdateFailed("ADS-B Exchange API returned an unexpected response")
        return payload

    async def _async_fetch_official_api_data(self) -> tuple[list[dict[str, Any]], str | None]:
        """Fetch aircraft data for the tracked targets via the official ADS-B Exchange API."""
        base_url = self._official_api_base_url()
        hex_targets = [target for target in self._targets if is_hex_identifier(target)]
        named_targets = [target for target in self._targets if target not in hex_targets]

        requests: list[Any] = []
        if hex_targets:
            payload = {"hex_list": list(hex_targets)}
            if len(hex_targets) == 1:
                payload["hex_list"].append("")
            requests.append(self._async_api_request("POST", f"{base_url}/hex", json_body=payload))

        if named_targets:
            requests.append(
                self._async_api_request(
                    "POST",
                    f"{base_url}/registration",
                    json_body={"registrations": named_targets},
                )
            )
            encoded_callsigns = quote(",".join(named_targets), safe=",")
            requests.append(
                self._async_api_request("GET", f"{base_url}/callsign/{encoded_callsigns}")
            )

        if self._enable_nearby:
            if self._home_latitude is None or self._home_longitude is None:
                raise UpdateFailed(
                    "Nearby mode requires Home Assistant latitude and longitude to be configured."
                )
            nearby_url = (
                f"{base_url}/lat/{self._home_latitude}/lon/{self._home_longitude}/dist/"
                f"{self._nearby_radius_nm}"
            )
            requests.append(self._async_api_request("GET", nearby_url))

        if not requests:
            return [], None

        payloads = await asyncio.gather(*requests)
        raw_aircraft: list[dict[str, Any]] = []
        source_timestamp: float | None = None

        for payload in payloads:
            aircraft_items = payload.get("ac", [])
            if isinstance(aircraft_items, list):
                raw_aircraft.extend(item for item in aircraft_items if isinstance(item, dict))

            payload_now = payload.get("now")
            if isinstance(payload_now, (int, float)):
                payload_now_float = float(payload_now)
                source_timestamp = (
                    payload_now_float
                    if source_timestamp is None
                    else max(source_timestamp, payload_now_float)
                )

        deduplicated: dict[str, dict[str, Any]] = {}
        for aircraft in raw_aircraft:
            dedupe_key = str(
                aircraft.get("hex")
                or aircraft.get("r")
                or aircraft.get("flight")
                or f"item-{len(deduplicated)}"
            ).upper()
            deduplicated[dedupe_key] = aircraft

        source_timestamp_iso = None
        if source_timestamp is not None:
            if source_timestamp > 100_000_000_000:
                source_timestamp /= 1000
            source_timestamp_iso = datetime.fromtimestamp(source_timestamp, UTC).isoformat()

        return list(deduplicated.values()), source_timestamp_iso

    async def _async_fetch_opensky_data(self) -> tuple[list[dict[str, Any]], str | None]:
        """Fetch aircraft data via the OpenSky states endpoint."""
        if self._enable_nearby:
            if self._home_latitude is None or self._home_longitude is None:
                raise UpdateFailed(
                    "Nearby mode requires Home Assistant latitude and longitude to be configured."
                )

            latitude_delta = self._nearby_radius_nm / 60
            longitude_scale = max(abs(math.cos(math.radians(self._home_latitude))), 0.01)
            longitude_delta = self._nearby_radius_nm / (60 * longitude_scale)

            lamin = self._home_latitude - latitude_delta
            lamax = self._home_latitude + latitude_delta
            lomin = self._home_longitude - longitude_delta
            lomax = self._home_longitude + longitude_delta

            params = (
                f"lamin={lamin}&lomin={lomin}&lamax={lamax}&lomax={lomax}&extended=1"
            )
        else:
            hex_targets = [target.lower() for target in self._targets if is_hex_identifier(target)]
            non_hex_targets = [target for target in self._targets if not is_hex_identifier(target)]
            if non_hex_targets:
                raise UpdateFailed(
                    "The default OpenSky source supports nearby flights and ICAO hex tracking. "
                    "Use ADS-B Exchange or a local feed for tail-number or callsign-first tracking."
                )
            if not hex_targets:
                return [], None
            params = "&".join(f"icao24={hex_target}" for hex_target in hex_targets)

        url = f"{self._opensky_base_url()}?{params}"

        try:
            async with self._session.get(
                url,
                timeout=ClientTimeout(total=self._timeout),
                headers={"Accept": "application/json"},
            ) as response:
                response.raise_for_status()
                payload = await response.json(content_type=None)
        except ClientResponseError as err:
            if err.status == 429:
                raise UpdateFailed(
                    "OpenSky rate limit exceeded. Increase the scan interval or reduce the nearby radius."
                ) from err
            raise UpdateFailed(f"Unable to fetch OpenSky data: HTTP {err.status}") from err
        except (ClientError, TimeoutError, ValueError) as err:
            raise UpdateFailed(f"Unable to fetch OpenSky data: {err}") from err

        if not isinstance(payload, dict):
            raise UpdateFailed("OpenSky returned an unexpected response")

        response_time = payload.get("time")
        raw_states = payload.get("states", [])
        if not isinstance(raw_states, list):
            raise UpdateFailed("OpenSky response did not contain state vectors")

        aircraft: list[dict[str, Any]] = []
        for state in raw_states:
            if not isinstance(state, list):
                continue
            normalized_state = opensky_state_to_aircraft(state, response_time)
            if normalized_state is not None:
                aircraft.append(normalized_state)

        source_timestamp_iso = None
        if isinstance(response_time, (int, float)):
            source_timestamp_iso = datetime.fromtimestamp(float(response_time), UTC).isoformat()

        return aircraft, source_timestamp_iso

    async def _async_update_data(self) -> ADSBExchangeCoordinatorData:
        fetched_at = datetime.now(UTC)
        target_lookup = {target: target for target in self._targets}
        aircraft_by_target: dict[str, dict[str, Any] | None] = {
            target: None for target in self._targets
        }
        aircraft_by_hex: dict[str, dict[str, Any]] = {}

        source_timestamp_iso: str | None = None
        if self._source_url.rstrip("/") == BLOCKED_PUBLIC_FEED_URL.rstrip("/"):
            raise UpdateFailed(
                "ADS-B Exchange blocks the public globe aircraft.json feed. Configure an API key with "
                f"{self._official_api_base_url()} or point the integration at your own tar1090/readsb aircraft.json feed."
            )

        if self._is_official_api_source():
            raw_aircraft, source_timestamp_iso = await self._async_fetch_official_api_data()
        elif self._is_opensky_source():
            raw_aircraft, source_timestamp_iso = await self._async_fetch_opensky_data()
        else:
            try:
                async with self._session.get(
                    self._source_url,
                    timeout=ClientTimeout(total=self._timeout),
                ) as response:
                    response.raise_for_status()
                    payload = await response.json(content_type=None)
            except ClientResponseError as err:
                if err.status == 403 and self._source_url.rstrip("/") == BLOCKED_PUBLIC_FEED_URL.rstrip("/"):
                    raise UpdateFailed(
                        "ADS-B Exchange blocks the public globe aircraft.json feed. Configure an API key with "
                        f"{self._official_api_base_url()} or point the integration at your own tar1090/readsb aircraft.json feed."
                    ) from err
                raise UpdateFailed(f"Unable to fetch ADS-B data: HTTP {err.status}") from err
            except (ClientError, TimeoutError, ValueError) as err:
                raise UpdateFailed(f"Unable to fetch ADS-B data: {err}") from err

            raw_aircraft = payload.get(ATTR_AIRCRAFT, [])
            if not isinstance(raw_aircraft, list):
                raise UpdateFailed("ADS-B feed did not contain an aircraft list")

            source_timestamp = payload.get("now")
            if isinstance(source_timestamp, (int, float, str)):
                try:
                    source_timestamp_value = float(source_timestamp)
                except (TypeError, ValueError):
                    source_timestamp_value = None
                if source_timestamp_value is not None:
                    if source_timestamp_value > 100_000_000_000:
                        source_timestamp_value /= 1000
                    source_timestamp_iso = datetime.fromtimestamp(source_timestamp_value, UTC).isoformat()

        for raw_aircraft_data in raw_aircraft:
            if not isinstance(raw_aircraft_data, dict):
                continue

            summary = summarize_aircraft(raw_aircraft_data, fetched_at)
            matches: list[tuple[str, str]] = []
            for normalized_value, match_type in aircraft_candidates(raw_aircraft_data).items():
                if normalized_value in target_lookup:
                    matches.append((target_lookup[normalized_value], match_type))

            distance_nm = None
            is_nearby = False
            if (
                self._enable_nearby
                and self._home_latitude is not None
                and self._home_longitude is not None
                and summary.get("latitude") is not None
                and summary.get("longitude") is not None
            ):
                distance_nm = haversine_distance_nm(
                    self._home_latitude,
                    self._home_longitude,
                    summary["latitude"],
                    summary["longitude"],
                )
                is_nearby = distance_nm <= self._nearby_radius_nm

            if not matches and not is_nearby:
                continue

            summary[ATTR_MATCHED_TARGETS] = sorted({target for target, _ in matches})
            summary["match_types"] = sorted({match_type for _, match_type in matches})
            summary["distance_nm"] = round(distance_nm, 2) if distance_nm is not None else None
            summary["is_nearby"] = is_nearby

            aircraft_key = summary.get("icao_hex") or ",".join(summary[ATTR_MATCHED_TARGETS])
            existing_aircraft = aircraft_by_hex.get(aircraft_key)
            if existing_aircraft is None:
                aircraft_by_hex[aircraft_key] = summary
            else:
                existing_aircraft[ATTR_MATCHED_TARGETS] = sorted(
                    set(existing_aircraft[ATTR_MATCHED_TARGETS]) | set(summary[ATTR_MATCHED_TARGETS])
                )
                existing_aircraft["match_types"] = sorted(
                    set(existing_aircraft["match_types"]) | set(summary["match_types"])
                )

            for target, match_type in matches:
                target_summary = dict(summary)
                target_summary["tracked_target"] = target
                target_summary["primary_match_type"] = match_type
                current = aircraft_by_target[target]
                current_seen = float("inf") if current is None or current["seen_seconds"] is None else current["seen_seconds"]
                new_seen = float("inf") if target_summary["seen_seconds"] is None else target_summary["seen_seconds"]
                if current is None or new_seen < current_seen:
                    aircraft_by_target[target] = target_summary

        aircraft_list = sorted(
            aircraft_by_hex.values(),
            key=lambda item: (
                item["seen_seconds"] if item["seen_seconds"] is not None else float("inf"),
                item.get("tail_number") or item.get("icao_hex") or "",
            ),
        )

        return ADSBExchangeCoordinatorData(
            aircraft_by_target=aircraft_by_target,
            aircraft=aircraft_list,
            source_url=self._source_url,
            fetched_at=fetched_at.isoformat(),
            source_timestamp=source_timestamp_iso,
            nearby_enabled=self._enable_nearby,
            nearby_radius_nm=self._nearby_radius_nm,
            home_latitude=self._home_latitude,
            home_longitude=self._home_longitude,
        )
