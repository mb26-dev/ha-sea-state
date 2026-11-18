"""Constants for Sea State Forecast."""

from __future__ import annotations

DOMAIN = "sea_state"
NAME = "Sea State Forecast"
VERSION = "0.1.0b6"

CONF_SOURCES = "sources"
CONF_HOME_SPOT = "home_spot"
CONF_WATCHED = "watched_spots"
CONF_CUSTOM_SPOTS = "custom_spots"
CONF_FIRING = "firing_rating"
CONF_CYCLONE_RADIUS = "cyclone_radius_km"
CONF_GRID_HOURS = "grid_hours"

SOURCE_OCEAN = "ocean"
SOURCE_WEATHER = "weather"
SOURCE_SPOTS = "spots"
SOURCE_CYCLONES = "cyclones"
SOURCES = [SOURCE_OCEAN, SOURCE_WEATHER, SOURCE_SPOTS, SOURCE_CYCLONES]
SOURCE_LABELS = {
    SOURCE_OCEAN: "Global waves (Open-Meteo Marine)",
    SOURCE_WEATHER: "Global wind, clouds, rain and pressure (Open-Meteo)",
    SOURCE_SPOTS: "Surf spot forecasts (Open-Meteo Marine and Forecast)",
    SOURCE_CYCLONES: "Tropical cyclones (GDACS)",
}
DEFAULT_SOURCES = list(SOURCES)
HOME_NEAREST = "nearest"
DEFAULT_HOME_SPOT = HOME_NEAREST
DEFAULT_WATCHED: list[str] = []
DEFAULT_CUSTOM_SPOTS = ""
DEFAULT_FIRING = 3.5
DEFAULT_CYCLONE_RADIUS = 800
DEFAULT_GRID_HOURS = "12"
GRID_HOURS_OPTIONS = ["6", "12", "24"]

# polling
UPDATE_INTERVAL_MINUTES = 5
SPOT_MINUTES = 360
CYCLONE_MINUTES = 30
BACKOFF_MINUTES = 60
RATE_LIMIT_BACKOFF_MINUTES = 120
SOURCE_DOWN_HOURS = 24
# pause between two request chunks, keeps far below 600 calls per minute
CHUNK_PAUSE_SECONDS = 30
LAND_MASK_DAYS = 30

# Earth imagery for the globe, NASA Earth Observatory (credit "NASA Earth Observatory").
# Downloaded at runtime, not shipped. Re-used from Orbitarium or Magmarium when installed.
EARTH_DAY_URL = (
    "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/"
    "bmng-topography-bathymetry/{month_name}/world.topo.bathy.2004{month:02d}.3x5400x2700.jpg"
)
EARTH_DAY_FALLBACK_MONTH = 9
EARTH_NIGHT_URL = (
    "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/"
    "144000/144898/BlackMarble_2016_01deg.jpg"
)
EARTH_DIR = "sea_state"
SHARED_EARTH_DIRS = ("orbitarium", "magmarium")

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.state"
CACHE_DIR = "sea_state"

URL_DATA = "/api/sea_state/data"
URL_GRID = "/api/sea_state/grid"
URL_EARTH = "/api/sea_state/earth/{kind}"
URL_FRONTEND = "/sea_state/frontend"
CARD_FILE = "sea-state-card.js"
