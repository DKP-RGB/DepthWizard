import { useStore } from '../store';
import { Download } from 'lucide-react';
import { downloadCanvas, downloadMetadata } from '../lib/downloadUtils';

export default function RightSidebar() {
  const { 
    verticalExaggeration, setVerticalExaggeration,
    contourInterval, setContourInterval,
    fog, shadows, slopeOverlay, overlayBuildings, setToggle,
    geoData, stats, calibration, elevationMode, imageFile,
    depthFloat32, depthDimensions,
    inspectData, measureResult, minMaxPoints,
    rescueRoute, damageData, predictiveRisk
  } = useStore();

  const isMetric = elevationMode === 'metric';

  const handleDownloadPLY = () => {
    const { depthFloat32, depthDimensions, imageDimensions, verticalExaggeration } = useStore.getState();
    if (!depthFloat32 || !depthDimensions.width) {
      alert('No height data available for PLY export.');
      return;
    }
    const w = depthDimensions.width;
    const h = depthDimensions.height;
    const aspect = (imageDimensions.width || 1) / (imageDimensions.height || 1);
    const meshW = 10;
    const meshH = 10 / aspect;
    const dScale = 0.5 * verticalExaggeration;

    let plyContent = `ply\nformat ascii 1.0\nelement vertex ${w * h}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const val = depthFloat32[idx] || 0;
        const x = (px / (w - 1) - 0.5) * meshW;
        const y = (0.5 - py / (h - 1)) * meshH;
        const z = val * dScale;
        plyContent += `${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}\n`;
      }
    }
    const blob = new Blob([plyContent], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'terrain_pointcloud.ply';
    link.click();
  };

  const handleDownloadNPY = () => {
    if (!depthFloat32) {
      alert('No depth data available.');
      return;
    }
    // Generate NPY file in browser
    // NPY format: magic + version + header + data
    const shape = [depthDimensions.height, depthDimensions.width];
    const header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape[0]}, ${shape[1]}), }`;
    const padding = 64 - ((10 + header.length) % 64);
    const paddedHeader = header + ' '.repeat(padding - 1) + '\n';
    
    const headerBytes = new TextEncoder().encode(paddedHeader);
    const magic = new Uint8Array([0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59, 0x01, 0x00]);
    const headerLen = new Uint8Array(2);
    headerLen[0] = headerBytes.length & 0xFF;
    headerLen[1] = (headerBytes.length >> 8) & 0xFF;
    
    const totalLen = magic.length + headerLen.length + headerBytes.length + depthFloat32.byteLength;
    const buffer = new ArrayBuffer(totalLen);
    const view = new Uint8Array(buffer);
    let offset = 0;
    view.set(magic, offset); offset += magic.length;
    view.set(headerLen, offset); offset += headerLen.length;
    view.set(headerBytes, offset); offset += headerBytes.length;
    view.set(new Uint8Array(depthFloat32.buffer), offset);
    
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'depth_float32.npy';
    link.click();
  };

  // Real elevation range from actual data
  const minElev = isMetric ? calibration.minElevation : stats.minDepth;
  const maxElev = isMetric ? calibration.maxElevation : stats.maxDepth;
  const formatVal = (v) => v != null ? (typeof v === 'number' ? v.toFixed(1) : v) : 'N/A';
  const unit = isMetric ? ' m' : '';

  const { viewMode, setViewMode } = useStore();

  return (
    <div className="sidebar right-sidebar">


      <div className="panel-section">
        <div className="panel-title">3D HEIGHT & CONTROLS</div>
        
        <div className="mb-4">
          <div className="flex-between text-xs mb-2 text-muted">
            <span>VERTICAL EXAGGERATION</span>
            <span>{verticalExaggeration.toFixed(1)}X</span>
          </div>
          <input 
            type="range" 
            min="0.1" 
            max="4.0" 
            step="0.1" 
            value={verticalExaggeration}
            onChange={(e) => setVerticalExaggeration(parseFloat(e.target.value))}
            className="slider"
          />
        </div>

        <div className="mb-4">
          <div className="text-xs mb-2 text-muted">CONTOUR INTERVAL</div>
          <select 
            className="dropdown-select w-full"
            value={contourInterval}
            onChange={(e) => setContourInterval(e.target.value)}
          >
            <option value="Small">Small (10m)</option>
            <option value="Medium">Medium (50m)</option>
            <option value="Large">Large (100m)</option>
          </select>
        </div>

        <div className="checkbox-group mt-2">
          <label className="checkbox-label">
            <span>Overlay 3D City Buildings</span>
            <input type="checkbox" checked={overlayBuildings} onChange={(e) => setToggle('overlayBuildings', e.target.checked)} />
          </label>
        </div>
      </div>

      {/* Map Elevation Extremes (Lowest & Highest) */}
      {minMaxPoints && (
        <div className="panel-section" style={{ background: 'rgba(15, 23, 42, 0.6)', borderRadius: '6px', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
          <div className="panel-title" style={{ color: '#38bdf8' }}>🗻 MAP ELEVATION EXTREMES (ASL)</div>
          <div className="key-value-row">
            <span className="key" style={{ color: '#fca5a5' }}>🔴 Highest Point (Peak/Roof)</span>
            <span className="value" style={{ fontWeight: 'bold', color: '#ef4444' }}>
              {minMaxPoints.maxPoint.aslHeight.toFixed(1)} m ASL
            </span>
          </div>
          <div className="key-value-row">
            <span className="key" style={{ color: '#7dd3fc' }}>🔵 Lowest Point (Ground Level)</span>
            <span className="value" style={{ fontWeight: 'bold', color: '#38bdf8' }}>
              {minMaxPoints.minPoint.aslHeight.toFixed(1)} m ASL
            </span>
          </div>
          <div className="key-value-row">
            <span className="key">Base ASL Ground Datum</span>
            <span className="value">{geoData?.baseElevationASL || 500} m ASL</span>
          </div>
          <div className="key-value-row">
            <span className="key">Total Terrain Relief (ΔZ)</span>
            <span className="value" style={{ color: '#facc15', fontWeight: 'bold' }}>
              +{(minMaxPoints.maxPoint.aslHeight - minMaxPoints.minPoint.aslHeight).toFixed(1)} m
            </span>
          </div>
        </div>
      )}

      {/* Disaster Impact Analytics Readout Card */}
      {damageData && damageData.totalChangePct != null && (
        <div className="panel-section" style={{ background: 'rgba(239, 68, 68, 0.08)', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.35)' }}>
          <div className="panel-title" style={{ color: '#ef4444' }}>🚨 DISASTER IMPACT ANALYTICS</div>
          <div className="key-value-row">
            <span className="key">Disaster Category</span>
            <span className="value" style={{ fontWeight: '800', color: '#f8fafc' }}>
              {damageData.disasterType || 'Disaster Assessment'}
            </span>
          </div>
          <div className="key-value-row">
            <span className="key">Disaster Status</span>
            <span className="value" style={{ fontWeight: '800', color: damageData.highDamagePct > 15 ? '#ef4444' : '#f59e0b' }}>
              {damageData.damageStatus}
            </span>
          </div>
          <div className="key-value-row">
            <span className="key">Damaged / Submerged Structures</span>
            <span className="value" style={{ fontWeight: 'bold', color: '#ef4444' }}>
              {damageData.buildingCount} footprint(s)
            </span>
          </div>
          <div className="key-value-row">
            <span className="key">Affected Population</span>
            <span className="value" style={{ fontWeight: 'bold', color: '#fbbf24' }}>
              ~{damageData.affectedPopulation} residents
            </span>
          </div>
          <div className="key-value-row">
            <span className="key">Impact Surface Area</span>
            <span className="value" style={{ color: '#60a5fa', fontWeight: 'bold' }}>
              {damageData.impactAreaSqm ? `${damageData.impactAreaSqm.toLocaleString()} m² (${damageData.impactAreaHectares} ha)` : `${damageData.totalChangePct}% footprint`}
            </span>
          </div>
          <div className="key-value-row">
            <span className="key">Est. Damage Cost (INR)</span>
            <span className="value" style={{ fontWeight: 'bold', color: '#38bdf8' }}>
              ₹ {damageData.costInrLakhs} Lakhs
            </span>
          </div>
          <div className="key-value-row">
            <span className="key">Est. Damage Cost (USD)</span>
            <span className="value" style={{ color: '#94a3b8' }}>
              ${damageData.costUsd?.toLocaleString()} USD
            </span>
          </div>
          {rescueRoute.estTimeMin != null && (
            <div className="key-value-row" style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px dashed rgba(239, 68, 68, 0.3)' }}>
              <span className="key" style={{ color: '#34d399', fontWeight: 'bold' }}>Rescue Response Time</span>
              <span className="value" style={{ fontWeight: 'bold', color: '#34d399' }}>
                ⚡ {rescueRoute.estTimeMin} mins
              </span>
            </div>
          )}
        </div>
      )}

      {/* Rescue Route Analytics Readout */}
      {rescueRoute.total3dDistance != null && (
        <div className="panel-section" style={{ background: 'rgba(16, 185, 129, 0.08)', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
          <div className="panel-title" style={{ color: '#34d399' }}>🚑 RESCUE ROUTE ANALYTICS</div>
          <div className="key-value-row">
            <span className="key">3D Path Length</span>
            <span className="value" style={{ fontWeight: 'bold', color: '#34d399' }}>{rescueRoute.total3dDistance} m</span>
          </div>
          <div className="key-value-row">
            <span className="key">Horizontal Distance</span>
            <span className="value">{rescueRoute.horizDistance} m</span>
          </div>
          <div className="key-value-row">
            <span className="key">Elevation Gain (ΔZ)</span>
            <span className="value">+{rescueRoute.elevGain} m</span>
          </div>
          <div className="key-value-row">
            <span className="key">Max Slope</span>
            <span className="value" style={{ color: rescueRoute.maxSlope > 30 ? '#ef4444' : '#facc15' }}>
              {rescueRoute.maxSlope}°
            </span>
          </div>
          <div className="key-value-row">
            <span className="key">Est. Response Time</span>
            <span className="value" style={{ color: '#38bdf8', fontWeight: 'bold' }}>{rescueRoute.estTimeMin} mins</span>
          </div>
        </div>
      )}



      {/* Inspect Results */}
      {inspectData && (
        <div className="panel-section" style={{ borderLeft: '3px solid #38bdf8' }}>
          <div className="panel-title" style={{ color: '#38bdf8' }}>🔍 POINT INSPECTION</div>
          <div className="key-value-row">
            <span className="key">ASL Elevation</span>
            <span className="value" style={{ fontWeight: 'bold', color: '#38bdf8' }}>
              {(geoData?.baseElevationASL || 500) + (inspectData.height || 0)} m ASL
            </span>
          </div>
          <div className="key-value-row">
            <span className="key">Relative Height</span>
            <span className="value">+{inspectData.height?.toFixed(1)} m</span>
          </div>
          <div className="key-value-row">
            <span className="key">Terrain Slope</span>
            <span className="value">{inspectData.slope?.toFixed(1)}°</span>
          </div>
        </div>
      )}

      {/* Measure Results */}
      {measureResult && (
        <div className="panel-section" style={{ borderLeft: '3px solid #facc15' }}>
          <div className="panel-title" style={{ color: '#facc15' }}>📏 DISTANCE & HEIGHT MEASUREMENT</div>
          <div className="key-value-row">
            <span className="key">3D Line Distance</span>
            <span className="value" style={{ fontWeight: 'bold', color: '#facc15' }}>{measureResult.dist3d?.toFixed(1)} m</span>
          </div>
          <div className="key-value-row">
            <span className="key">Horizontal Distance</span>
            <span className="value">{measureResult.horizontalDist?.toFixed(1)} m</span>
          </div>
          <div className="key-value-row">
            <span className="key">Height Diff (ΔZ)</span>
            <span className="value">+{measureResult.heightDiff?.toFixed(1)} m</span>
          </div>
        </div>
      )}

      <div className="panel-section">
        <div className="panel-title">EXPORTS & DOWNLOADS</div>
        
        <div className="download-buttons">
          <button className="dl-btn" onClick={() => downloadCanvas('depth_render.png')}><span>Depth PNG</span> <Download size={14}/></button>
          <button className="dl-btn" onClick={() => downloadCanvas('color_render.png')}><span>Color Depth PNG</span> <Download size={14}/></button>
          <button className="dl-btn" onClick={handleDownloadNPY}><span>Raw Float32 NPY</span> <Download size={14}/></button>
          <button className="dl-btn" onClick={() => handleDownloadMesh('obj')}><span>3D Mesh (OBJ)</span> <Download size={14}/></button>
          <button className="dl-btn" onClick={() => handleDownloadMesh('glb')}><span>3D Mesh (GLB)</span> <Download size={14}/></button>
          <button className="dl-btn" onClick={handleDownloadPLY}><span>Point Cloud (PLY)</span> <Download size={14}/></button>
          <button className="dl-btn" onClick={() => downloadCanvas('contour_render.png')}><span>Contour PNG</span> <Download size={14}/></button>
          <button className="dl-btn" onClick={() => downloadMetadata(geoData, stats)}><span>Metadata JSON</span> <Download size={14}/></button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">ELEVATION LEGEND</div>
        <div className="legend-gradient"></div>
        <div className="flex-between text-xs text-muted mt-1">
          <span>{formatVal(minElev)}{unit}</span>
          <span>{formatVal(maxElev)}{unit}</span>
        </div>
      </div>

      <div className="panel-section border-none">
        <div className="panel-title">SLOPE LEGEND</div>
        <div className="slope-legend">
          <div className="slope-item"><span className="swatch c0"></span> 0°</div>
          <div className="slope-item"><span className="swatch c10"></span> 10°</div>
          <div className="slope-item"><span className="swatch c20"></span> 20°</div>
          <div className="slope-item"><span className="swatch c30"></span> 30°</div>
          <div className="slope-item"><span className="swatch c40"></span> 40°</div>
          <div className="slope-item"><span className="swatch c50"></span> 50°+</div>
        </div>
      </div>

      {/* Scientific Disclaimer */}
      <div className="panel-section" style={{ background: 'rgba(15, 23, 42, 0.4)', fontSize: '0.65rem', color: '#94a3b8', fontStyle: 'italic', borderTop: '1px solid var(--border-color)' }}>
        ⚠️ <strong>Scientific Disclaimer</strong>: AI-derived terrain estimates are decision-support indicators. Absolute elevations require reference DEM or ground control calibration.
      </div>
    </div>
  );
}
