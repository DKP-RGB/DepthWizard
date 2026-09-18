"""
Geospatial CRS & Spatial Transformation Helper
Manages transformations between Raster Pixel, Raster CRS, WGS84 (EPSG:4326), and Local Metric 3D Space.
"""

import math


def pixel_to_wgs84(px: float, py: float, width: int, height: int, bbox: list) -> tuple:
    """
    Transforms pixel coordinates (px, py) to WGS84 (lon, lat).

    Args:
        px: pixel X [0, width]
        py: pixel Y [0, height]
        width: image pixel width
        height: image pixel height
        bbox: [minLon, minLat, maxLon, maxLat]

    Returns:
        (longitude, latitude)
    """
    if not bbox or len(bbox) < 4:
        return (0.0, 0.0)

    min_lon, min_lat, max_lon, max_lat = bbox
    u = px / max(1, width - 1)
    v = py / max(1, height - 1)

    lon = min_lon + u * (max_lon - min_lon)
    lat = max_lat - v * (max_lat - min_lat)
    return (round(lon, 6), round(lat, 6))


def calculate_gsd(width: int, height: int, bbox: list) -> float:
    """
    Calculates Ground Sampling Distance (GSD) in meters/pixel.
    Haversine distance along width divided by pixel count.
    """
    if not bbox or len(bbox) < 4:
        return 1.0

    min_lon, min_lat, max_lon, max_lat = bbox
    mean_lat = (min_lat + max_lat) / 2.0

    # Haversine width distance
    dlon = math.radians(max_lon - min_lon)
    lat_rad = math.radians(mean_lat)
    a = (math.cos(lat_rad) ** 2) * (math.sin(dlon / 2.0) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    dist_m = 6371000.0 * c  # Earth radius in meters

    return max(0.1, dist_m / max(1, width))
