import imageio.v3 as iio
import tifffile
import numpy as np

img = iio.imread(r'd:\projects\DepthWizard\UI\public\demo\new-york.jpg')

geokeys = (
    1, 1, 0, 4,
    1024, 0, 1, 2,
    1025, 0, 1, 1,
    2048, 0, 1, 4326,
    2054, 0, 1, 9102
)

tiepoint = (0.0, 0.0, 0.0, -74.0060, 40.7128, 0.0)
pixel_scale = (0.0001, 0.0001, 0.0)

tifffile.imwrite(
    r'd:\projects\DepthWizard\UI\public\demo\nyc_real.tif',
    img,
    photometric='rgb',
    metadata=None,
    extratags=[
        (34735, 'H', len(geokeys), geokeys, True),
        (33922, 'd', len(tiepoint), tiepoint, True),
        (33550, 'd', len(pixel_scale), pixel_scale, True)
    ]
)
print('Successfully generated nyc_real.tif with GeoTIFF metadata!')
