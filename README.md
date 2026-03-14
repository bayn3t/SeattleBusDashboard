# Seattle Metro Bus Stops Map

An interactive web map of all Seattle/King County Metro bus stops. Find nearby stops, see which routes they serve, and learn about accessibility.

# About the map

Our map shows over 6400 bus stops in the Seattle area. We designed it so that when zoomed out, the bus stop density is displayed as a hexagonal-pattern heatmap, but as you zoom in, you can see individual stops. Red hexagons represent high bus stop concentration, while green ones represent low density. By clicking on a dot/stop, you can see which lines it serves, accessibility, shelter, and more. There is also a search bar that lets users search for lines by route and displays the path they take. We also designed this website to be accessible to desktop and mobile users.

## How to Use

1. **Open it up**: Just open `index.html` in your browser
2. **Explore**: Zoom in and out, pan around to find stops
3. **Search**: Type in the search box to find a stop by name, number, or route
4. **Click stops**: Click on any bus stop marker to see detailed info

## What You Can Do

**Zoom in and out** - See bus stops at different scales  
**Search by route or stop name** - Find exactly what you're looking for  
**Click any stop** - Get info about which routes stop there  
**Check accessibility** - See ADA information for each stop  
**Works on any device** - Works on your phone, tablet, or computer

## Files

- **index.html** - The main page
- **css/style.css** - All the styling and colors
- **js/main.js** - The code that makes the map work
- **data/stops.geojson** - Bus stop data for the entire region

## What Powers This Map

- **Leaflet.js** - Makes the interactive map
- **OpenStreetMap** - The base map tiles
- **H3.js** - Creates the hexagonal heatmap view
- **JavaScript** - No servers needed, everything runs in your browser

## The Data

Over 6,400 active bus stops across Seattle and King County. Info includes:
- Stop location (latitude/longitude)
- Which routes stop there
- Whether there's a shelter
- ADA accessibility
- Service area

Made for exploring Seattle's amazing bus system