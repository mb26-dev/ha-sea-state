"""Shark information for surf spots (pure, no Home Assistant imports).

This is background information, not a live warning: which shark species are part
of the local ecosystem, which safety measures exist, and where the official live
service for the area is. Live sightings, detections and beach closures are only
published by those services (apps, websites, social media), so the card links to
them instead of repeating outdated information.

Keep the wording calm and factual. Shark bites are rare; the goal is that a surfer
knows where to check before paddling out.
"""

from __future__ import annotations

from typing import Any

# key: (name, url, what it offers)
SERVICES: dict[str, tuple[str, str, str]] = {
    "sharksmart_wa": (
        "SharkSmart WA",
        "https://www.sharksmart.com.au/shark-activity",
        "Live map of reported sightings and tagged shark detections",
    ),
    "sharksmart_nsw": (
        "SharkSmart NSW",
        "https://www.sharksmart.nsw.gov.au/shark-activity",
        "Tagged shark listening stations, drones and SMART drumlines, alerts in the SharkSmart app",
    ),
    "sharksmart_qld": (
        "SharkSmart Queensland",
        "https://www.dpi.qld.gov.au/news-media/campaigns/sharksmart",
        "Queensland Shark Control Program: nets, drumlines and drones",
    ),
    "vicemergency": (
        "VicEmergency (Victorian Fisheries Authority)",
        "https://vfa.vic.gov.au/education/shark-smart/quick-links/current-sightings-and-warnings",
        "Current shark sightings and warnings in Victoria",
    ),
    "shark_spotters": (
        "Shark Spotters",
        "https://sharkspotters.org.za",
        "Spotters on duty with a four flag warning system and siren",
    ),
    "kzn_sharks_board": (
        "KwaZulu-Natal Sharks Board",
        "https://shark.co.za",
        "Shark nets and drumlines, bathing is closed when the gear is out of the water",
    ),
    "centre_securite_requin": (
        "Centre Sécurité Requin",
        "https://www.info-requin.re",
        "Official shark risk information for Réunion, including where water sports are allowed",
    ),
    "dlnr_hawaii": (
        "Hawaii DLNR Sharks",
        "https://dlnr.hawaii.gov/sharks/",
        "Recent shark incidents and safety information for Hawaii",
    ),
    "cdfw_white_shark": (
        "California Department of Fish and Wildlife",
        "https://wildlife.ca.gov/Conservation/Marine/White-Shark",
        "White sharks in California, incident information and safety tips",
    ),
    "isaf": (
        "International Shark Attack File",
        "https://www.floridamuseum.ufl.edu/shark-attacks/",
        "Confirmed incidents and background for the USA (Florida Museum)",
    ),
}

# area key: (species, measures or None, service key or None)
_AREAS: dict[str, tuple[str, str | None, str | None]] = {
    "hawaii": ("Tiger sharks", None, "dlnr_hawaii"),
    "california_north": ("White sharks, adults visit the coast in autumn", None, "cdfw_white_shark"),
    "california_south": ("Juvenile white sharks along the beaches, mostly in summer", None, "cdfw_white_shark"),
    "us_east": ("Bull, blacktip and spinner sharks close to the beach in summer", None, "isaf"),
    "ny": ("Juvenile white sharks and sand tiger sharks in summer", None, "isaf"),
    "wa_south": ("White sharks", "Tagged shark monitoring network", "sharksmart_wa"),
    "nsw": ("White, bull and tiger sharks", "Listening stations, drones and SMART drumlines", "sharksmart_nsw"),
    "qld": ("Bull and tiger sharks", "Nets, drumlines and drones at popular beaches", "sharksmart_qld"),
    "vic": ("White sharks and bronze whalers", None, "vicemergency"),
    "tas": ("White sharks", None, None),
    "cape_town": ("White sharks", "Shark Spotters on duty at popular beaches", "shark_spotters"),
    "cape_town_west": ("White sharks", None, "shark_spotters"),
    "eastern_cape": ("White sharks", None, None),
    "kzn": ("Bull (Zambezi), tiger and white sharks", "Shark nets and drumlines", "kzn_sharks_board"),
    "reunion": ("Bull and tiger sharks", "Water sports are restricted outside supervised zones", "centre_securite_requin"),
}

# spot id: area key
SPOT_AREAS: dict[str, str] = {
    # Hawaii
    "pipeline": "hawaii",
    "sunset_beach": "hawaii",
    "waimea_bay": "hawaii",
    "jaws": "hawaii",
    "honolua_bay": "hawaii",
    "waikiki": "hawaii",
    "ala_moana_bowls": "hawaii",
    # California
    "mavericks": "california_north",
    "ocean_beach_sf": "california_north",
    "steamer_lane": "california_north",
    "rincon": "california_south",
    "malibu": "california_south",
    "huntington": "california_south",
    "trestles": "california_south",
    "blacks": "california_south",
    # US East Coast
    "cape_hatteras": "us_east",
    "cocoa_beach": "us_east",
    "ditch_plains": "ny",
    # Australia
    "margaret_river": "wa_south",
    "the_pass": "nsw",
    "north_narrabeen": "nsw",
    "bondi": "nsw",
    "snapper_rocks": "qld",
    "kirra": "qld",
    "burleigh_heads": "qld",
    "noosa": "qld",
    "bells_beach": "vic",
    "shipstern": "tas",
    # South Africa
    "muizenberg": "cape_town",
    "dungeons": "cape_town_west",
    "jeffreys_bay": "eastern_cape",
    "durban": "kzn",
    # Réunion
    "saint_leu": "reunion",
}


def shark_info(spot_id: str) -> dict[str, Any] | None:
    """Shark background for a spot, or None outside the known shark areas."""
    area = SPOT_AREAS.get(spot_id)
    if area is None:
        return None
    species, measures, service = _AREAS[area]
    out: dict[str, Any] = {"area": area, "species": species, "measures": measures, "service": None}
    if service:
        name, url, offers = SERVICES[service]
        out["service"] = {"key": service, "name": name, "url": url, "offers": offers}
    return out
