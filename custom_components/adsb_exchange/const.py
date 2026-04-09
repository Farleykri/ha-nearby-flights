from homeassistant.const import Platform

DOMAIN = "adsb_exchange"

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.DEVICE_TRACKER]

CONF_DATA_URL = "data_url"
CONF_MAP_URL = "map_url"
CONF_REQUEST_TIMEOUT = "request_timeout"
CONF_TRACKED_AIRCRAFT = "tracked_aircraft"
CONF_SCAN_INTERVAL = "scan_interval"

DEFAULT_NAME = "ADS-B Exchange Watchlist"
DEFAULT_DATA_URL = "https://globe.adsbexchange.com/data/aircraft.json"
DEFAULT_MAP_URL = "https://globe.adsbexchange.com/"
DEFAULT_REQUEST_TIMEOUT = 15
DEFAULT_SCAN_INTERVAL = 60

ATTR_AIRCRAFT = "aircraft"
ATTR_MATCHED_TARGETS = "matched_targets"

FRONTEND_DIRECTORY = "frontend"
FRONTEND_FILE = "adsb-exchange-map-card.js"
FRONTEND_URL_BASE = f"/api/{DOMAIN}/{FRONTEND_DIRECTORY}"
FRONTEND_RESOURCE_URL = f"{FRONTEND_URL_BASE}/{FRONTEND_FILE}"
