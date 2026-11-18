# Changelog

## 0.1.0b4 (beta)

- Shark areas: 33 spots in Hawaii, California, the US East Coast, Australia, South Africa and Réunion show a small shark marker next to the surfer
- The spot details get a shark section: species, local safety measures (nets, drumlines, spotters, drones) and a link to the official live service of the area (SharkSmart WA, SharkSmart NSW, SharkSmart Queensland, VicEmergency, Shark Spotters, KwaZulu-Natal Sharks Board, Centre Sécurité Requin, Hawaii DLNR, California Fish and Wildlife)
- New card option `sharks` (on by default) and new spot sensor attributes `shark_species`, `shark_measures`, `shark_service` and `shark_service_url`
- This is background information, not a live warning; the live sightings stay with the official services

## 0.1.0b3 (beta)

- Spots that lie on top of each other (Uluwatu, Padang Padang, Keramas ...) are grouped: the best one shows its surfer with a +2 badge; tap the badge for the list, the globe zooms in until they separate
- Smoother wave colours: the global wave grid is interpolated with splines, no more straight edges, diamonds or stripes on the sea
- Spot names appear earlier when you zoom in
- The region buttons fade out at the edge when there are more to scroll to
- Bigger gale area markers
- Fixed: after an update the spots kept data from the old version for up to 6 hours (for example a missing swell period); data cached by another version is now fetched again right after the start

## 0.1.0b2 (beta)

- New animated marker icons for the surf spots (riding, paddling, waiting, blown out, too big), tropical cyclones and gale areas; the ring colour shows the condition or the cyclone category
- New icons for the Ocean & weather and Surf buttons
- New logo and icon
- Fixed: the deep ocean was treated as land, so the wave colours were missing in patches and showed stripes along undersea ridges
- Fixed: the swell period was missing at many spots (falls back to the mean swell period), which also made the ratings too uniform
- Fixed: tropical cyclone tracks now use the exact GDACS track points, including the past positions
- Clouds and wave crests stay calmer when zoomed in close

## 0.1.0b1 (beta)

First beta.

- Globe with NASA imagery and the significant wave height of all oceans (Open-Meteo Marine)
- Rolling wave crests in the real wave direction, white caps on high seas
- Clouds, rain and lightning drifting with the wind (Open-Meteo Forecast)
- Tropical cyclones from GDACS with spiral, category and past and forecast track
- Gale areas at sea
- 112 surf spots with a surfer that shows the condition, rating 0 to 5 stars from swell, period and wind
- Spot details: swell window compass, swell and secondary swell, wind (offshore to onshore), water temperature and wetsuit, Douglas sea state, tides, 48 hour chart, 7 day best windows
- Modes Ocean & weather, Surf and All, firing filter, region buttons, 48 hour forecast player, fullscreen, visual editor
- Sensors for the home spot, watched spots, firing spots, best spot, cyclones, nearest cyclone, gale areas and data sources
- Binary sensors: home spot firing, tropical cyclone nearby
- Blueprints: spot firing, cyclone nearby
- English and German
