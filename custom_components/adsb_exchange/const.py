from homeassistant.const import Platform

DOMAIN = "adsb_exchange"

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.DEVICE_TRACKER]

CONF_DATA_URL = "data_url"
CONF_MAP_URL = "map_url"
CONF_API_KEY = "api_key"
CONF_ENABLE_NEARBY = "enable_nearby"
CONF_NEARBY_RADIUS = "nearby_radius"
CONF_REQUEST_TIMEOUT = "request_timeout"
CONF_TRACKED_AIRCRAFT = "tracked_aircraft"
CONF_SCAN_INTERVAL = "scan_interval"

DEFAULT_NAME = "Nearby Flights"
DEFAULT_DATA_URL = "https://opensky-network.org/api/states/all"
DEFAULT_MAP_URL = "https://globe.adsbexchange.com/"
DEFAULT_API_KEY = ""
DEFAULT_ENABLE_NEARBY = True
DEFAULT_NEARBY_RADIUS = 25.0
DEFAULT_REQUEST_TIMEOUT = 15
DEFAULT_SCAN_INTERVAL = 300

ATTR_AIRCRAFT = "aircraft"
ATTR_MATCHED_TARGETS = "matched_targets"

BLOCKED_PUBLIC_FEED_URL = "https://globe.adsbexchange.com/data/aircraft.json"
OFFICIAL_API_HOST = "gateway.adsbexchange.com"
OFFICIAL_API_BASE_PATH = "/api/aircraft/v2"
OPENSKY_API_HOST = "opensky-network.org"
OPENSKY_API_PATH = "/api/states/all"

FRONTEND_DIRECTORY = "frontend"
FRONTEND_FILE = "adsb-exchange-map-card.js"
FRONTEND_URL_BASE = f"/api/{DOMAIN}/{FRONTEND_DIRECTORY}"
FRONTEND_RESOURCE_URL = f"{FRONTEND_URL_BASE}/{FRONTEND_FILE}"
