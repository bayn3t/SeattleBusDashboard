// Initialize the map centered on Seattle
const map = L.map('map').setView([47.6062, -122.3321], 11);

// Check if h3 library is available
if (typeof h3 === 'undefined') {
    console.error('h3 library not loaded!');
} else {
    console.log('h3 library loaded successfully');
}

// Jurisdiction code mapping
const jurisdictionMap = {
    'BEL': 'Bellevue',
    'SEA': 'Seattle',
    'FDY': 'Federal Way',
    'KNT': 'Kent',
    'NEW': 'Newaukum',
    'COV': 'Covington',
    'MI': 'Mercer Island',
    'DUV': 'Duvall',
    'NOB': 'North Bend',
    'CH': 'Clyde Hill',
    'KCM': 'King County',
    'UNK': 'Unknown',
    'DOT': 'State DOT'
};

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    maxNativeZoom: 18
}).addTo(map);

// Store data globally
let allStops = [];
let filteredStops = [];

// Custom cluster icon with size variation instead of numbers
const clusterIconCreateFunction = function(cluster) {
    const childCount = cluster.getChildCount();
    let size = 20;
    let color = '#667eea';
    
    if (childCount < 10) {
        size = 20;
        color = '#667eea';      // Purple - small
    } else if (childCount < 50) {
        size = 28;
        color = '#2196F3';      // Blue - medium
    } else if (childCount < 100) {
        size = 36;
        color = '#00BCD4';      // Teal - large
    } else {
        size = 44;
        color = '#FF6B35';      // Orange - very large
    }
    
    return L.divIcon({
        html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>`,
        className: 'cluster-icon',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
    });
};

// Use progressive clustering - clusters disperse gradually at higher zooms
let markerGroup = L.markerClusterGroup({
    maxClusterRadius: 50,          // Initial cluster radius
    disableClusteringAtZoom: 16,   // Completely disable clustering at zoom 16+
    iconCreateFunction: clusterIconCreateFunction,
    chunkedLoading: true,          // Load markers in chunks for better performance
    zoomToBoundsOnClick: true      // Zoom to cluster bounds when clicked
});
let routePolyline = null; // Store the current route polyline

// Hexagonal heatmap variables
let hexLayer = L.featureGroup();
const HEATMAP_ZOOM_THRESHOLD = 15; // Switch to individual stops at zoom 15+
const H3_RESOLUTION = 8; // Hexagon resolution (0-15, higher = smaller hexagons)
let isRouteSearchActive = false; // Track if a route search is currently active

// Color scheme for markers based on number of routes
function getMarkerColor(routeCount) {
    // All individual stops use dark blue when zoomed in
    return '#1a3a7a';                      // Dark blue
}

// Calculate distance between two coordinates (Haversine formula)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Order stops linearly from one end to the other
function orderStopsByProximity(stops) {
    if (stops.length === 0) return [];
    if (stops.length === 1) return stops;
    if (stops.length === 2) return stops;
    
    // Build a proximity graph - connect each stop to its nearest neighbor
    const proximityGraph = {};
    
    for (let i = 0; i < stops.length; i++) {
        const neighbors = [];
        
        for (let j = 0; j < stops.length; j++) {
            if (i !== j) {
                const dist = getDistance(
                    stops[i].properties.stop_lat,
                    stops[i].properties.stop_lon,
                    stops[j].properties.stop_lat,
                    stops[j].properties.stop_lon
                );
                neighbors.push({ index: j, distance: dist });
            }
        }
        
        // Sort by distance and keep closest neighbors
        neighbors.sort((a, b) => a.distance - b.distance);
        proximityGraph[i] = neighbors.map(n => n.index);
    }
    
    // Find endpoints (stops that are furthest apart)
    let maxDistance = 0;
    let endpoint1 = 0;
    let endpoint2 = 0;
    
    for (let i = 0; i < stops.length; i++) {
        for (let j = i + 1; j < stops.length; j++) {
            const dist = getDistance(
                stops[i].properties.stop_lat,
                stops[i].properties.stop_lon,
                stops[j].properties.stop_lat,
                stops[j].properties.stop_lon
            );
            if (dist > maxDistance) {
                maxDistance = dist;
                endpoint1 = i;
                endpoint2 = j;
            }
        }
    }
    
    // Build the path from endpoint1 to endpoint2 using greedy nearest neighbor
    const visited = new Set();
    const path = [endpoint1];
    visited.add(endpoint1);
    let current = endpoint1;
    
    while (visited.size < stops.length) {
        let nextStop = -1;
        let minDistance = Infinity;
        
        for (let i = 0; i < stops.length; i++) {
            if (!visited.has(i)) {
                const dist = getDistance(
                    stops[current].properties.stop_lat,
                    stops[current].properties.stop_lon,
                    stops[i].properties.stop_lat,
                    stops[i].properties.stop_lon
                );
                if (dist < minDistance) {
                    minDistance = dist;
                    nextStop = i;
                }
            }
        }
        
        if (nextStop !== -1) {
            path.push(nextStop);
            visited.add(nextStop);
            current = nextStop;
        }
    }
    
    return path.map(index => stops[index]);
}

// Draw a polyline connecting all stops for a specific route
function drawRoutePolyline(routeNumber) {
    // Remove existing polyline if any
    if (routePolyline) {
        map.removeLayer(routePolyline);
    }
    
    // Find all stops serving this route
    let stopsOnRoute = allStops.filter(stop => {
        const routesServing = (stop.properties.routes_serving || '').split(/\s+/).map(r => r.trim()).filter(r => r);
        return routesServing.includes(routeNumber);
    });
    
    if (stopsOnRoute.length === 0) return;
    
    // Order stops by proximity (nearest neighbor)
    stopsOnRoute = orderStopsByProximity(stopsOnRoute);
    
    // Create coordinates array for the polyline
    const coordinates = stopsOnRoute.map(stop => [
        stop.properties.stop_lat,
        stop.properties.stop_lon
    ]);
    
    // Create and add polyline to map
    routePolyline = L.polyline(coordinates, {
        color: '#FF6B35',
        weight: 3,
        opacity: 0.7,
        smoothFactor: 1
    }).addTo(map);
    
    // Bring markers to front so they appear above the polyline
    markerGroup.bringToFront();
}

// Create custom marker icon - smaller and filled
function createMarkerIcon(color) {
    return L.icon({
        iconUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${encodeURIComponent(color)}" width="16" height="16"><circle cx="12" cy="12" r="10"/></svg>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -8],
        className: 'bus-stop-marker'
    });
}

// Create popup content
function createPopupContent(feature) {
    const props = feature.properties;
    const routesArray = props.routes_serving ? props.routes_serving.split(',').map(r => r.trim()) : [];
    
    let html = '<div class="popup-content">';
    html += '<div class="popup-header">';
    html += `<div class="stop-name">${props.stop_name || 'Unknown Stop'}</div>`;
    html += `<div class="stop-id">Stop #${props.stop_id}</div>`;
    html += '</div>';
    
    html += '<div class="popup-info">';
    
    // Routes serving - Main focus
    html += '<div class="popup-info-row" style="margin-bottom: 14px;">';
    html += '<div style="width: 100%;">';
    html += '<div class="info-label" style="margin-bottom: 6px;">Routes Serving</div>';
    if (routesArray.length > 0) {
        routesArray.forEach(route => {
            if (route) {
                html += `<span class="routes-badge">${route}</span>`;
            }
        });
    } else {
        html += '<span style="color: #999; font-size: 12px;">No routes assigned</span>';
    }
    html += '</div>';
    html += '</div>';
    
    // Location / Jurisdiction
    if (props.jurisdiction) {
        const jurisdictionName = jurisdictionMap[props.jurisdiction] || props.jurisdiction;
        html += `<div class="popup-info-row">`;
        html += `<div class="info-label">Service Area</div>`;
        html += `<div class="info-value">${jurisdictionName}</div>`;
        html += `</div>`;
    }
    
    // Shelter
    const shelterClass = props.has_shelter === 'Yes' ? 'yes' : 'no';
    const shelterIcon = props.has_shelter === 'Yes' ? '✓' : '✗';
    html += `<div class="popup-info-row">`;
    html += `<div class="info-label">Shelter</div>`;
    html += `<div><span class="shelter-badge ${shelterClass}">${shelterIcon} ${props.has_shelter}</span></div>`;
    html += `</div>`;
    
    // Accessibility
    const accessClass = props.accessibility.includes('ADA') ? 'yes' : 'no';
    const accessIcon = props.accessibility.includes('ADA') ? '♿' : '—';
    html += `<div class="popup-info-row">`;
    html += `<div class="info-label">Accessible</div>`;
    html += `<div><span class="accessibility ${accessClass}">${accessIcon} ${props.accessibility}</span></div>`;
    html += `</div>`;
    
    html += '</div>';
    html += '</div>';
    
    return html;
}

// Load GeoJSON data
async function loadStops() {
    try {
        const response = await fetch('data/stops.geojson');
        if (!response.ok) throw new Error('Failed to load stops data');
        
        const data = await response.json();
        allStops = data.features;
        
        // Add all stops to map
        displayStops(allStops);
        
        // Create hexagonal heatmap for initial display
        createHexagonalHeatmap(allStops);
        
        // Fit map to bounds
        if (allStops.length > 0) {
            const bounds = L.latLngBounds(
                allStops.map(stop => [
                    stop.properties.stop_lat,
                    stop.properties.stop_lon
                ])
            );
            map.fitBounds(bounds, { padding: [50, 50] });
        }
        
        // Update layer visibility after fitting bounds (fitBounds may trigger zoomend event)
        setTimeout(() => {
            updateLayerVisibility();
        }, 100);
        
    } catch (error) {
        console.error('Error loading stops:', error);
    }
}

// Create hexagonal heatmap visualization
function createHexagonalHeatmap(stops) {
    // Fade out existing hexagons
    hexLayer.eachLayer(layer => {
        if (layer.getElement) {
            const element = layer.getElement();
            if (element) {
                element.classList.remove('hexagon-fade-in');
                element.classList.add('hexagon-fade-out');
            }
        }
    });
    
    // Clear after fade out completes
    setTimeout(() => {
        hexLayer.clearLayers();
        
        if (stops.length === 0) {
            console.warn('No stops provided for heatmap');
            return;
        }
        
        // Group stops by H3 hexagon
        const hexBins = {};
        
        stops.forEach(feature => {
            const lat = feature.properties.stop_lat;
            const lon = feature.properties.stop_lon;
            const hexId = h3.latLngToCell(lat, lon, H3_RESOLUTION);
            
            if (!hexBins[hexId]) {
                hexBins[hexId] = [];
            }
            hexBins[hexId].push(feature);
        });
    
    console.log(`Created ${Object.keys(hexBins).length} hexagons for ${stops.length} stops`);
    
    // Create color scale for density
    const stopCounts = Object.values(hexBins).map(arr => arr.length);
    const maxCount = Math.max(...stopCounts);
    const minCount = Math.min(...stopCounts);
    
    console.log(`Stop counts range: ${minCount} - ${maxCount}`);
    
    // Use logarithmic scaling for better color distribution
    function getLogValue(count) {
        return Math.log(count - minCount + 1) / Math.log(maxCount - minCount + 1);
    }
    
    // Color gradient with much more contrast - green/yellow (low) to red (high), gray for 0
    function getDensityColor(count) {
        // Gray for hexagons with no stops
        if (count === 0) return '#cccccc';
        
        const normalized = getLogValue(count);
        
        // Use a more dramatic color scale with better contrast
        // Green -> Yellow -> Orange -> Red
        if (normalized < 0.15) return '#91cf60';      // Green - very low
        if (normalized < 0.30) return '#a6d96a';      // Light green
        if (normalized < 0.45) return '#d9ef8b';      // Light yellow-green
        if (normalized < 0.60) return '#fee08b';      // Yellow
        if (normalized < 0.75) return '#fdae61';      // Orange-yellow
        if (normalized < 0.90) return '#f46d43';      // Orange-red
        return '#a50026';                             // Dark red - very high
    }
    
    // Get darker outline color complementary to fill color
    function getOutlineColor(count) {
        // Dark gray outline for empty hexagons
        if (count === 0) return '#888888';
        
        const normalized = getLogValue(count);
        
        // Darker/more saturated versions for outlines
        if (normalized < 0.15) return '#4a8c2d';      // Dark green
        if (normalized < 0.30) return '#5a9c3d';      // Dark green
        if (normalized < 0.45) return '#8a9c3d';      // Dark yellow-green
        if (normalized < 0.60) return '#b8a830';      // Dark yellow
        if (normalized < 0.75) return '#d97e2d';      // Dark orange-yellow
        if (normalized < 0.90) return '#c94d1f';      // Dark orange-red
        return '#6b0018';                             // Very dark red
    }
    
    // Update legend with actual ranges
    updateHeatmapLegend(minCount, maxCount, getLogValue);
    
    // Create hexagons for each bin
    Object.entries(hexBins).forEach(([hexId, stopsInHex]) => {
        const boundary = h3.cellToBoundary(hexId);
        // boundary is already [lat, lng] pairs, which is what Leaflet needs
        const polygonCoords = boundary.map(([lat, lng]) => [lat, lng]);
        
        const fillColor = getDensityColor(stopsInHex.length);
        const outlineColor = getOutlineColor(stopsInHex.length);
        const polygon = L.polygon(polygonCoords, {
            color: outlineColor,
            fillColor: fillColor,
            fillOpacity: 0.85,
            weight: 2,
            opacity: 1
        });
        
        // Create popup with stop list (initially showing first 5)
        let popupHtml = `<div class="popup-content" data-hex-id="${hexId}"><div class="popup-header">
                            <div class="stop-name">Hex Cell</div>
                            <div class="stop-id">${stopsInHex.length} stops</div>
                          </div><div class="popup-info">`;
        
        popupHtml += '<div class="popup-info-row"><div class="info-label">Stops in this area:</div></div>';
        popupHtml += '<div class="stops-list-container">';
        stopsInHex.slice(0, 5).forEach(stop => {
            popupHtml += `<div style="font-size: 11px; margin: 3px 0; padding-left: 10px;">• ${stop.properties.stop_name}</div>`;
        });
        
        if (stopsInHex.length > 5) {
            const extraCount = stopsInHex.length - 5;
            popupHtml += `<div style="margin-top: 8px; padding-left: 10px;">
                            <button class="toggle-stops-btn" data-hex-id="${hexId}" style="
                                background: #2196F3;
                                color: white;
                                border: none;
                                padding: 4px 10px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 11px;
                                font-weight: 500;
                                width: 100%;
                                text-align: left;
                            ">▼ Show ${extraCount} more stops</button>
                            <div class="hidden-stops-container" id="hidden-stops-${hexId}" style="display: none; margin-top: 8px;">`;
            
            stopsInHex.slice(5).forEach(stop => {
                popupHtml += `<div style="font-size: 11px; margin: 3px 0; padding-left: 10px;">• ${stop.properties.stop_name}</div>`;
            });
            
            popupHtml += `</div></div>`;
        }
        
        popupHtml += '</div></div></div>';
        
        // Create a custom popup element
        const popupDiv = document.createElement('div');
        popupDiv.innerHTML = popupHtml;
        
        // Attach stop data to the popup for later use
        popupDiv.stopsData = stopsInHex;
        
        polygon.bindPopup(popupDiv, {
            maxWidth: 280,
            maxHeight: 400,
            className: 'stop-popup',
            autoPan: true,
            autoPanPadding: [50, 50]
        });
        
        // Add click handler to toggle button
        polygon.on('popupopen', () => {
            setTimeout(() => {
                const toggleBtn = document.querySelector(`[data-hex-id="${hexId}"].toggle-stops-btn`);
                if (toggleBtn) {
                    toggleBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        const hiddenContainer = document.getElementById(`hidden-stops-${hexId}`);
                        if (hiddenContainer) {
                            const isHidden = hiddenContainer.style.display === 'none';
                            hiddenContainer.style.display = isHidden ? 'block' : 'none';
                            toggleBtn.textContent = isHidden ? '▲ Hide stops' : `▼ Show ${stopsInHex.length - 5} more stops`;
                        }
                    });
                }
            }, 100);
        });
        
        hexLayer.addLayer(polygon);
        
        // Apply fade-in animation to the polygon element
        setTimeout(() => {
            const element = polygon.getElement();
            if (element) {
                element.classList.add('hexagon-fade-in');
            }
        }, 10);
    });
    
    console.log(`Hexlayer now has ${hexLayer.getLayers().length} layers`);
    }, 600); // Wait for fade out animation to complete
}

