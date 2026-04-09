from __future__ import annotations

from dataclasses import dataclass
import logging
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, FRONTEND_DIRECTORY, FRONTEND_URL_BASE, PLATFORMS
from .coordinator import ADSBExchangeCoordinator

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class ADSBExchangeRuntimeData:
    """Runtime data stored for each config entry."""

    coordinator: ADSBExchangeCoordinator


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up ADS-B Exchange from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    frontend_registered_key = f"{DOMAIN}_frontend_registered"
    if not hass.data.get(frontend_registered_key):
        frontend_path = Path(__file__).parent / FRONTEND_DIRECTORY
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL_BASE, str(frontend_path), False)]
        )
        hass.data[frontend_registered_key] = True

    coordinator = ADSBExchangeCoordinator(hass, entry)
    await coordinator.async_refresh()
    if coordinator.last_exception is not None:
        _LOGGER.warning(
            "ADS-B Exchange started without live aircraft data for %s: %s",
            entry.title,
            coordinator.last_exception,
        )

    hass.data[DOMAIN][entry.entry_id] = ADSBExchangeRuntimeData(coordinator=coordinator)
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload an ADS-B Exchange config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the config entry after an options update."""
    await hass.config_entries.async_reload(entry.entry_id)
