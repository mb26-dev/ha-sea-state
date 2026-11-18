"""Built-in surf spot catalogue (pure, no Home Assistant imports).

Every spot: id, name, area, country, lat, lon, swell window centre (direction the
ideal swell comes FROM, degrees), half width of the window (degrees), kind of break,
surf size range in metres (min, ideal, max) and the surf region for the card.

The offshore wind blows from the land towards the sea, so it comes from the
opposite direction of the swell window centre unless a spot sets its own value.

Positions and windows are approximate (good enough for a model based rating).
Corrections are welcome as GitHub issues.
"""

from __future__ import annotations

from typing import Any

# kind: reef, point, beach, rivermouth, bigwave
# (id, name, area, country, lat, lon, swell_from, window, kind, (min, ideal, max), region, offshore_from or None)
_RAW: list[tuple[Any, ...]] = [
    # ---------------------------------------------------------------- Hawaii
    ("pipeline", "Pipeline", "North Shore, Oahu", "USA", 21.665, -158.053, 315, 40, "reef", (1.5, 3.0, 6.0), "hawaii", 135),
    ("sunset_beach", "Sunset Beach", "North Shore, Oahu", "USA", 21.678, -158.041, 320, 40, "reef", (1.5, 3.5, 7.0), "hawaii", 135),
    ("waimea_bay", "Waimea Bay", "North Shore, Oahu", "USA", 21.642, -158.066, 320, 35, "bigwave", (4.0, 7.0, 12.0), "hawaii", 120),
    ("jaws", "Jaws (Pe'ahi)", "Maui", "USA", 20.942, -156.297, 330, 35, "bigwave", (5.0, 10.0, 20.0), "hawaii", 160),
    ("honolua_bay", "Honolua Bay", "Maui", "USA", 21.015, -156.638, 315, 35, "point", (1.0, 2.5, 5.0), "hawaii", 120),
    ("waikiki", "Waikiki (Queens)", "South Shore, Oahu", "USA", 21.272, -157.827, 190, 40, "reef", (0.5, 1.2, 3.0), "hawaii", 20),
    ("ala_moana_bowls", "Ala Moana Bowls", "South Shore, Oahu", "USA", 21.287, -157.852, 190, 35, "reef", (1.0, 2.0, 3.5), "hawaii", 20),
    # ------------------------------------------------------- California & Canada
    ("mavericks", "Mavericks", "Half Moon Bay, California", "USA", 37.494, -122.501, 290, 30, "bigwave", (5.0, 9.0, 18.0), "california", 100),
    ("ocean_beach_sf", "Ocean Beach", "San Francisco, California", "USA", 37.759, -122.511, 280, 40, "beach", (1.0, 2.0, 3.5), "california", 100),
    ("steamer_lane", "Steamer Lane", "Santa Cruz, California", "USA", 36.951, -122.026, 250, 50, "point", (1.0, 2.0, 4.0), "california", 20),
    ("rincon", "Rincon", "Santa Barbara, California", "USA", 34.373, -119.478, 275, 35, "point", (1.0, 2.0, 4.0), "california", 30),
    ("malibu", "Malibu (Surfrider)", "Los Angeles, California", "USA", 34.032, -118.679, 200, 35, "point", (0.5, 1.5, 3.0), "california", 20),
    ("huntington", "Huntington Beach Pier", "Orange County, California", "USA", 33.655, -118.004, 210, 50, "beach", (0.5, 1.5, 3.0), "california", 30),
    ("trestles", "Trestles (Lowers)", "San Clemente, California", "USA", 33.382, -117.589, 205, 40, "point", (0.5, 1.5, 3.0), "california", 45),
    ("blacks", "Black's Beach", "San Diego, California", "USA", 32.889, -117.253, 270, 45, "beach", (1.0, 2.0, 4.0), "california", 90),
    ("todos_santos", "Todos Santos (Killers)", "Ensenada, Baja California", "Mexico", 31.809, -116.807, 290, 35, "bigwave", (3.0, 6.0, 12.0), "california", 110),
    ("tofino", "Cox Bay", "Tofino, British Columbia", "Canada", 49.100, -125.880, 260, 45, "beach", (1.0, 1.5, 3.0), "california", 80),
    # --------------------------------------------- Mexico & Central America
    ("puerto_escondido", "Puerto Escondido (Zicatela)", "Oaxaca", "Mexico", 15.852, -97.064, 215, 40, "beach", (1.5, 3.0, 7.0), "central_america", 35),
    ("barra_de_la_cruz", "Barra de la Cruz", "Oaxaca", "Mexico", 15.840, -95.950, 190, 35, "point", (1.0, 1.8, 3.0), "central_america", 10),
    ("popoyo", "Popoyo", "Rivas", "Nicaragua", 11.457, -86.124, 220, 40, "reef", (1.0, 2.0, 3.5), "central_america", 60),
    ("punta_roca", "Punta Roca", "La Libertad", "El Salvador", 13.488, -89.385, 200, 35, "point", (1.0, 2.0, 3.5), "central_america", 20),
    ("santa_teresa", "Santa Teresa", "Nicoya", "Costa Rica", 9.643, -85.168, 220, 45, "beach", (0.8, 1.5, 3.0), "central_america", 50),
    ("playa_hermosa_cr", "Playa Hermosa", "Jaco", "Costa Rica", 9.565, -84.596, 220, 45, "beach", (1.0, 1.5, 3.0), "central_america", 40),
    ("pavones", "Pavones", "Golfo Dulce", "Costa Rica", 8.393, -83.142, 190, 30, "point", (1.0, 2.0, 3.5), "central_america", 10),
    ("santa_catalina", "Santa Catalina", "Veraguas", "Panama", 7.630, -81.240, 200, 40, "reef", (1.0, 2.0, 3.5), "central_america", 20),
    # -------------------------------------------------------- South America
    ("chicama", "Chicama", "La Libertad", "Peru", -7.700, -79.440, 225, 35, "point", (1.0, 1.5, 3.0), "south_america", 90),
    ("pico_alto", "Pico Alto", "Lima", "Peru", -12.490, -76.800, 225, 35, "bigwave", (4.0, 6.0, 12.0), "south_america", 60),
    ("punta_de_lobos", "Punta de Lobos", "Pichilemu", "Chile", -34.430, -72.050, 235, 35, "point", (1.5, 3.0, 8.0), "south_america", 90),
    ("el_gringo", "El Gringo", "Arica", "Chile", -18.483, -70.330, 260, 35, "reef", (1.5, 2.5, 5.0), "south_america", 90),
    ("montanita", "Montanita", "Santa Elena", "Ecuador", -1.826, -80.756, 270, 45, "point", (0.8, 1.5, 3.0), "south_america", 90),
    ("joaquina", "Joaquina", "Florianopolis", "Brazil", -27.630, -48.450, 135, 45, "beach", (0.8, 1.5, 3.0), "south_america", 300),
    ("saquarema", "Saquarema (Itauna)", "Rio de Janeiro", "Brazil", -22.935, -42.485, 160, 45, "beach", (1.0, 2.0, 4.0), "south_america", 340),
    ("cacimba", "Cacimba do Padre", "Fernando de Noronha", "Brazil", -3.845, -32.443, 340, 40, "reef", (1.0, 2.0, 4.0), "south_america", 150),
    # ---------------------------------------------- Caribbean & US East Coast
    ("tres_palmas", "Tres Palmas", "Rincon", "Puerto Rico", 18.358, -67.268, 315, 40, "reef", (1.0, 2.0, 5.0), "atlantic_americas", 110),
    ("soup_bowl", "Soup Bowl", "Bathsheba", "Barbados", 13.215, -59.522, 70, 40, "reef", (0.8, 1.5, 3.0), "atlantic_americas", 250),
    ("cape_hatteras", "Cape Hatteras", "Outer Banks, North Carolina", "USA", 35.250, -75.520, 110, 50, "beach", (0.8, 1.5, 3.0), "atlantic_americas", 290),
    ("ditch_plains", "Ditch Plains", "Montauk, New York", "USA", 41.040, -71.920, 180, 45, "reef", (0.8, 1.5, 3.0), "atlantic_americas", 0),
    ("cocoa_beach", "Cocoa Beach", "Florida", "USA", 28.320, -80.600, 80, 50, "beach", (0.5, 1.0, 2.0), "atlantic_americas", 260),
    # ---------------------------------------------------------------- Europe
    ("nazare", "Nazare (Praia do Norte)", "Leiria", "Portugal", 39.607, -9.085, 290, 35, "bigwave", (5.0, 10.0, 25.0), "europe", 100),
    ("supertubos", "Supertubos", "Peniche", "Portugal", 39.345, -9.362, 260, 45, "beach", (1.0, 2.0, 3.5), "europe", 70),
    ("coxos", "Coxos", "Ericeira", "Portugal", 38.988, -9.419, 300, 35, "reef", (1.2, 2.0, 4.0), "europe", 110),
    ("carcavelos", "Carcavelos", "Lisbon", "Portugal", 38.678, -9.335, 220, 40, "beach", (0.8, 1.5, 3.0), "europe", 20),
    ("mundaka", "Mundaka", "Basque Country", "Spain", 43.407, -2.698, 315, 30, "rivermouth", (1.5, 2.5, 4.0), "europe", 160),
    ("zarautz", "Zarautz", "Basque Country", "Spain", 43.287, -2.170, 320, 40, "beach", (0.8, 1.5, 3.0), "europe", 160),
    ("hossegor", "Hossegor (La Graviere)", "Landes", "France", 43.672, -1.443, 290, 40, "beach", (1.0, 2.0, 4.0), "europe", 100),
    ("cote_des_basques", "Cote des Basques", "Biarritz", "France", 43.477, -1.567, 300, 40, "beach", (0.8, 1.5, 3.0), "europe", 120),
    ("la_torche", "La Torche", "Brittany", "France", 47.840, -4.350, 260, 45, "beach", (0.8, 1.5, 3.0), "europe", 80),
    ("fistral", "Fistral Beach", "Newquay, Cornwall", "United Kingdom", 50.418, -5.103, 300, 45, "beach", (0.8, 1.5, 3.0), "europe", 120),
    ("thurso_east", "Thurso East", "Caithness, Scotland", "United Kingdom", 58.596, -3.511, 330, 35, "reef", (1.0, 2.0, 4.0), "europe", 170),
    ("bundoran", "Bundoran (The Peak)", "Donegal", "Ireland", 54.480, -8.280, 300, 40, "reef", (1.0, 2.0, 3.5), "europe", 130),
    ("mullaghmore", "Mullaghmore Head", "Sligo", "Ireland", 54.470, -8.450, 300, 35, "bigwave", (4.0, 8.0, 15.0), "europe", 150),
    ("sylt", "Westerland", "Sylt", "Germany", 54.910, 8.300, 280, 45, "beach", (0.5, 1.0, 2.0), "europe", 100),
    ("scheveningen", "Scheveningen", "The Hague", "Netherlands", 52.110, 4.270, 300, 45, "beach", (0.5, 1.0, 2.0), "europe", 120),
    ("klitmoller", "Klitmoller (Cold Hawaii)", "Thy", "Denmark", 57.040, 8.480, 315, 40, "reef", (0.8, 1.5, 3.0), "europe", 135),
    ("unstad", "Unstad", "Lofoten", "Norway", 68.270, 13.580, 300, 40, "point", (1.0, 1.5, 3.0), "europe", 120),
    ("capo_mannu", "Capo Mannu", "Sardinia", "Italy", 40.030, 8.380, 300, 40, "reef", (1.0, 1.8, 3.5), "europe", 120),
    ("varazze", "Varazze", "Liguria", "Italy", 44.350, 8.580, 190, 40, "reef", (0.5, 1.0, 2.0), "europe", 0),
    ("tel_aviv", "Hilton Beach", "Tel Aviv", "Israel", 32.090, 34.770, 280, 45, "beach", (0.5, 1.0, 2.0), "europe", 100),
    # -------------------------------------------------- Morocco & Atlantic islands
    ("anchor_point", "Anchor Point", "Taghazout", "Morocco", 30.545, -9.710, 310, 35, "point", (1.0, 2.0, 4.0), "morocco_islands", 60),
    ("imsouane", "Imsouane (The Bay)", "Imsouane", "Morocco", 30.840, -9.820, 320, 35, "point", (0.8, 1.5, 3.0), "morocco_islands", 60),
    ("safi", "Safi", "Safi", "Morocco", 32.270, -9.250, 310, 35, "point", (1.5, 2.5, 4.0), "morocco_islands", 120),
    ("el_quemao", "El Quemao", "La Santa, Lanzarote", "Spain", 29.112, -13.659, 320, 35, "reef", (1.5, 2.5, 5.0), "morocco_islands", 140),
    ("el_confital", "El Confital", "Gran Canaria", "Spain", 28.160, -15.440, 340, 35, "reef", (1.0, 2.0, 4.0), "morocco_islands", 160),
    ("jardim_do_mar", "Jardim do Mar", "Madeira", "Portugal", 32.730, -17.210, 280, 35, "point", (2.0, 3.5, 7.0), "morocco_islands", 60),
    # ------------------------------------------------------------------ Africa
    ("jeffreys_bay", "Jeffreys Bay (Supertubes)", "Eastern Cape", "South Africa", -34.031, 24.931, 215, 35, "point", (1.2, 2.0, 4.0), "africa", 300),
    ("dungeons", "Dungeons", "Hout Bay, Cape Town", "South Africa", -34.050, 18.350, 235, 35, "bigwave", (4.0, 8.0, 15.0), "africa", 45),
    ("muizenberg", "Muizenberg", "Cape Town", "South Africa", -34.110, 18.470, 170, 45, "beach", (0.5, 1.0, 2.0), "africa", 330),
    ("durban", "New Pier", "Durban", "South Africa", -29.860, 31.040, 120, 45, "beach", (0.8, 1.5, 3.0), "africa", 270),
    ("skeleton_bay", "Skeleton Bay", "Walvis Bay", "Namibia", -22.670, 14.530, 220, 30, "point", (1.5, 2.5, 4.0), "africa", 90),
    ("ouakam", "Ouakam", "Dakar", "Senegal", 14.720, -17.500, 315, 40, "reef", (1.0, 1.5, 3.0), "africa", 100),
    ("busua", "Busua", "Western Region", "Ghana", 4.800, -1.940, 200, 40, "beach", (0.5, 1.2, 2.5), "africa", 20),
    ("one_eye", "One Eye (Le Morne)", "Mauritius", "Mauritius", -20.470, 57.310, 220, 35, "reef", (1.5, 2.5, 4.0), "africa", 110),
    ("saint_leu", "Saint-Leu", "Reunion", "France", -21.170, 55.280, 230, 35, "reef", (1.0, 2.0, 3.5), "africa", 90),
    # ------------------------------------------------------------ Indian Ocean
    ("arugam_bay", "Arugam Bay (Main Point)", "Eastern Province", "Sri Lanka", 6.840, 81.840, 160, 35, "point", (0.8, 1.5, 2.5), "indian_ocean", 270),
    ("hikkaduwa", "Hikkaduwa", "Southern Province", "Sri Lanka", 6.140, 80.100, 225, 40, "reef", (0.5, 1.0, 2.0), "indian_ocean", 60),
    ("weligama", "Weligama", "Southern Province", "Sri Lanka", 5.970, 80.430, 200, 40, "beach", (0.3, 0.8, 1.5), "indian_ocean", 20),
    ("pasta_point", "Pasta Point", "North Male Atoll", "Maldives", 4.453, 73.716, 170, 45, "reef", (0.8, 1.5, 2.5), "indian_ocean", 290),
    ("cokes", "Cokes", "Thulusdhoo", "Maldives", 4.373, 73.652, 160, 40, "reef", (1.0, 1.8, 3.0), "indian_ocean", 280),
    ("kovalam", "Kovalam", "Kerala", "India", 8.400, 76.980, 230, 40, "beach", (0.5, 1.0, 2.0), "indian_ocean", 60),
    # --------------------------------------------------------------- Indonesia
    ("uluwatu", "Uluwatu", "Bukit, Bali", "Indonesia", -8.815, 115.086, 225, 35, "reef", (1.2, 2.5, 5.0), "indonesia", 110),
    ("padang_padang", "Padang Padang", "Bukit, Bali", "Indonesia", -8.811, 115.103, 225, 30, "reef", (1.8, 3.0, 5.0), "indonesia", 110),
    ("canggu", "Canggu (Echo Beach)", "Bali", "Indonesia", -8.659, 115.123, 230, 40, "reef", (0.8, 1.5, 3.0), "indonesia", 50),
    ("keramas", "Keramas", "Gianyar, Bali", "Indonesia", -8.555, 115.440, 150, 35, "reef", (1.0, 1.8, 3.0), "indonesia", 330),
    ("desert_point", "Desert Point", "Lombok", "Indonesia", -8.744, 115.825, 220, 30, "reef", (1.5, 2.5, 4.0), "indonesia", 120),
    ("g_land", "G-Land (Plengkung)", "East Java", "Indonesia", -8.740, 114.360, 200, 35, "reef", (1.5, 2.5, 5.0), "indonesia", 110),
    ("lagundri", "Lagundri Bay", "Nias", "Indonesia", 0.567, 97.733, 225, 35, "reef", (1.2, 2.0, 4.0), "indonesia", 60),
    ("lances_right", "Lance's Right (HT's)", "Mentawai Islands", "Indonesia", -2.730, 99.990, 220, 35, "reef", (1.2, 2.0, 3.5), "indonesia", 80),
    ("macaronis", "Macaronis", "Mentawai Islands", "Indonesia", -2.920, 100.100, 220, 35, "reef", (1.0, 1.8, 3.0), "indonesia", 80),
    ("krui", "Ujung Bocur", "Krui, Sumatra", "Indonesia", -5.190, 103.930, 220, 35, "reef", (1.2, 2.0, 3.5), "indonesia", 60),
    # -------------------------------------------------------------------- Asia
    ("kata", "Kata Beach", "Phuket", "Thailand", 7.820, 98.296, 245, 40, "beach", (0.5, 1.0, 2.0), "asia", 90),
    ("kalim", "Kalim Reef", "Patong, Phuket", "Thailand", 7.907, 98.293, 250, 35, "reef", (0.8, 1.5, 2.5), "asia", 90),
    ("khao_lak", "Pakarang Cape", "Khao Lak", "Thailand", 8.650, 98.240, 260, 40, "beach", (0.5, 1.0, 2.0), "asia", 90),
    ("cloud_9", "Cloud 9", "Siargao", "Philippines", 9.813, 126.168, 90, 35, "reef", (1.0, 1.8, 3.0), "asia", 270),
    ("baler", "Sabang Beach", "Baler, Aurora", "Philippines", 15.770, 121.580, 70, 45, "beach", (0.5, 1.0, 2.0), "asia", 250),
    ("ichinomiya", "Tsurigasaki Beach", "Ichinomiya, Chiba", "Japan", 35.360, 140.400, 110, 45, "beach", (0.8, 1.5, 3.0), "asia", 290),
    ("kugenuma", "Kugenuma", "Shonan, Kanagawa", "Japan", 35.310, 139.470, 180, 45, "beach", (0.5, 1.0, 2.0), "asia", 0),
    ("kisakihama", "Kisakihama", "Miyazaki", "Japan", 31.820, 131.460, 110, 45, "beach", (0.8, 1.5, 3.0), "asia", 290),
    # --------------------------------------------------------------- Australia
    ("snapper_rocks", "Snapper Rocks (Superbank)", "Gold Coast, Queensland", "Australia", -28.162, 153.550, 115, 40, "point", (1.0, 1.8, 3.0), "australia", 210),
    ("kirra", "Kirra", "Gold Coast, Queensland", "Australia", -28.167, 153.526, 110, 35, "point", (1.2, 2.0, 3.5), "australia", 210),
    ("burleigh_heads", "Burleigh Heads", "Gold Coast, Queensland", "Australia", -28.087, 153.456, 110, 40, "point", (1.0, 1.8, 3.0), "australia", 240),
    ("noosa", "Noosa Heads", "Sunshine Coast, Queensland", "Australia", -26.381, 153.093, 100, 40, "point", (0.8, 1.5, 2.5), "australia", 200),
    ("the_pass", "The Pass", "Byron Bay, New South Wales", "Australia", -28.637, 153.627, 130, 40, "point", (0.8, 1.5, 2.5), "australia", 220),
    ("north_narrabeen", "North Narrabeen", "Sydney, New South Wales", "Australia", -33.708, 151.307, 100, 45, "beach", (0.8, 1.5, 3.0), "australia", 270),
    ("bondi", "Bondi Beach", "Sydney, New South Wales", "Australia", -33.891, 151.278, 110, 45, "beach", (0.5, 1.2, 2.5), "australia", 290),
    ("bells_beach", "Bells Beach", "Torquay, Victoria", "Australia", -38.369, 144.281, 220, 35, "reef", (1.2, 2.0, 4.0), "australia", 0),
    ("shipstern", "Shipstern Bluff", "Tasmania", "Australia", -43.210, 147.740, 220, 35, "bigwave", (3.0, 6.0, 10.0), "australia", 0),
    ("margaret_river", "Margaret River (Main Break)", "Western Australia", "Australia", -33.975, 114.985, 245, 35, "reef", (1.5, 3.0, 6.0), "australia", 90),
    # ---------------------------------------------- New Zealand & Pacific islands
    ("raglan", "Manu Bay", "Raglan", "New Zealand", -37.818, 174.820, 230, 35, "point", (1.0, 1.8, 3.5), "pacific", 90),
    ("piha", "Piha", "Auckland", "New Zealand", -36.955, 174.465, 250, 45, "beach", (1.0, 1.5, 3.0), "pacific", 90),
    ("wainui", "Wainui Beach", "Gisborne", "New Zealand", -38.690, 178.070, 120, 45, "beach", (0.8, 1.5, 3.0), "pacific", 290),
    ("cloudbreak", "Cloudbreak", "Tavarua", "Fiji", -17.885, 177.187, 225, 35, "reef", (1.5, 2.5, 6.0), "pacific", 110),
    ("teahupoo", "Teahupo'o", "Tahiti", "French Polynesia", -17.866, -149.257, 210, 35, "reef", (1.5, 2.5, 6.0), "pacific", 30),
]

