import { useState } from 'react';
import { useStore } from '../store';
import { Check, ArrowLeft } from 'lucide-react';
import osmtogeojson from 'osmtogeojson';
import { computeFastRescueRoute } from '../lib/fastPathfinder';
import { resolveLocationData } from '../lib/locationFetcher';

export default function LeftSidebar() {
  const { 
    imageFile, imageUrl, depthUrl, depthDimensions, imageDimensions, 
    geoData, stats, calibration, elevationMode, backendAvailable, isFetchingOSM,
    layers, toggleLayer, reconstructionMode, setReconstructionMode, surfaceType, setSurfaceType,
    interactionMode, setInteractionMode, rescueRoute, setCalculatingRoute, setRescueRouteResult,
    damageData, setDamageData, setAppState
  } = useStore();

  const isMetric = elevationMode === 'metric' || reconstructionMode === 'metric';

  const [manualLocInput, setManualLocInput] = useState('');
  const [isMatchingLocation, setIsMatchingLocation] = useState(false);

  const handleLookupLocation = async () => {
    if (!manualLocInput || !manualLocInput.trim()) return;
    setIsMatchingLocation(true);
    try {
      const result = await resolveLocationData(manualLocInput);
      if (result) {
        useStore.getState().setGeoData(result);
      }
    } catch (e) {
      alert('Could not resolve location. Enter a valid name (e.g. "Kedarnath, India") or coordinates (e.g. "30.7346, 79.0669").');
    } finally {
      setIsMatchingLocation(false);
    }
  };

  // Format depth/elevation values based on mode
  const formatHeight = (val, suffix = '') => {
    if (val === null || val === undefined) return 'N/A';
    if (typeof val === 'number') return val.toFixed(2) + suffix;
    return String(val) + suffix;
  };

  const minH = isMetric ? calibration.minElevation : stats.minDepth;
  const maxH = isMetric ? calibration.maxElevation : stats.maxDepth;
  const meanH = isMetric ? calibration.meanElevation : stats.meanDepth;
  const heightUnit = isMetric ? ' m' : '';
  const heightLabel = isMetric ? 'Elevation' : 'Depth';

  const handleCalculateRoute = async () => {
    const { rescueRoute, depthFloat32, depthDimensions } = useStore.getState();
    const sp = rescueRoute.startPoint;
    const ep = rescueRoute.endPoint;

    if (!sp || !ep) {
      alert("Please select both a Start (Rescue Team) and Destination (People in Need) point on the 3D terrain.");
      return;
    }
    if (!depthFloat32 || !depthDimensions.width) {
      alert("No 3D height data available. Run reconstruction first.");
      return;
    }

    setCalculatingRoute(true);

    // 1. INSTANT CLIENT-SIDE 8-CONNECTED A* PATH CALCULATION (< 5ms)
    const fastRoute = computeFastRescueRoute(
      depthFloat32,
      depthDimensions.width,
      depthDimensions.height,
      sp,
      ep
    );

    if (fastRoute) {
      setRescueRouteResult({
        pathNodes: fastRoute.pathNodes,
        total3dDistance: fastRoute.total3dDistance,
        horizDistance: fastRoute.horizDistance,
        elevGain: fastRoute.elevGain,
        maxSlope: fastRoute.maxSlope,
        estTimeMin: fastRoute.estTimeMin,
      });
    }

    // 2. CONCURRENT BACKEND REFINEMENT (Optional Risk-Weighted A*)
    try {
      const bytes = new Uint8Array(depthFloat32.buffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      const depthB64 = btoa(binary);

      const payload = {
        depth_float32: depthB64,
        width: depthDimensions.width,
        height: depthDimensions.height,
        start_pos: [sp.px, sp.py],
        end_pos: [ep.px, ep.py],
      };

      const res = await fetch('http://localhost:8000/api/rescue-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        setRescueRouteResult({
          pathNodes: data.nodes || [],
          total3dDistance: data.total_3d_distance_m,
          horizDistance: data.total_horizontal_distance_m,
          elevGain: data.elevation_gain_m,
          maxSlope: data.max_slope_deg,
          estTimeMin: data.estimated_travel_time_min,
        });
      }
    } catch (err) {
      console.warn("Backend API offline — instant client A* route active:", err);
    }
  };

  const handleAnalyzeDamage = async (beforeFile = null) => {
    const { imageFile, imageUrl, depthDimensions, depthFloat32 } = useStore.getState();
    
    setDamageData({ isAnalyzing: true });

    try {
      const formData = new FormData();
      if (imageFile) {
        formData.append("after_file", imageFile);
      } else if (imageUrl) {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        formData.append("after_file", blob, "present_disaster.jpg");
      } else {
        alert("Please upload an optical satellite/village image first.");
        setDamageData({ isAnalyzing: false });
        return;
      }

      if (beforeFile) {
        formData.append("before_file", beforeFile);
      }

      const res = await fetch("http://localhost:8000/api/analyze-damage", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Damage API returned server error");

      const data = await res.json();
      const heatmapUrl = `data:image/png;base64,${data.change_heatmap_png}`;

      setDamageData({
        beforeUrl: beforeFile ? URL.createObjectURL(beforeFile) : null,
        changeHeatmapUrl: heatmapUrl,
        totalChangePct: data.total_change_pct,
        highDamagePct: data.high_damage_pct,
        moderateDamagePct: data.moderate_damage_pct,
        damageStatus: data.damage_status,
        buildingCount: data.building_count,
        affectedPopulation: data.affected_population,
        costUsd: data.cost_usd,
        costInrLakhs: data.cost_inr_lakhs,
        epicenterPos: data.epicenter_pos,
        stagingPos: data.staging_pos,
        isAnalyzing: false,
      });

      // Enable 3D damage heatmap and rescue route spatial layers automatically
      useStore.setState((state) => ({ layers: { ...state.layers, damage: true, rescueRoute: true } }));

      // Automatically place Staging (Rescue Team) and Epicenter (People in Need) 3D pins
      if (depthDimensions.width && depthDimensions.height && depthFloat32) {
        const w = depthDimensions.width;
        const h = depthDimensions.height;

        const stPx = Math.min(w - 1, Math.max(0, Math.floor((data.staging_pos[0] / 512.0) * w)));
        const stPy = Math.min(h - 1, Math.max(0, Math.floor((data.staging_pos[1] / 512.0) * h)));
        const stNormX = stPx / (w - 1);
        const stNormY = stPy / (h - 1);
        const stIdx = stPy * w + stPx;
        const stVal = depthFloat32[stIdx] || 0;

        const epPx = Math.min(w - 1, Math.max(0, Math.floor((data.epicenter_pos[0] / 512.0) * w)));
        const epPy = Math.min(h - 1, Math.max(0, Math.floor((data.epicenter_pos[1] / 512.0) * h)));
        const epNormX = epPx / (w - 1);
        const epNormY = epPy / (h - 1);
        const epIdx = epPy * w + epPx;
        const epVal = depthFloat32[epIdx] || 0;

        const aspect = (useStore.getState().imageDimensions.width || 1) / (useStore.getState().imageDimensions.height || 1);
        const meshW = 10;
        const meshH = 10 / aspect;
        const dScale = 0.5 * useStore.getState().verticalExaggeration;

        const spPt = {
          x: (stNormX - 0.5) * meshW,
          y: (0.5 - stNormY) * meshH,
          z: Math.max(0, stVal) * dScale,
          normX: stNormX,
          normY: stNormY,
          px: stPx,
          py: stPy,
        };

        const epPt = {
          x: (epNormX - 0.5) * meshW,
          y: (0.5 - epNormY) * meshH,
          z: Math.max(0, epVal) * dScale,
          normX: epNormX,
          normY: epNormY,
          px: epPx,
          py: epPy,
        };

        useStore.getState().setRouteStartPoint(spPt);
        useStore.getState().setRouteEndPoint(epPt);

        // Auto calculate rescue route!
        setTimeout(() => handleCalculateRoute(spPt, epPt), 100);
      }

    } catch (err) {
      console.error("Damage analysis error:", err);
      alert("Damage analysis error: " + err.message);
      setDamageData({ isAnalyzing: false });
    }
  };

  return (
    <div className="sidebar left-sidebar">

      {/* DUAL-TEMPORAL DISASTER INTELLIGENCE & COMPARISON */}
      <div className="panel-section" style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.3)', marginBottom: '12px' }}>
        <div className="panel-title" style={{ color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '6px' }}>
          🚨 DISASTER INTELLIGENCE & CHANGE ANALYSIS
        </div>
        <p className="text-muted text-xs mb-2">Compare 2 images (Before vs After) for damage detection & risk prediction.</p>
        <button 
          className="btn-outline w-full"
          style={{ background: '#2563eb', color: '#ffffff', borderColor: '#3b82f6', fontWeight: 'bold', fontSize: '0.75rem', padding: '8px 12px', cursor: 'pointer' }}
          onClick={() => useStore.getState().setIsComparisonModalOpen(true)}
        >
          📂 UPLOAD 2ND IMAGE / DUAL COMPARISON
        </button>
      </div>

      {/* TERRAIN-AWARE RESCUE ROUTING CONTROL */}
      <div className="panel-section" style={{ background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
        <div className="panel-title" style={{ color: '#34d399' }}>🚑 RESCUE ROUTE PLANNING</div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <button 
            className={`btn-outline w-full ${interactionMode === 'Route Start' ? 'active' : ''}`}
            onClick={() => setInteractionMode('Route Start')}
            style={{ fontSize: '0.7rem', padding: '6px', borderColor: '#10b981' }}
          >
            Pick Start (Team)
          </button>
          <button 
            className={`btn-outline w-full ${interactionMode === 'Route End' ? 'active' : ''}`}
            onClick={() => setInteractionMode('Route End')}
            style={{ fontSize: '0.7rem', padding: '6px', borderColor: '#f43f5e' }}
          >
            Pick Dest (Need)
          </button>
        </div>
        <button 
          className="btn-outline w-full"
          style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', fontWeight: 'bold' }}
          onClick={() => handleCalculateRoute()}
          disabled={rescueRoute.isCalculating}
        >
          {rescueRoute.isCalculating ? 'CALCULATING PATH...' : 'CALCULATE RESCUE ROUTE'}
        </button>
      </div>

      {/* Step 4 Requirement: Side-by-Side RGB vs Generated Depth Map */}
      <div className="panel-section">
        <div className="panel-title">PIPELINE 2D PREVIEWS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px', fontWeight: '600' }}>ORIGINAL RGB</div>
            {imageUrl ? (
              <img src={imageUrl} alt="Original RGB" style={{ width: '100%', height: '85px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #334155' }} />
            ) : (
              <div style={{ height: '85px', background: '#1e293b', borderRadius: '4px' }} />
            )}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#38bdf8', marginBottom: '4px', fontWeight: '600' }}>AI DEPTH MAP</div>
            {depthUrl ? (
              <img src={depthUrl} alt="AI Depth Map" style={{ width: '100%', height: '85px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #0284c7' }} />
            ) : (
              <div style={{ height: '85px', background: '#1e293b', borderRadius: '4px' }} />
            )}
          </div>
        </div>
      </div>

      {/* Pipeline Technical Specifications & Execution Info */}
      <div className="panel-section">
        <div className="panel-title">PIPELINE EXECUTION METRICS</div>
        <div className="key-value-row">
          <span className="key">Input File</span>
          <span className="value">{imageFile ? imageFile.name : 'Uploaded Satellite RGB'}</span>
        </div>
        <div className="key-value-row">
          <span className="key">Height AI Model</span>
          <span className="value">DepthAnythingV2 (Satellite Adapted)</span>
        </div>
        <div className="key-value-row">
          <span className="key">Array Format</span>
          <span className="value">Float32 (Spatially Aligned 1:1)</span>
        </div>
        <div className="key-value-row">
          <span className="key">Resolution</span>
          <span className="value">{depthDimensions.width || imageDimensions.width} x {depthDimensions.height || imageDimensions.height}</span>
        </div>
        <div className="key-value-row">
          <span className="key">Mesh Geometry</span>
          <span className="value">{depthDimensions.width ? `${(depthDimensions.width * depthDimensions.height).toLocaleString()} Vertices` : 'Displaced Mesh'}</span>
        </div>
        <div className="key-value-row">
          <span className="key">Inference Device</span>
          <span className="value">{stats.device || 'CPU'}</span>
        </div>
        <div className="key-value-row">
          <span className="key">Inference Speed</span>
          <span className="value">{stats.processingTime != null ? `${stats.processingTime}s` : 'N/A'}</span>
        </div>
        <div className="key-value-row">
          <span className="key">Backend Server</span>
          <span className="value">{backendAvailable === true ? <span className="green">Python (FastAPI) ✓</span> : backendAvailable === false ? 'Browser Wasm' : 'Ready'}</span>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">RECONSTRUCTION & ACCURACY STATS</div>
        <div className="key-value-row">
          <span className="key">Min {heightLabel}</span>
          <span className="value">{formatHeight(minH, heightUnit)}</span>
        </div>
        <div className="key-value-row">
          <span className="key">Max {heightLabel}</span>
          <span className="value">{formatHeight(maxH, heightUnit)}</span>
        </div>
        <div className="key-value-row">
          <span className="key">Mean {heightLabel}</span>
          <span className="value">{formatHeight(meanH, heightUnit)}</span>
        </div>
        {stats.validPixelsPct != null && (
          <div className="key-value-row">
            <span className="key">Valid Pixel Ratio</span>
            <span className="value">{stats.validPixelsPct}%</span>
          </div>
        )}
        {stats.outlierPct != null && (
          <div className="key-value-row">
            <span className="key">Outliers Cleaned</span>
            <span className="value">{stats.outlierPct}%</span>
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-title">GEOREFERENCING METADATA</div>
        <div className="badges-row mb-2">
          <span className={`badge ${geoData.isGeoreferenced ? 'bg-green' : 'bg-gray'}`}>
            {geoData.isGeoreferenced && <Check size={12}/>} GEOREFERENCED
          </span>
          <span className={`badge ${isMetric ? 'bg-blue' : 'bg-gray'}`}>
            {isMetric && <Check size={12}/>} METRIC
          </span>
        </div>
        <div className="key-value-row">
          <span className="key">CRS</span>
          <span className="value">{geoData.crs || 'EPSG:4326 (WGS84)'}</span>
        </div>
        {geoData.latitude != null && (
          <div className="key-value-row">
            <span className="key">Latitude</span>
            <span className="value">{geoData.latitude.toFixed(5)}°</span>
          </div>
        )}
        {geoData.longitude != null && (
          <div className="key-value-row">
            <span className="key">Longitude</span>
            <span className="value">{geoData.longitude.toFixed(5)}°</span>
          </div>
        )}
        <div className="key-value-row">
          <span className="key">Base Altitude Datum</span>
          <span className="value" style={{ fontWeight: 'bold', color: '#38bdf8' }}>{geoData.baseElevationASL != null ? `${geoData.baseElevationASL} m ASL` : '500 m ASL'}</span>
        </div>
        {geoData.gsd && (
          <div className="key-value-row">
            <span className="key">Ground Sample Dist (GSD)</span>
            <span className="value">{geoData.gsd.toFixed(3)} m/px</span>
          </div>
        )}
      </div>

      {/* LOCATION INPUT & AI AUTOFETCH */}
      <div className="panel-section" style={{ background: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
        <div className="panel-title" style={{ color: '#38bdf8', fontSize: '0.72rem' }}>📍 LOCATION & ASL AUTOFETCH</div>
        <p className="text-muted text-xs mb-2">Type a location name or lat,lon to resolve real ASL elevation & coordinates.</p>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
          <input
            type="text"
            placeholder="e.g. Kedarnath, India or 30.7346, 79.0669"
            value={manualLocInput}
            onChange={(e) => setManualLocInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLookupLocation(); }}
            style={{
              flex: 1, padding: '6px 10px', borderRadius: '5px',
              background: '#0f172a', border: '1px solid #334155',
              color: '#fff', fontSize: '0.72rem',
            }}
          />
          <button
            className="btn-outline"
            onClick={handleLookupLocation}
            disabled={isMatchingLocation}
            style={{
              fontSize: '0.68rem', padding: '6px 10px',
              borderColor: '#38bdf8', color: '#38bdf8',
              fontWeight: 'bold', whiteSpace: 'nowrap',
            }}
          >
            {isMatchingLocation ? 'Resolving...' : '🔍 Match DEM'}
          </button>
        </div>
        {geoData.locationName && geoData.latitude && (
          <div style={{
            background: 'rgba(13, 148, 136, 0.2)',
            border: '1px solid rgba(20, 184, 166, 0.4)',
            borderRadius: '5px', padding: '6px 8px',
            fontSize: '0.68rem', color: '#5eead4',
            display: 'flex', alignItems: 'center', gap: '4px'
          }}>
            <Check size={12} /> {geoData.locationName} · {geoData.latitude.toFixed(4)}°, {geoData.longitude.toFixed(4)}° · {geoData.baseElevationASL || 500}m ASL
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-title">METRIC HEIGHT CALIBRATION</div>
        <div className="key-value-row">
          <span className="key">Ref Min Elev (m)</span>
          <input type="number" className="small-input" id="cal-min-elev" defaultValue={100} />
        </div>
        <div className="key-value-row">
          <span className="key">Ref Max Elev (m)</span>
          <input type="number" className="small-input" id="cal-max-elev" defaultValue={300} />
        </div>
        <button 
          className="btn-outline w-full mt-2" 
          style={{fontWeight:'bold'}}
          onClick={async () => {
            const minEl = parseFloat(document.getElementById('cal-min-elev').value) || 0;
            const maxEl = parseFloat(document.getElementById('cal-max-elev').value) || 100;
            
            const { depthFloat32 } = useStore.getState();
            if (!depthFloat32) {
              alert('No height data available. Run reconstruction first.');
              return;
            }

            let dMin = Infinity, dMax = -Infinity;
            for (let i = 0; i < depthFloat32.length; i++) {
              if (depthFloat32[i] < dMin) dMin = depthFloat32[i];
              if (depthFloat32[i] > dMax) dMax = depthFloat32[i];
            }
            const dRange = dMax - dMin;
            if (dRange < 1e-6) {
              alert('Depth map is flat — cannot calibrate.');
              return;
            }
            const a = (maxEl - minEl) / dRange;
            const b = minEl - a * dMin;

            let sumElev = 0;
            for (let i = 0; i < depthFloat32.length; i++) {
              sumElev += a * depthFloat32[i] + b;
            }
            const meanElev = sumElev / depthFloat32.length;

            useStore.getState().setCalibration({
              scale: a,
              offset: b,
              minElevation: minEl,
              maxElevation: maxEl,
              meanElevation: Math.round(meanElev * 100) / 100,
              rmse: 0,
              mae: 0,
            });
            alert(`Calibration applied: H = ${a.toFixed(4)} × D + ${b.toFixed(2)}`);
          }}
        >APPLY METRIC CALIBRATION</button>
        
        {isMetric && calibration.scale != null && (
          <div className="info-box mt-2" style={{ fontSize: '0.7rem' }}>
            Scale (a): {calibration.scale?.toFixed(4)} | Offset (b): {calibration.offset?.toFixed(2)} m<br/>
            Mean Elevation: {calibration.meanElevation} m
          </div>
        )}
      </div>

      {geoData.isGeoreferenced && geoData.latitude != null && (
        <div className="panel-section">
          <div className="panel-title">LOCATION CONTEXT</div>
          <div className="map-embed-container">
            <iframe 
              width="100%" 
              height="150" 
              style={{border:0, borderRadius: '4px'}} 
              loading="lazy" 
              allowFullScreen 
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${geoData.longitude - 0.01},${geoData.latitude - 0.01},${geoData.longitude + 0.01},${geoData.latitude + 0.01}&layer=mapnik&marker=${geoData.latitude},${geoData.longitude}`}>
            </iframe>
          </div>
        </div>
      )}

      <div className="panel-section border-none">
        <div className="panel-title" style={{marginBottom:'4px'}}>OPENSTREETMAP DATA (OVERPASS)</div>
        <p className="text-muted text-xs mb-4">Fetch buildings and roads for the georeferenced area.</p>
        <button 
          className="btn-outline w-full" 
          style={{fontWeight:'bold'}}
          onClick={async () => {
            const { geoData } = useStore.getState();
            if (!geoData.latitude || !geoData.longitude) {
              alert("No geolocation data available. Upload a georeferenced image first.");
              return;
            }
            
            useStore.getState().setFetchingOSM(true);
            try {
              const lat = geoData.latitude;
              const lon = geoData.longitude;
              const offset = 0.005; 
              let bbox = geoData.bbox;
              if (!bbox) {
                bbox = [lon - offset, lat - offset, lon + offset, lat + offset];
              }
              const S = bbox[1], W = bbox[0], N = bbox[3], E = bbox[2];
              
              const query = `[out:json][timeout:25];(way["building"](${S},${W},${N},${E});relation["building"](${S},${W},${N},${E}););out body;>;out skel qt;`;
              
              const res = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: query
              });
              
              if (!res.ok) throw new Error('Overpass API rate limit or error');
              
              const data = await res.json();
              const geojson = osmtogeojson(data);
              useStore.getState().setOsmBuildings(geojson);
            } catch (error) {
              console.error(error);
              alert("Failed to fetch OSM data. Overpass API may be rate limited.");
            } finally {
              useStore.getState().setFetchingOSM(false);
            }
          }}
          disabled={isFetchingOSM}
        >
          {isFetchingOSM ? 'FETCHING...' : 'FETCH OSM DATA'}
        </button>
      </div>
    </div>
  );
}
