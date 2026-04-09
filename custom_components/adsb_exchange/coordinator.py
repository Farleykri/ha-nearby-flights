from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import logging
from typing import Any

from aiohttp import ClientError, ClientTimeout

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    ATTR_AIRCRAFT,
    ATTR_MATCHED_TARGETS,
    CONF_DATA_URL,
    CONF_REQUEST_TIMEOUT,
    CONF_SCAN_INTERVAL,
    CONF_TRACKED_AIRCRAFT,
    DOMAIN,
)
from .helpers import aircraft_candidates, parse_tracked_aircraft, summarize_aircraft

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class ADSBExchangeCoordinatorData:
    """Normalized state returned by the coordinator."""

    aircraft_by_target: dict[str, dict[str, Any] | None]
    aircraft: list[dict[str, Any]]
    source_url: str
    fetched_at: str
    source_timestamp: str | None


class ADSBExchangeCoordinator(DataUpdateCoordinator[ADSBExchangeCoordinatorData]):
    """Fetch and normalize ADS-B aircraft data."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.config_entry = entry
        self._session = async_get_clientsession(hass)
        self._targets = parse_tracked_aircraft(self._config(CONF_TRACKED_AIRCRAFT))
        self._source_url = str(self._config(CONF_DATA_URL))
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

    def _config(self, key: str) -> Any:
        """Get a config value with options preferred over data."""
        return self.config_entry.options.get(key, self.config_entry.data.get(key))

    def aircraft_for_target(self, target: str) -> dict[str, Any] | None:
        """Return the latest aircraft summary for a target."""
        if self.data is None:
            return None
        return self.data.aircraft_by_target.get(target)

    async def _async_update_data(self) -> ADSBExchangeCoordinatorData:
        fetched_at = datetime.now(UTC)
        target_lookup = {target: target for target in self._targets}
        aircraft_by_target: dict[str, dict[str, Any] | None] = {
            target: None for target in self._targets
        }
        aircraft_by_hex: dict[str, dict[str, Any]] = {}

        try:
            async with self._session.get(
                self._source_url,
                timeout=ClientTimeout(total=self._timeout),
            ) as response:
                response.raise_for_status()
                payload = await response.json(content_type=None)
        except (ClientError, TimeoutError, ValueError) as err:
            raise UpdateFailed(f"Unable to fetch ADS-B data: {err}") from err

        raw_aircraft = payload.get(ATTR_AIRCRAFT, [])
        if not isinstance(raw_aircraft, list):
            raise UpdateFailed("ADS-B feed did not contain an aircraft list")

        for raw_aircraft_data in raw_aircraft:
            if not isinstance(raw_aircraft_data, dict):
                continue

            matches: list[tuple[str, str]] = []
            for normalized_value, match_type in aircraft_candidates(raw_aircraft_data).items():
                if normalized_value in target_lookup:
                    matches.append((target_lookup[normalized_value], match_type))

            if not matches:
                continue

            summary = summarize_aircraft(raw_aircraft_data, fetched_at)
            summary[ATTR_MATCHED_TARGETS] = sorted({target for target, _ in matches})
            summary["match_types"] = sorted({match_type for _, match_type in matches})

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

        source_timestamp = payload.get("now")
        source_timestamp_iso = None
        if isinstance(source_timestamp, (int, float, str)):
            try:
                source_timestamp_value = float(source_timestamp)
            except (TypeError, ValueError):
                source_timestamp_value = None
            if source_timestamp_value is not None:
                if source_timestamp_value > 100_000_000_000:
                    source_timestamp_value /= 1000
                source_timestamp_iso = datetime.fromtimestamp(source_timestamp_value, UTC).isoformat()

        return ADSBExchangeCoordinatorData(
            aircraft_by_target=aircraft_by_target,
            aircraft=aircraft_list,
            source_url=self._source_url,
            fetched_at=fetched_at.isoformat(),
            source_timestamp=source_timestamp_iso,
        )
