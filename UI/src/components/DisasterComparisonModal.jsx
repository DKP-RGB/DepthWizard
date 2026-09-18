import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { X, RefreshCw, Layers, Navigation, Download, AlertTriangle, ShieldCheck } from 'lucide-react';
import './Dashboard.css';

export default function DisasterComparisonModal() {
  const {
    isComparisonModalOpen, setIsComparisonModalOpen,
    imageUrl, imageFile, geoData, depthDimensions, depthFloat32,
    damageData, setDamageData,
    disasterType, setDisasterType,
    preDisasterB64, setPreDisasterB64,
    toggleLayer, rescueRoute,
  } = useStore();

  const [isLoadingSatellite, setIsLoadingSatellite] = useState(false);
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.85);
  const [heatmapViewMode, setHeatmapViewMode] = useState('blended'); // 'blended' | 'satellite'
  const prevOpenRef = useRef(false);

  // Clear stale data when modal opens fresh (unless pre-disaster image was prefetched like Kedarnath)
  useEffect(() => {
    if (isComparisonModalOpen && !prevOpenRef.current) {
      // Modal just opened — clear old analysis data but keep prefetched pre-disaster imagery
      if (!preDisasterB64) {
        setDamageData({
          changeHeatmapUrl: null,
          totalChangePct: null,
          highDamagePct: null,
          moderateDamagePct: null,
          damageStatus: null,
          disasterType: 'Disaster Assessment',
          buildingCount: null,
          affectedPopulation: null,
          impactAreaSqm: null,
          impactAreaHectares: null,
          costUsd: null,
          costInrLakhs: null,
          epicenterPos: null,
          stagingPos: null,
          isAnalyzing: false,
          spatialAligned: null,
          meanSsim: null,
          ndviLossPct: null,
          ndwiGainPct: null,
          bsiGainPct: null,
          edgeDisruptionPct: null,
          scvMean: null,
          regionType: null,
          populationDensity: null,
          damagedCentroids: null,
        });
      }
    }
    prevOpenRef.current = isComparisonModalOpen;
  }, [isComparisonModalOpen]);

  if (!isComparisonModalOpen) return null;

  const preDisasterSrc = preDisasterB64 ? `data:image/png;base64,${preDisasterB64}` : damageData.beforeUrl || null;

  // Fetch real pre-disaster optical satellite image from ~1 month prior
  const handleFetchPreDisasterSatellite = async () => {
    setIsLoadingSatellite(true);
    try {
      const payload = {
        latitude: geoData.latitude || 23.2599,
        longitude: geoData.longitude || 77.4126,
        bbox: geoData.bbox || null,
      };

      const res = await fetch('http://localhost:8000/api/fetch-pre-disaster-satellite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Satellite tile fetch error');
      const data = await res.json();
      setPreDisasterB64(data.pre_disaster_b64);
      
      // Automatically trigger multi-disaster change analysis
      await runDamageComparison(data.pre_disaster_b64);
    } catch (err) {
      console.error('Satellite fetch error:', err);
      alert('Failed to fetch pre-disaster satellite imagery: ' + err.message);
    } finally {
      setIsLoadingSatellite(false);
    }
  };

  const runDamageComparison = async (overridePreB64 = null) => {
    setDamageData({ isAnalyzing: true });
    try {
      const formData = new FormData();

      if (imageFile) {
        formData.append('after_file', imageFile);
      } else if (imageUrl) {
        const resp = await fetch(imageUrl);
        const blob = await resp.blob();
        formData.append('after_file', blob, 'present_disaster.jpg');
      }

      const preB64 = overridePreB64 || preDisasterB64;
      if (preB64) {
        const byteCharacters = atob(preB64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/png' });
        formData.append('before_file', blob, 'pre_disaster_1month_ago.png');
      }

      // Build query params, only include non-empty values
      const params = new URLSearchParams();
      params.set('disaster_type', disasterType);
      if (geoData.latitude) params.set('latitude', geoData.latitude);
      if (geoData.longitude) params.set('longitude', geoData.longitude);
      if (geoData.gsd) params.set('gsd', geoData.gsd);

      const res = await fetch(`http://localhost:8000/api/analyze-damage-v2?${params.toString()}`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Damage analysis failed');
      const data = await res.json();

      const heatmapUrl = `data:image/png;base64,${data.change_heatmap_png}`;
      setDamageData({
        changeHeatmapUrl: heatmapUrl,
        disasterType: data.disaster_type,
        totalChangePct: data.total_change_pct,
        highDamagePct: data.high_damage_pct,
        moderateDamagePct: data.moderate_damage_pct,
        damageStatus: data.damage_status,
        buildingCount: data.building_count,
        affectedPopulation: data.affected_population,
        impactAreaSqm: data.impact_area_sqm,
        impactAreaHectares: data.impact_area_hectares,
        costUsd: data.cost_usd,
        costInrLakhs: data.cost_inr_lakhs,
        epicenterPos: data.epicenter_pos,
        stagingPos: data.staging_pos,
        isAnalyzing: false,
        // Enhanced v2 multi-index data
        spatialAligned: data.spatial_aligned,
        meanSsim: data.mean_ssim,
        ndviLossPct: data.ndvi_loss_pct,
        ndwiGainPct: data.ndwi_gain_pct,
        bsiGainPct: data.bsi_gain_pct,
        edgeDisruptionPct: data.edge_disruption_pct,
        scvMean: data.scv_mean,
        regionType: data.region_type,
        populationDensity: data.population_density_per_sqkm,
        damagedCentroids: data.damaged_centroids || [],
      });

      // Enable 3D spatial layers (building blimps ON, heatmap overlay OFF by default)
      useStore.setState((state) => ({ layers: { ...state.layers, buildingBlimps: true, damage: false, rescueRoute: true } }));

      // Auto-set Staging (Rescue Team) and Epicenter (People in Need) 3D points
      if (depthDimensions.width && depthDimensions.height && depthFloat32) {
        const w = depthDimensions.width;
        const h = depthDimensions.height;

        const stPx = Math.min(w - 1, Math.max(0, Math.floor((data.staging_pos[0] / 512.0) * w)));
        const stPy = Math.min(h - 1, Math.max(0, Math.floor((data.staging_pos[1] / 512.0) * h)));
        const stNormX = stPx / (w - 1);
        const stNormY = stPy / (h - 1);
        const stVal = depthFloat32[stPy * w + stPx] || 0;

        const epPx = Math.min(w - 1, Math.max(0, Math.floor((data.epicenter_pos[0] / 512.0) * w)));
        const epPy = Math.min(h - 1, Math.max(0, Math.floor((data.epicenter_pos[1] / 512.0) * h)));
        const epNormX = epPx / (w - 1);
        const epNormY = epPy / (h - 1);
        const epVal = depthFloat32[epPy * w + epPx] || 0;

        const aspect = (useStore.getState().imageDimensions.width || 1) / (useStore.getState().imageDimensions.height || 1);
        const meshW = 10;
        const meshH = 10 / aspect;
        const dScale = 0.5 * useStore.getState().verticalExaggeration;

        const spPt = {
          x: (stNormX - 0.5) * meshW,
          y: (0.5 - stNormY) * meshH,
          z: Math.max(0, stVal) * dScale,
          normX: stNormX, normY: stNormY,
          px: stPx, py: stPy,
        };

        const epPt = {
          x: (epNormX - 0.5) * meshW,
          y: (0.5 - epNormY) * meshH,
          z: Math.max(0, epVal) * dScale,
          normX: epNormX, normY: epNormY,
          px: epPx, py: epPy,
        };

        useStore.getState().setRouteStartPoint(spPt);
        useStore.getState().setRouteEndPoint(epPt);
      }

    } catch (err) {
      console.error('Damage comparison error:', err);
      alert('Analysis error: ' + err.message);
      setDamageData({ isAnalyzing: false });
    }
  };

  const handleDownloadReport = () => {
    const report = {
      title: "DepthWizard Multi-Disaster Assessment Report",
      timestamp: new Date().toISOString(),
      disasterType: damageData.disasterType,
      status: damageData.damageStatus,
      georeference: {
        latitude: geoData.latitude,
        longitude: geoData.longitude,
        location: geoData.locationName || "Village / Region",
      },
      impactMetrics: {
        destroyedStructures: damageData.buildingCount,
        affectedPopulation: damageData.affectedPopulation,
        impactAreaSqm: damageData.impactAreaSqm,
        impactAreaHectares: damageData.impactAreaHectares,
        costEstimateINR: `₹ ${damageData.costInrLakhs} Lakhs`,
        costEstimateUSD: `$ ${damageData.costUsd?.toLocaleString()} USD`,
        surfaceDisruptionPct: `${damageData.totalChangePct}%`,
      },
      multiIndexBreakdown: {
        spatialAligned: damageData.spatialAligned,
        meanSSIM: damageData.meanSsim,
        ndviLossPct: damageData.ndviLossPct,
        ndwiGainPct: damageData.ndwiGainPct,
        bsiGainPct: damageData.bsiGainPct,
        edgeDisruptionPct: damageData.edgeDisruptionPct,
        scvMean: damageData.scvMean,
      },
      rescuePathfinder: {
        stagingCoordinates: damageData.stagingPos,
        epicenterCoordinates: damageData.epicenterPos,
        estimatedResponseTimeMinutes: rescueRoute.estTimeMin,
        total3dDistanceMeters: rescueRoute.total3dDistance,
        maxSlopeDegrees: rescueRoute.maxSlope,
      }
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `disaster_assessment_report_${Date.now()}.json`;
    link.click();
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(11, 15, 25, 0.88)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: '12px',
        width: '100%',
        maxWidth: '1150px',
        maxHeight: '92vh',
        overflowY: 'auto',
        boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(15, 23, 42, 0.95)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle color="#ef4444" size={22} />
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc', fontWeight: '800', letterSpacing: '0.3px' }}>
                DUAL-TEMPORAL DISASTER DAMAGE INTELLIGENCE ASSESSMENT
              </h2>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8' }}>
                Multi-Index Spatial Damage Engine · ORB Alignment · Demographics & Structural Cost Aggregation
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <select
              value={disasterType}
              onChange={(e) => {
                setDisasterType(e.target.value);
                runDamageComparison();
              }}
              style={{
                background: '#1e293b',
                color: '#f1f5f9',
                border: '1px solid #3b82f6',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              <option value="auto">⚡ Auto-Detect Disaster Category</option>
              <option value="Earthquake">🏚️ Earthquake Building Collapse</option>
              <option value="Flood & Inundation">🌊 Flood & Land Inundation</option>
              <option value="Landslide">⛰️ Landslide & Mudflow</option>
              <option value="Cyclone">🌀 Cyclone & Storm Damage</option>
              <option value="Wildfire">🔥 Wildfire Burn Scar</option>
            </select>

            <button
              onClick={() => setIsComparisonModalOpen(false)}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#38bdf8',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              &larr; Back to 3D Viewer
            </button>
            <button
              onClick={() => setIsComparisonModalOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '4px',
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Main Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(30, 41, 59, 0.5)', padding: '10px 16px', borderRadius: '8px' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={handleFetchPreDisasterSatellite}
                    disabled={isLoadingSatellite}
                    className="btn-outline"
                    style={{
                      background: '#2563eb',
                      color: '#ffffff',
                      borderColor: '#3b82f6',
                      fontWeight: 'bold',
                      fontSize: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 14px'
                    }}
                  >
                    <RefreshCw size={14} className={isLoadingSatellite ? 'spin' : ''} />
                    {isLoadingSatellite ? 'FETCHING SATELLITE IMAGE...' : '🔄 FETCH PRE-DISASTER SATELLITE (1 MONTH PRIOR)'}
                  </button>

                  <label className="btn-outline" style={{ cursor: 'pointer', fontSize: '0.75rem', borderColor: '#64748b', color: '#cbd5e1', padding: '8px 14px' }}>
                    📁 UPLOAD CUSTOM BEFORE IMAGE
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          const file = e.target.files[0];
                          const reader = new FileReader();
                          reader.onload = () => {
                            const b64 = reader.result.split(',')[1];
                            setPreDisasterB64(b64);
                            runDamageComparison(b64);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                </div>

                <div style={{ fontSize: '0.75rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600' }}>
                  <ShieldCheck size={16} /> Multi-Index Engine (SSIM · NDVI · NDWI · BSI · SCV)
                </div>
              </div>

              {/* 3-Panel Side-by-Side Satellite Comparison */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                
                {/* Panel 1: Pre-Disaster Satellite Image */}
                <div style={{ background: '#1e293b', padding: '12px', borderRadius: '8px', border: '1px solid #334155' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#60a5fa', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>📷 PRE-DISASTER SATELLITE</span>
                    <span style={{ color: '#94a3b8', fontSize: '0.65rem' }}>1 Month Prior (~30 Days)</span>
                  </div>
                  <div style={{ height: '220px', background: '#0f172a', borderRadius: '6px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {preDisasterSrc ? (
                      <img src={preDisasterSrc} alt="Pre Disaster Satellite" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '0.75rem' }}>
                        Click "Fetch Pre-Disaster Satellite" to load optical imagery from 1 month ago.
                      </div>
                    )}
                  </div>
                </div>

                {/* Panel 2: Present Disaster Satellite Image */}
                <div style={{ background: '#1e293b', padding: '12px', borderRadius: '8px', border: '1px solid #334155' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#ef4444', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>🚨 PRESENT DISASTER SATELLITE</span>
                    <span style={{ color: '#fca5a5', fontSize: '0.65rem' }}>Post-Event (Current)</span>
                  </div>
                  <div style={{ height: '220px', background: '#0f172a', borderRadius: '6px', overflow: 'hidden' }}>
                    {imageUrl ? (
                      <img src={imageUrl} alt="Present Disaster Satellite" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>No Present Image</div>
                    )}
                  </div>
                </div>

                {/* Panel 3: 3D Surface Disaster Change Heatmap */}
                <div style={{ background: '#1e293b', padding: '12px', borderRadius: '8px', border: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#f59e0b', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>🗺️ DISASTER CHANGE HEATMAP</span>
                    <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fde047', fontSize: '0.62rem', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                      Spatial Overlay
                    </span>
                  </div>

                  {/* Heatmap Layer Container */}
                  <div style={{ height: '200px', background: '#0f172a', borderRadius: '6px', overflow: 'hidden', position: 'relative' }}>
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt="Present Satellite Base"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, zIndex: 1 }}
                      />
                    )}

                    {damageData.changeHeatmapUrl ? (
                      <img
                        src={damageData.changeHeatmapUrl}
                        alt="Damage Overlay"
                        style={{
                          width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, zIndex: 2,
                          opacity: heatmapViewMode === 'satellite' ? 0 : heatmapOpacity,
                          transition: 'opacity 0.2s ease',
                        }}
                      />
                    ) : (
                      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.75rem', zIndex: 3, position: 'relative' }}>
                        Run Comparison Analysis
                      </div>
                    )}

                    {/* Epicenter Pin Callout */}
                    {damageData.epicenterPos && (
                      <div style={{
                        position: 'absolute',
                        left: `${(damageData.epicenterPos[0] / 512.0) * 100}%`,
                        top: `${(damageData.epicenterPos[1] / 512.0) * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 4,
                        background: 'rgba(239, 68, 68, 0.9)',
                        color: '#ffffff',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        fontSize: '0.58rem',
                        fontWeight: 'bold',
                        border: '1px solid #ffffff',
                        boxShadow: '0 0 10px rgba(239, 68, 68, 0.8)',
                        pointerEvents: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}>
                        <AlertTriangle size={10} /> IMPACT ZONE
                      </div>
                    )}
                  </div>

                  {/* Heatmap Controls: Mode Toggle + Opacity Slider */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', padding: '4px 6px', background: 'rgba(15, 23, 42, 0.6)', borderRadius: '4px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={() => setHeatmapViewMode('blended')}
                        style={{
                          background: heatmapViewMode === 'blended' ? '#3b82f6' : 'transparent',
                          color: heatmapViewMode === 'blended' ? '#ffffff' : '#94a3b8',
                          border: 'none', borderRadius: '4px', padding: '2px 6px', fontSize: '0.62rem', fontWeight: 'bold', cursor: 'pointer'
                        }}
                      >
                        🗺️ Heatmap
                      </button>
                      <button
                        onClick={() => setHeatmapViewMode('satellite')}
                        style={{
                          background: heatmapViewMode === 'satellite' ? '#3b82f6' : 'transparent',
                          color: heatmapViewMode === 'satellite' ? '#ffffff' : '#94a3b8',
                          border: 'none', borderRadius: '4px', padding: '2px 6px', fontSize: '0.62rem', fontWeight: 'bold', cursor: 'pointer'
                        }}
                      >
                        📷 Satellite
                      </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.6rem', color: '#94a3b8' }}>
                      <span>Opacity:</span>
                      <input
                        type="range" min="0.1" max="1.0" step="0.05"
                        value={heatmapOpacity}
                        onChange={(e) => {
                          setHeatmapOpacity(parseFloat(e.target.value));
                          if (heatmapViewMode !== 'blended') setHeatmapViewMode('blended');
                        }}
                        style={{ width: '50px', height: '4px', accentColor: '#f59e0b', cursor: 'pointer' }}
                      />
                      <span style={{ color: '#f8fafc', fontWeight: 'bold', minWidth: '22px' }}>{Math.round(heatmapOpacity * 100)}%</span>
                    </div>
                  </div>

                  {/* Heatmap Color Key / Legend */}
                  <div style={{ marginTop: '6px', padding: '6px 8px', background: 'rgba(15, 23, 42, 0.8)', borderRadius: '6px', border: '1px solid #334155' }}>
                    <div style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#94a3b8', marginBottom: '4px', textAlign: 'center' }}>
                      HEATMAP COLOR KEY & THRESHOLDS
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', fontSize: '0.58rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#86efac' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }}></span>
                        <span>Clear: No Shift</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#fde047' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }}></span>
                        <span>Amber: Moderate</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#fca5a5' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }}></span>
                        <span>Red: Destroyed</span>
                      </div>
                    </div>
                  </div>

                </div>

              </div>

              {/* Ground-Truth Disaster Impact Metrics Grid */}
              <div style={{ background: 'rgba(15, 23, 42, 0.8)', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#f8fafc', marginBottom: '12px', letterSpacing: '0.5px' }}>
                  📊 DISASTER IMPACT METRICS & GROUND-TRUTH ASSESSMENT
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
                  
                  <div style={{ background: '#1e293b', padding: '10px 14px', borderRadius: '6px', borderLeft: '4px solid #ef4444' }}>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 'bold' }}>DISASTER CATEGORY</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: '800', color: '#ef4444', marginTop: '2px' }}>
                      {damageData.disasterType || 'Disaster Assessment'}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#fca5a5', marginTop: '2px' }}>
                      {damageData.damageStatus || 'Analyzing...'}
                    </div>
                  </div>

                  <div style={{ background: '#1e293b', padding: '10px 14px', borderRadius: '6px', borderLeft: '4px solid #f59e0b' }}>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 'bold' }}>DESTROYED / SUBMERGED STRUCTURES</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#f59e0b', marginTop: '2px' }}>
                      {damageData.buildingCount != null ? `${damageData.buildingCount} footprints` : '---'}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#cbd5e1', marginTop: '2px' }}>
                      Footprint area breakdown
                    </div>
                  </div>

                  <div style={{ background: '#1e293b', padding: '10px 14px', borderRadius: '6px', borderLeft: '4px solid #3b82f6' }}>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 'bold' }}>AFFECTED POPULATION COUNT</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#60a5fa', marginTop: '2px' }}>
                      {damageData.affectedPopulation != null ? `~${damageData.affectedPopulation} residents` : '---'}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#93c5fd', marginTop: '2px' }}>
                      {damageData.populationDensity ? `${damageData.populationDensity}/km² (${damageData.regionType})` : 'Based on ~4.8 per household'}
                    </div>
                  </div>

                  <div style={{ background: '#1e293b', padding: '10px 14px', borderRadius: '6px', borderLeft: '4px solid #10b981' }}>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 'bold' }}>ESTIMATED ECONOMIC COST</div>
                    <div style={{ fontSize: '1.0rem', fontWeight: '800', color: '#34d399', marginTop: '2px' }}>
                      {damageData.costInrLakhs != null ? `₹ ${damageData.costInrLakhs} Lakhs` : '---'}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#a7f3d0', marginTop: '2px' }}>
                      {damageData.costUsd != null ? `$${damageData.costUsd.toLocaleString()} USD` : ''}
                    </div>
                  </div>

                </div>

                {/* Multi-Index Breakdown Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '8px', marginTop: '12px' }}>
                  <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '8px 10px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 'bold' }}>SSIM INTEGRITY</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: '800', color: damageData.meanSsim != null && damageData.meanSsim < 0.7 ? '#ef4444' : '#34d399' }}>
                      {damageData.meanSsim != null ? `${(damageData.meanSsim * 100).toFixed(1)}%` : '---'}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '8px 10px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 'bold' }}>NDVI LOSS</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#22c55e' }}>
                      {damageData.ndviLossPct != null ? `${damageData.ndviLossPct}%` : '---'}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '8px 10px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 'bold' }}>NDWI GAIN</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#3b82f6' }}>
                      {damageData.ndwiGainPct != null ? `${damageData.ndwiGainPct}%` : '---'}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '8px 10px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 'bold' }}>BSI GAIN</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#a78bfa' }}>
                      {damageData.bsiGainPct != null ? `${damageData.bsiGainPct}%` : '---'}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '8px 10px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 'bold' }}>EDGE DISRUPTION</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#f59e0b' }}>
                      {damageData.edgeDisruptionPct != null ? `${damageData.edgeDisruptionPct}%` : '---'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginTop: '12px' }}>
                  <div style={{ background: '#1e293b', padding: '10px 14px', borderRadius: '6px' }}>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Impact Surface Area: </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#f1f5f9' }}>
                      {damageData.impactAreaSqm != null ? `${damageData.impactAreaSqm.toLocaleString()} m² (${damageData.impactAreaHectares} ha)` : '---'}
                    </span>
                  </div>
                  <div style={{ background: '#1e293b', padding: '10px 14px', borderRadius: '6px' }}>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Total Disruption Footprint: </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#f59e0b' }}>
                      {damageData.totalChangePct != null ? `${damageData.totalChangePct}%` : '---'}
                    </span>
                  </div>
                  <div style={{ background: '#1e293b', padding: '10px 14px', borderRadius: '6px' }}>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Rescue Response Time: </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#34d399' }}>
                      {rescueRoute.estTimeMin != null ? `⚡ ${rescueRoute.estTimeMin} mins` : '---'}
                    </span>
                  </div>
                </div>

                {/* Spatial Alignment Badge */}
                {damageData.spatialAligned != null && (
                  <div style={{ marginTop: '8px', fontSize: '0.68rem', color: damageData.spatialAligned ? '#34d399' : '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {damageData.spatialAligned ? '✅ ORB Spatial Registration Applied' : '⚠️ Spatial alignment skipped (insufficient keypoints)'}
                    {damageData.scvMean != null && <span style={{ color: '#94a3b8', marginLeft: '12px' }}>SCV: {damageData.scvMean}%</span>}
                  </div>
                )}
              </div>

          {/* Modal Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', borderTop: '1px solid #1e293b', paddingTop: '16px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="btn-outline"
                style={{ background: '#0284c7', color: '#fff', borderColor: '#38bdf8', fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}
                onClick={() => {
                  toggleLayer('damage');
                  setIsComparisonModalOpen(false);
                }}
              >
                <Layers size={14} /> PROJECT 3D HEATMAP ON TERRAIN
              </button>

              <button
                className="btn-outline"
                style={{ background: '#059669', color: '#fff', borderColor: '#34d399', fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}
                onClick={() => {
                  toggleLayer('rescueRoute');
                  setIsComparisonModalOpen(false);
                }}
              >
                <Navigation size={14} /> VIEW 3D RESCUE ROUTE
              </button>

              <button
                className="btn-outline"
                style={{ background: '#334155', color: '#f8fafc', borderColor: '#475569', fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}
                onClick={handleDownloadReport}
              >
                <Download size={14} /> EXPORT DISASTER REPORT (JSON)
              </button>
            </div>

            <button
              className="btn-outline"
              style={{ padding: '8px 16px', fontSize: '0.75rem' }}
              onClick={() => setIsComparisonModalOpen(false)}
            >
              CLOSE
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
