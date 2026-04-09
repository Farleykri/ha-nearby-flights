from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import ADSBExchangeRuntimeData
from .const import ATTR_AIRCRAFT, CONF_MAP_URL, DOMAIN
from .coordinator import ADSBExchangeCoordinator
from .helpers import identifier_slug


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up ADS-B Exchange sensor entities."""
    runtime_data: ADSBExchangeRuntimeData = hass.data[DOMAIN][entry.entry_id]
    coordinator = runtime_data.coordinator

    entities: list[SensorEntity] = [ADSBExchangeWatchlistSensor(coordinator, entry)]
    entities.extend(
        ADSBExchangeAircraftSensor(coordinator, entry, target) for target in coordinator.targets
    )
    async_add_entities(entities)


class ADSBExchangeBaseEntity(CoordinatorEntity[ADSBExchangeCoordinator]):
    """Common entity behavior for the integration."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: ADSBExchangeCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._entry = entry

    @property
    def device_info(self) -> DeviceInfo:
        """Return device info for entry-level entities."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            manufacturer="ADS-B Exchange",
            model="Watchlist",
            name=self._entry.title,
        )


class ADSBExchangeWatchlistSensor(ADSBExchangeBaseEntity, SensorEntity):
    """Sensor summarizing all visible tracked aircraft."""

    _attr_icon = "mdi:airplane-search"

    def __init__(self, coordinator: ADSBExchangeCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry)
        self._attr_name = "Watchlist"
        self._attr_unique_id = f"{entry.entry_id}_watchlist"

    @property
    def native_value(self) -> int:
        """Return the number of currently visible aircraft."""
        if self.coordinator.data is None:
            return 0
        return len(self.coordinator.data.aircraft)

    @property
    def available(self) -> bool:
        """Keep the watchlist entity available so the card can render its map fallback."""
        return True

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return detailed watchlist attributes for the custom card."""
        data = self.coordinator.data
        attributes = {
            ATTR_AIRCRAFT: data.aircraft if data is not None else [],
            "tracked_aircraft": list(self.coordinator.targets),
            "nearby_enabled": data.nearby_enabled if data is not None else self.coordinator.nearby_enabled,
            "nearby_radius_nm": data.nearby_radius_nm if data is not None else self.coordinator.nearby_radius_nm,
            "home_latitude": data.home_latitude if data is not None else self.coordinator.home_latitude,
            "home_longitude": data.home_longitude if data is not None else self.coordinator.home_longitude,
            "data_url": data.source_url if data is not None else self.coordinator.source_url,
            "map_url": self._entry.options.get(CONF_MAP_URL, self._entry.data.get(CONF_MAP_URL)),
            "fetched_at": data.fetched_at if data is not None else None,
            "source_timestamp": data.source_timestamp if data is not None else None,
            "entry_title": self._entry.title,
        }

        if self.coordinator.last_exception is not None:
            attributes["last_error"] = str(self.coordinator.last_exception)

        return attributes


class ADSBExchangeAircraftSensor(ADSBExchangeBaseEntity, SensorEntity):
    """Status sensor for a single tracked aircraft."""

    _attr_icon = "mdi:airplane"

    def __init__(
        self,
        coordinator: ADSBExchangeCoordinator,
        entry: ConfigEntry,
        target: str,
    ) -> None:
        super().__init__(coordinator, entry)
        self._target = target
        self._target_slug = identifier_slug(target)
        self._attr_name = "Status"
        self._attr_unique_id = f"{entry.entry_id}_{self._target_slug}_sensor"

    @property
    def available(self) -> bool:
        return super().available and self.coordinator.aircraft_for_target(self._target) is not None

    @property
    def native_value(self) -> str | None:
        aircraft = self.coordinator.aircraft_for_target(self._target)
        if aircraft is None:
            return None
        return aircraft["status"]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        aircraft = self.coordinator.aircraft_for_target(self._target)
        if aircraft is None:
            return {
                "tracked_target": self._target,
                "status": "unavailable",
            }
        return dict(aircraft)

    @property
    def device_info(self) -> DeviceInfo:
        """Group the sensor and tracker under one aircraft device."""
        return DeviceInfo(
            identifiers={(DOMAIN, f"{self._entry.entry_id}_{self._target_slug}")},
            manufacturer="ADS-B Exchange",
            model="Tracked Aircraft",
            name=f"{self._entry.title} {self._target}",
        )
