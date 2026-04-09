from __future__ import annotations

from typing import Any

from homeassistant.components.device_tracker import SourceType, TrackerEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import ADSBExchangeRuntimeData
from .const import DOMAIN
from .coordinator import ADSBExchangeCoordinator
from .helpers import identifier_slug


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up ADS-B Exchange tracker entities."""
    runtime_data: ADSBExchangeRuntimeData = hass.data[DOMAIN][entry.entry_id]
    coordinator = runtime_data.coordinator

    async_add_entities(
        ADSBExchangeAircraftTracker(coordinator, entry, target)
        for target in coordinator.targets
    )


class ADSBExchangeAircraftTracker(CoordinatorEntity[ADSBExchangeCoordinator], TrackerEntity):
    """Represent the current aircraft position."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:airplane-marker"

    def __init__(
        self,
        coordinator: ADSBExchangeCoordinator,
        entry: ConfigEntry,
        target: str,
    ) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._target = target
        self._target_slug = identifier_slug(target)
        self._attr_name = "Location"
        self._attr_unique_id = f"{entry.entry_id}_{self._target_slug}_tracker"

    @property
    def source_type(self) -> SourceType:
        return SourceType.GPS

    @property
    def available(self) -> bool:
        aircraft = self.coordinator.aircraft_for_target(self._target)
        return (
            super().available
            and aircraft is not None
            and aircraft.get("latitude") is not None
            and aircraft.get("longitude") is not None
        )

    @property
    def latitude(self) -> float | None:
        aircraft = self.coordinator.aircraft_for_target(self._target)
        if aircraft is None:
            return None
        return aircraft.get("latitude")

    @property
    def longitude(self) -> float | None:
        aircraft = self.coordinator.aircraft_for_target(self._target)
        if aircraft is None:
            return None
        return aircraft.get("longitude")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        aircraft = self.coordinator.aircraft_for_target(self._target)
        if aircraft is None:
            return {"tracked_target": self._target, "status": "unavailable"}
        return dict(aircraft)

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, f"{self._entry.entry_id}_{self._target_slug}")},
            manufacturer="ADS-B Exchange",
            model="Tracked Aircraft",
            name=f"{self._entry.title} {self._target}",
        )