// Update the heatmap legend with actual numerical ranges using logarithmic scaling
function updateHeatmapLegend(minCount, maxCount, getLogValue) {
    // Logarithmic scaling thresholds that map to our color ranges
    const thresholds = [
        { normalized: 0.15, color: '#91cf60' },
        { normalized: 0.30, color: '#a6d96a' },
        { normalized: 0.45, color: '#d9ef8b' },
        { normalized: 0.60, color: '#fee08b' },
        { normalized: 0.75, color: '#fdae61' },
        { normalized: 0.90, color: '#f46d43' },
        { normalized: 1.00, color: '#a50026' }
    ];
    
    // Calculate actual stop counts for each threshold
    const breakpoints = [];
    
    // Add gray for 0 stops if minimum is 0
    if (minCount === 0) {
        breakpoints.push({
            color: '#cccccc',
            start: 0,
            end: 0
        });
    }
    
    for (let i = 0; i < thresholds.length; i++) {
        const norm = thresholds[i].normalized;
        // Inverse of logarithmic scaling: count = minCount + (maxCount - minCount) * e^(norm * ln(maxCount - minCount + 1))
        let actualCount;
        if (i === 0) {
            actualCount = minCount;
        } else {
            const invLog = Math.exp(norm * Math.log(maxCount - minCount + 1)) - 1;
            actualCount = minCount + Math.round(invLog);
        }
        
        if (i === 0) {
            const nextNorm = thresholds[1].normalized;
            const nextInvLog = Math.exp(nextNorm * Math.log(maxCount - minCount + 1)) - 1;
            const nextCount = minCount + Math.round(nextInvLog);
            const startVal = minCount === 0 ? 1 : minCount;
            if (startVal <= nextCount) {
                breakpoints.push({
                    color: thresholds[i].color,
                    start: startVal,
                    end: nextCount - 1
                });
            }
        } else if (i === thresholds.length - 1) {
            const prevNorm = thresholds[i - 1].normalized;
            const prevInvLog = Math.exp(prevNorm * Math.log(maxCount - minCount + 1)) - 1;
            const prevCount = minCount + Math.round(prevInvLog);
            breakpoints.push({
                color: thresholds[i].color,
                start: prevCount,
                end: maxCount
            });
        } else {
            const prevNorm = thresholds[i - 1].normalized;
            const prevInvLog = Math.exp(prevNorm * Math.log(maxCount - minCount + 1)) - 1;
            const prevCount = minCount + Math.round(prevInvLog);
            
            const nextNorm = thresholds[i + 1].normalized;
            const nextInvLog = Math.exp(nextNorm * Math.log(maxCount - minCount + 1)) - 1;
            const nextCount = minCount + Math.round(nextInvLog);
            
            breakpoints.push({
                color: thresholds[i].color,
                start: prevCount,
                end: nextCount - 1
            });
        }
    }
    
    const legendContainer = document.getElementById('heatmap-legend');
    legendContainer.innerHTML = breakpoints.map(bp => `
        <div class="legend-item" style="margin: 3px 0;">
            <div style="width: 20px; height: 12px; background: ${bp.color}; border: 1px solid #333;"></div>
            <span style="font-size: 11px;">${bp.start} - ${bp.end} stops</span>
        </div>
    `).join('');
}

