import tifffile
import numpy as np
import sys
import warnings

def inject_geokeys(input_tif, output_tif):
    warnings.filterwarnings('ignore')
    try:
        with tifffile.TiffFile(input_tif) as tif:
            image = tif.asarray()
            
        # WGS 84 EPSG:4326 metadata
        # BBOX from our WMS request: 40.7100, -74.0100 to 40.7150, -74.0050
        # Width/Height was 1024x1024
        pixel_scale = (0.005 / 1024, 0.005 / 1024, 0.0)
        tiepoint = (0.0, 0.0, 0.0, -74.0100, 40.7150, 0.0)

        geokeys = (
            1, 1, 0, 4,
            1024, 0, 1, 2,      # GTModelTypeGeoKey = 2 (Geographic/WGS84)
            1025, 0, 1, 1,      # GTRasterTypeGeoKey = 1 (PixelIsArea)
            2048, 0, 1, 4326,   # GeographicTypeGeoKey = 4326 (WGS84)
            2054, 0, 1, 9102    # GeogAngularUnitsGeoKey = 9102 (Degree)
        )

        tifffile.imwrite(
            output_tif,
            image,
            photometric='rgb',
            extratags=[
                (33550, 'd', 3, pixel_scale, True),
                (33922, 'd', 6, tiepoint, True),
                (34735, 'H', len(geokeys), geokeys, True)
            ]
        )
        print("GeoTIFF generated successfully.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inject_geokeys(r"d:\projects\DepthWizard\UI\public\demo\real_building.tif", r"d:\projects\DepthWizard\UI\public\demo\building_georef.tif")
