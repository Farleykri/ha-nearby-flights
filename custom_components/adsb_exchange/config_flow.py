from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_NAME
from homeassistant.core import callback

from .const import (
    CONF_DATA_URL,
    CONF_MAP_URL,
    CONF_REQUEST_TIMEOUT,
    CONF_SCAN_INTERVAL,
    CONF_TRACKED_AIRCRAFT,
    DEFAULT_DATA_URL,
    DEFAULT_MAP_URL,
    DEFAULT_NAME,
    DEFAULT_REQUEST_TIMEOUT,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
)
from .helpers import parse_tracked_aircraft


def _valid_url(value: str) -> bool:
    parsed = urlparse(value)
    return bool(parsed.scheme and parsed.netloc)


def _schema(defaults: dict[str, Any], *, include_name: bool) -> vol.Schema:
    fields: dict[Any, Any] = {
        vol.Required(
            CONF_TRACKED_AIRCRAFT,
            default=defaults[CONF_TRACKED_AIRCRAFT],
        ): str,
        vol.Required(CONF_DATA_URL, default=defaults[CONF_DATA_URL]): str,
        vol.Required(CONF_MAP_URL, default=defaults[CONF_MAP_URL]): str,
        vol.Required(
            CONF_SCAN_INTERVAL,
            default=defaults[CONF_SCAN_INTERVAL],
        ): vol.All(vol.Coerce(int), vol.Range(min=15, max=3600)),
        vol.Required(
            CONF_REQUEST_TIMEOUT,
            default=defaults[CONF_REQUEST_TIMEOUT],
        ): vol.All(vol.Coerce(int), vol.Range(min=5, max=120)),
    }

    if include_name:
        fields = {
            vol.Required(CONF_NAME, default=defaults[CONF_NAME]): str,
            **fields,
        }

    return vol.Schema(fields)


def _defaults(data: dict[str, Any]) -> dict[str, Any]:
    return {
        CONF_NAME: data.get(CONF_NAME, DEFAULT_NAME),
        CONF_TRACKED_AIRCRAFT: ",".join(data.get(CONF_TRACKED_AIRCRAFT, ())),
        CONF_DATA_URL: data.get(CONF_DATA_URL, DEFAULT_DATA_URL),
        CONF_MAP_URL: data.get(CONF_MAP_URL, DEFAULT_MAP_URL),
        CONF_SCAN_INTERVAL: data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
        CONF_REQUEST_TIMEOUT: data.get(CONF_REQUEST_TIMEOUT, DEFAULT_REQUEST_TIMEOUT),
    }


def _normalize_input(user_input: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, str]]:
    errors: dict[str, str] = {}

    tracked_aircraft = parse_tracked_aircraft(user_input[CONF_TRACKED_AIRCRAFT])
    if not tracked_aircraft:
        errors["base"] = "at_least_one_aircraft"

    if not _valid_url(user_input[CONF_DATA_URL]) or not _valid_url(user_input[CONF_MAP_URL]):
        errors["base"] = "invalid_url"

    if errors:
        return None, errors

    normalized = {
        CONF_TRACKED_AIRCRAFT: tracked_aircraft,
        CONF_DATA_URL: user_input[CONF_DATA_URL].strip(),
        CONF_MAP_URL: user_input[CONF_MAP_URL].strip(),
        CONF_SCAN_INTERVAL: int(user_input[CONF_SCAN_INTERVAL]),
        CONF_REQUEST_TIMEOUT: int(user_input[CONF_REQUEST_TIMEOUT]),
    }
    if CONF_NAME in user_input:
        normalized[CONF_NAME] = user_input[CONF_NAME].strip() or DEFAULT_NAME
    return normalized, errors


class ADSBExchangeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle an ADS-B Exchange config flow."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            normalized, errors = _normalize_input(user_input)
            if normalized is not None:
                title = normalized.pop(CONF_NAME)
                return self.async_create_entry(title=title, data=normalized)
        else:
            errors = {}

        return self.async_show_form(
            step_id="user",
            data_schema=_schema(_defaults(user_input or {}), include_name=True),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return ADSBExchangeOptionsFlow(config_entry)


class ADSBExchangeOptionsFlow(config_entries.OptionsFlow):
    """Handle ADS-B Exchange options."""

    def __init__(self, config_entry) -> None:
        self.config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            normalized, errors = _normalize_input(user_input)
            if normalized is not None:
                return self.async_create_entry(title="", data=normalized)
        else:
            errors = {}

        combined_data = {**self.config_entry.data, **self.config_entry.options}
        return self.async_show_form(
            step_id="init",
            data_schema=_schema(_defaults(combined_data), include_name=False),
            errors=errors,
        )