// Display stops on map
function displayStops(stops) {
    markerGroup.clearLayers();
    
    stops.forEach(feature => {
        const props = feature.properties;
        const color = getMarkerColor(props.routes_serving);
        
        const marker = L.marker(
            [props.stop_lat, props.stop_lon],
            { icon: createMarkerIcon(color) }
        );
        
        marker.bindPopup(createPopupContent(feature), {
            maxWidth: 300,
            className: 'stop-popup'
        });
        
        // Add click event for analytics (optional)
        marker.on('click', function() {
            console.log(`Clicked stop: ${props.stop_name}`);
        });
        
        markerGroup.addLayer(marker);
    });
    
    map.addLayer(markerGroup);
}

// Handle zoom changes to switch between heatmap and markers
function updateLayerVisibility() {
    const currentZoom = map.getZoom();
    console.log(`Zoom level: ${currentZoom}, Threshold: ${HEATMAP_ZOOM_THRESHOLD}, Route search active: ${isRouteSearchActive}`);
    
    // If a route search is active, always show markers only - never show heatmap
    if (isRouteSearchActive) {
        if (map.hasLayer(hexLayer)) {
            map.removeLayer(hexLayer);
        }
        if (!map.hasLayer(markerGroup)) {
            map.addLayer(markerGroup);
        }
        return;
    }
    
    if (currentZoom < HEATMAP_ZOOM_THRESHOLD) {
        // Show hexagonal heatmap at low zoom
        console.log('Switching to heatmap view');
        if (map.hasLayer(markerGroup)) {
            map.removeLayer(markerGroup);
        }
        if (!map.hasLayer(hexLayer)) {
            map.addLayer(hexLayer);
            console.log('Added hexLayer to map');
        }
    } else {
        // Show individual stops at high zoom
        console.log('Switching to marker view');
        if (map.hasLayer(hexLayer)) {
            map.removeLayer(hexLayer);
        }
        if (!map.hasLayer(markerGroup)) {
            map.addLayer(markerGroup);
            console.log('Added markerGroup to map');
        }
    }
}

