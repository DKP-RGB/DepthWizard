// src/lib/srtmFetcher.js

function lon2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  return Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
      ) /
        Math.PI) /
      2) *
      Math.pow(2, zoom)
  );
}

/**
 * Fetches a Mapzen Terrarium tile for a given lat/lon and returns a decoded Float32Array of elevations.
 */
export async function fetchSRTMForLocation(lat, lon, zoom = 14) {
  const x = lon2tile(lon, zoom);
  const y = lat2tile(lat, zoom);
  const z = zoom;

  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous'; // Crucial for reading pixel data from Canvas
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imageData.data; // Uint8ClampedArray: R, G, B, A
      
      const width = img.width;
      const height = img.height;
      const elevations = new Float32Array(width * height);

      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let count = 0;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        // Decode formula: (R * 256 + G + B / 256) - 32768
        let elevation = (r * 256 + g + b / 256) - 32768;
        
        let isValid = true;
        if (a === 0 || elevation <= -10000) {
          isValid = false;
        }
        
        const pxIdx = i / 4;
        elevations[pxIdx] = elevation;
        
        if (isValid) {
          if (elevation < min) min = elevation;
          if (elevation > max) max = elevation;
          sum += elevation;
          count++;
        }
      }

      if (count === 0) {
        min = 0;
        max = 0;
      }
      
      // Clean up invalid pixels
      for (let i = 0; i < elevations.length; i++) {
        if (elevations[i] <= -10000) elevations[i] = min;
      }

      // We normalize the elevations from 0 to 1 so the shader can handle it simply,
      // and we return the min/max so we can scale it to real metric heights.
      const normalized = new Float32Array(width * height);
      const range = max - min;
      if (range > 0) {
        for (let i = 0; i < elevations.length; i++) {
          normalized[i] = (elevations[i] - min) / range;
        }
      }

      resolve({
        data: normalized,      // Float32Array mapped to [0, 1]
        width,
        height,
        minElevation: min,
        maxElevation: max,
        meanElevation: sum / elevations.length
      });
    };
    img.onerror = (err) => reject(new Error('Failed to load SRTM tile'));
    img.src = url;
  });
}
