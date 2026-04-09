from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_NAME
from homeassistant.core import callback

from .const import (
    BLOCKED_PUBLIC_FEED_URL,
    CONF_API_KEY,
    CONF_DATA_URL,
    CONF_ENABLE_NEARBY,
    CONF_MAP_URL,
    CONF_NEARBY_RADIUS,
    CONF_REQUEST_TIMEOUT,
    CONF_SCAN_INTERVAL,
    CONF_TRACKED_AIRCRAFT,
    DEFAULT_DATA_URL,
    DEFAULT_API_KEY,
    DEFAULT_ENABLE_NEARBY,
    DEFAULT_MAP_URL,
    DEFAULT_NAME,
    DEFAULT_NEARBY_RADIUS,
    DEFAULT_REQUEST_TIMEOUT,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    OFFICIAL_API_HOST,
    OPENSKY_API_HOST,
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
        vol.Optional(CONF_API_KEY, default=defaults[CONF_API_KEY]): str,
        vol.Required(
            CONF_ENABLE_NEARBY,
            default=defaults[CONF_ENABLE_NEARBY],
        ): bool,
        vol.Required(
            CONF_NEARBY_RADIUS,
            default=defaults[CONF_NEARBY_RADIUS],
        ): vol.All(vol.Coerce(float), vol.Range(min=1, max=250)),
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
        CONF_API_KEY: data.get(CONF_API_KEY, DEFAULT_API_KEY),
        CONF_ENABLE_NEARBY: data.get(CONF_ENABLE_NEARBY, DEFAULT_ENABLE_NEARBY),
        CONF_NEARBY_RADIUS: data.get(CONF_NEARBY_RADIUS, DEFAULT_NEARBY_RADIUS),
        CONF_MAP_URL: data.get(CONF_MAP_URL, DEFAULT_MAP_URL),
        CONF_SCAN_INTERVAL: data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
        CONF_REQUEST_TIMEOUT: data.get(CONF_REQUEST_TIMEOUT, DEFAULT_REQUEST_TIMEOUT),
    }


def _normalize_input(user_input: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, str]]:
    errors: dict[str, str] = {}

    tracked_aircraft = parse_tracked_aircraft(user_input[CONF_TRACKED_AIRCRAFT])
    enable_nearby = bool(user_input[CONF_ENABLE_NEARBY])
    nearby_radius = float(user_input[CONF_NEARBY_RADIUS])
    if not tracked_aircraft and not enable_nearby:
        errors["base"] = "no_mode_selected"

    if not _valid_url(user_input[CONF_DATA_URL]) or not _valid_url(user_input[CONF_MAP_URL]):
        errors["base"] = "invalid_url"

    parsed_data_url = urlparse(user_input[CONF_DATA_URL].strip())
    normalized_data_url = user_input[CONF_DATA_URL].strip().rstrip("/")
    api_key = user_input.get(CONF_API_KEY, "").strip()

    if normalized_data_url == BLOCKED_PUBLIC_FEED_URL.rstrip("/"):
        errors["base"] = "unsupported_public_feed"
    elif parsed_data_url.netloc.lower() == OFFICIAL_API_HOST and not api_key:
        errors["base"] = "api_key_required"
    elif parsed_data_url.netloc.lower() == OPENSKY_API_HOST and nearby_radius > 100:
        errors["base"] = "opensky_radius_too_large"

    if errors:
        return None, errors

    normalized = {
        CONF_TRACKED_AIRCRAFT: tracked_aircraft,
        CONF_DATA_URL: user_input[CONF_DATA_URL].strip(),
        CONF_API_KEY: api_key,
        CONF_ENABLE_NEARBY: enable_nearby,
        CONF_NEARBY_RADIUS: nearby_radius,
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
