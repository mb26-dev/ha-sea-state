# Third party notices

Sea State Forecast itself is MIT licensed (see [LICENSE](LICENSE)). It ships no third party code. At runtime it downloads data from the following services; their terms apply to that data.

## Open-Meteo

Waves, swell, sea surface temperature, sea level, wind, clouds, rain and air pressure come from the [Open-Meteo](https://open-meteo.com) Marine and Forecast APIs.

- Licence: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
- Attribution: "Weather and marine data by Open-Meteo.com"
- The free API is for non-commercial use, with fair use limits of 10,000 calls per day, 5,000 per hour and 600 per minute (see the [Open-Meteo terms](https://open-meteo.com/en/terms)). Sea State Forecast stays well below these limits with its default settings.
- Open-Meteo combines models of national weather services; the data is provided as is, without any guarantee.

## GDACS

Tropical cyclone positions, strength, alert levels and tracks come from [GDACS](https://www.gdacs.org), the Global Disaster Alert and Coordination System, a cooperation framework of the United Nations and the European Commission. GDACS takes its cyclone data from JTWC and NOAA.

- Terms: [GDACS disclaimer](https://www.gdacs.org/About/disclaimer.aspx). GDACS information is meant for awareness; for warnings follow your national meteorological service.

## NASA Earth Observatory

The globe uses NASA imagery, downloaded once at runtime and not shipped with the integration:

- Blue Marble Next Generation (topography and bathymetry) by Reto Stöckli, NASA Earth Observatory
- Black Marble 2016, NASA Earth Observatory

NASA imagery is generally not subject to copyright in the United States; credit "NASA Earth Observatory".

## Artwork

The surfers, waves, clouds, rain, lightning, cyclone spirals and the brand images are original artwork, drawn by code in this repository.
