import { fromBlob } from 'geotiff';

export async function parseGeoTiff(file) {
  try {
    const tiff = await fromBlob(file);
    const image = await tiff.getImage();
    
    // Attempt to read GeoKeys
    const geoKeys = image.getGeoKeys();
    const tiepoint = image.getTiePoints();
    const pixelScale = image.getFileDirectory().ModelPixelScale;
    
    let isGeoreferenced = false;
    let isMetric = false;
    let crs = 'Unknown';
    let latitude = null;
    let longitude = null;
    let gsd = 0;
    
    if (geoKeys) {
      isGeoreferenced = true;
      // Basic extraction, a real implementation would use a proper proj4 lookup
      if (geoKeys.ProjectedCSTypeGeoKey) {
        crs = `EPSG:${geoKeys.ProjectedCSTypeGeoKey}`;
        isMetric = true;
      } else if (geoKeys.GeographicTypeGeoKey) {
        crs = `EPSG:${geoKeys.GeographicTypeGeoKey}`;
      }
    }
    
    let tiepoints = image.getTiePoints();
    let rawTiepoint = image.getFileDirectory().ModelTiepoint;
    
    if (rawTiepoint && rawTiepoint.length >= 6) {
      longitude = rawTiepoint[3];
      latitude = rawTiepoint[4];
    } else if (tiepoints && tiepoints.length > 0 && typeof tiepoints[0] === 'object') {
      longitude = tiepoints[0].x;
      latitude = tiepoints[0].y;
    }
    
    if (pixelScale && pixelScale.length >= 2) {
      gsd = pixelScale[0];
    }
    
    const width = image.getWidth();
    const height = image.getHeight();
    
    // Generate preview URL
    let previewUrl = null;
    try {
      const rgb = await image.readRGB();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(width, height);
      
      let j = 0;
      if (rgb.length === width * height * 3) {
        for (let i = 0; i < rgb.length; i += 3) {
          imageData.data[j] = rgb[i];
          imageData.data[j+1] = rgb[i+1];
          imageData.data[j+2] = rgb[i+2];
          imageData.data[j+3] = 255;
          j += 4;
        }
      } else if (rgb.length === width * height * 4) {
        for (let i = 0; i < rgb.length; i += 4) {
          imageData.data[i] = rgb[i];
          imageData.data[i+1] = rgb[i+1];
          imageData.data[i+2] = rgb[i+2];
          imageData.data[i+3] = rgb[i+3];
        }
      }
      ctx.putImageData(imageData, 0, 0);
      previewUrl = canvas.toDataURL('image/jpeg', 0.8);
    } catch (e) {
      console.warn("Could not generate TIF preview", e);
    }

    let bbox = null;
    if (longitude !== null && latitude !== null && pixelScale && pixelScale.length >= 2) {
      // Assuming longitude and latitude are top-left corner
      const scaleX = pixelScale[0];
      const scaleY = pixelScale[1]; // Sometimes this is negative, sometimes positive
      
      const lonMin = longitude;
      const lonMax = longitude + (width * scaleX);
      const latMax = latitude; // Top
      const latMin = latitude - (height * Math.abs(scaleY)); // Bottom
      
      bbox = [lonMin, latMin, lonMax, latMax];
    }

    return {
      crs,
      latitude,
      longitude,
      bbox,
      altitude: null,
      gsd,
      isGeoreferenced,
      isMetric,
      width,
      height,
      previewUrl
    };
  } catch (err) {
    console.error("Error parsing GeoTIFF:", err);
    return null;
  }
}