map.on('zoomend', updateLayerVisibility);

// Search mode state
let searchMode = 'route'; // 'route' or 'location'

// Toggle button handlers
document.getElementById('mode-route').addEventListener('click', function() {
    searchMode = 'route';
    document.getElementById('mode-route').classList.add('active');
    document.getElementById('mode-location').classList.remove('active');
    document.getElementById('search-input').placeholder = 'Search routes...';
    // Re-run search with current query
    const query = document.getElementById('search-input').value;
    if (query.trim()) {
        document.getElementById('search-input').dispatchEvent(new Event('input'));
    }
});

document.getElementById('mode-location').addEventListener('click', function() {
    searchMode = 'location';
    document.getElementById('mode-location').classList.add('active');
    document.getElementById('mode-route').classList.remove('active');
    document.getElementById('search-input').placeholder = 'Search locations...';
    // Re-run search with current query
    const query = document.getElementById('search-input').value;
    if (query.trim()) {
        document.getElementById('search-input').dispatchEvent(new Event('input'));
    }
});

// Search functionality
document.getElementById('search-input').addEventListener('input', function(e) {
    const query = e.target.value.trim().toUpperCase(); // Convert to uppercase for route search
    
    if (query.length === 0) {
        // Clear search - reset route search flag and show heatmap
        isRouteSearchActive = false;
        displayStops(allStops);
        createHexagonalHeatmap(allStops);
        // Remove route polyline when search is cleared
        if (routePolyline) {
            map.removeLayer(routePolyline);
            routePolyline = null;
        }
        updateLayerVisibility();
        return;
    }
    
    filteredStops = allStops.filter(stop => {
        const props = stop.properties;
        
        if (searchMode === 'route') {
            // Search only by route number (exact match)
            const routes = (props.routes_serving || '');
            const routeArray = routes.split(/\s+/).map(r => r.trim()).filter(r => r);
            return routeArray.some(route => route === query);
        } else {
            // Search only by location name (partial match)
            const stopName = (props.stop_name || '').toLowerCase();
            return stopName.includes(query.toLowerCase());
        }
    });
    
    displayStops(filteredStops);
    
    // Draw route polyline if searching by route
    if (searchMode === 'route' && query.length > 0 && filteredStops.length > 0) {
        // Set flag to completely disable heatmap during route search
        isRouteSearchActive = true;
        // Disable heatmap for route search - show markers only
        if (map.hasLayer(hexLayer)) {
            map.removeLayer(hexLayer);
        }
        if (!map.hasLayer(markerGroup)) {
            map.addLayer(markerGroup);
        }
        drawRoutePolyline(query);
    } else {
        // For location search, reset the flag and show heatmap normally
        isRouteSearchActive = false;
        createHexagonalHeatmap(filteredStops);
        // Remove polyline if searching by location
        if (routePolyline) {
            map.removeLayer(routePolyline);
            routePolyline = null;
        }
    }
    
    // Show message if no results
    if (filteredStops.length === 0) {
        console.log(`No stops found matching: ${query}`);
    }
});

// Clear search
document.getElementById('clear-search').addEventListener('click', function() {
    document.getElementById('search-input').value = '';
    isRouteSearchActive = false;
    displayStops(allStops);
    createHexagonalHeatmap(allStops);
    // Remove route polyline when clearing search
    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
    }
    updateLayerVisibility();
});

// Load data when page loads
window.addEventListener('load', loadStops);

// Also load immediately in case the load event has already fired
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadStops);
} else {
    loadStops();
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.getElementById('search-input').value = '';
        isRouteSearchActive = false;
        displayStops(allStops);
        createHexagonalHeatmap(allStops);
        // Remove route polyline when pressing Escape
        if (routePolyline) {
            map.removeLayer(routePolyline);
            routePolyline = null;
        }
        updateLayerVisibility();
    }
});