FIELDS = ("id", "name", "area", "country", "lat", "lon", "swell_from", "window", "kind", "size", "region", "offshore_from")

REGIONS: dict[str, str] = {
    "hawaii": "Hawaii",
    "california": "California & Baja",
    "central_america": "Mexico & Central America",
    "south_america": "South America",
    "atlantic_americas": "Caribbean & US East",
    "europe": "Europe",
    "morocco_islands": "Morocco & Atlantic islands",
    "africa": "Africa",
    "indian_ocean": "Sri Lanka, Maldives & India",
    "indonesia": "Indonesia",
    "asia": "Thailand, Philippines & Japan",
    "australia": "Australia",
    "pacific": "New Zealand & Pacific islands",
}


def builtin_spots() -> list[dict[str, Any]]:
    """The catalogue as dicts, with the offshore direction filled in."""
    out: list[dict[str, Any]] = []
    for row in _RAW:
        spot = dict(zip(FIELDS, row))
        size = spot.pop("size")
        spot["size_min"], spot["size_ideal"], spot["size_max"] = size
        if spot["offshore_from"] is None:
            spot["offshore_from"] = (spot["swell_from"] + 180) % 360
        spot["custom"] = False
        out.append(spot)
    return out


def parse_custom_spots(text: str | None) -> tuple[list[dict[str, Any]], list[str]]:
    """Parse user spots, one per line: name, lat, lon, swell_from [, offshore_from [, min, ideal, max]].

    Returns the spots and a list of lines that could not be read.
    """
    spots: list[dict[str, Any]] = []
    bad: list[str] = []
    if not text:
        return spots, bad
    for raw in str(text).replace(";", "\n").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split(",")]
        try:
            name = parts[0]
            lat = float(parts[1])
            lon = float(parts[2])
            swell_from = float(parts[3]) % 360
            offshore = float(parts[4]) % 360 if len(parts) > 4 and parts[4] else (swell_from + 180) % 360
            if len(parts) >= 8:
                smin, sideal, smax = float(parts[5]), float(parts[6]), float(parts[7])
            else:
                smin, sideal, smax = 0.6, 1.5, 3.0
            if not name or not -90 <= lat <= 90 or not -180 <= lon <= 180 or not 0 < smin < sideal < smax:
                raise ValueError
        except (IndexError, ValueError):
            bad.append(line)
            continue
        slug = "".join(ch if ch.isalnum() else "_" for ch in name.lower()).strip("_") or "spot"
        spots.append({
            "id": f"custom_{slug}",
            "name": name,
            "area": "",
            "country": "",
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "swell_from": swell_from,
            "window": 40,
            "kind": "custom",
            "size_min": smin,
            "size_ideal": sideal,
            "size_max": smax,
            "region": "custom",
            "offshore_from": offshore,
            "custom": True,
        })
    return spots, bad
