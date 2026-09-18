import { useRef, useState } from 'react';
import { useStore } from '../store';
import { Upload, X, Check, MapPin } from 'lucide-react';
import { resolveLocationData, fetchASLElevation } from '../lib/locationFetcher';
import './Landing.css';

export default function Landing() {
  const { setAppState, setImage } = useStore();
  const fileInputRef = useRef(null);
  const [showModal, setShowModal] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [geoInfo, setGeoInfo] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [manualLocInput, setManualLocInput] = useState('');
  const [isMatchingLocation, setIsMatchingLocation] = useState(false);

  const handleLookupManualLocation = async () => {
    if (!manualLocInput || !manualLocInput.trim()) return;
    setIsMatchingLocation(true);
    try {
      const result = await resolveLocationData(manualLocInput);
      if (result) {
        setGeoInfo(result);
        useStore.getState().setGeoData(result);
      }
    } catch (e) {
      alert('Could not resolve location. Please enter a valid location (e.g. "Bhopal, India" or "23.2599, 77.4126")');
    } finally {
      setIsMatchingLocation(false);
    }
  };

  const handleFileDrop = async (file) => {
    if (!file) return;

    let parsedGeo = null;
    if (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff')) {
      const { parseGeoTiff } = await import('../lib/geotiffParser');
      parsedGeo = await parseGeoTiff(file);
      if (parsedGeo) {
        const baseElevationASL = await fetchASLElevation(parsedGeo.latitude, parsedGeo.longitude, file.name);
        parsedGeo.baseElevationASL = baseElevationASL;
      }
      setGeoInfo(parsedGeo);
      if (parsedGeo) useStore.getState().setGeoData(parsedGeo);
    } else {
      // Analyze with Gemini Backend
      setIsAnalyzing(true);
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target.result;
        try {
          console.log('Sending image for AI geo-analysis...');
          const res = await fetch('/api/analyze-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64 })
          });
          const data = await res.json();
          if (data) {
            console.log('AI Analysis Result:', data);
            const baseElevationASL = await fetchASLElevation(data.latitude, data.longitude, file.name);
            const geo = {
              isGeoreferenced: true,
              crs: 'EPSG:4326',
              latitude: data.latitude,
              longitude: data.longitude,
              bbox: data.bbox,
              locationName: data.locationName || 'Analyzed Location',
              baseElevationASL: baseElevationASL,
              aiGenerated: true
            };
            setGeoInfo(geo);
            useStore.getState().setGeoData(geo);
          }
        } catch (error) {
          console.error('AI Analysis failed:', error);
          const baseElevationASL = await fetchASLElevation(null, null, file.name);
          const fallbackGeo = {
            isGeoreferenced: false,
            locationName: file.name.replace(/\.[^/.]+$/, ""),
            baseElevationASL: baseElevationASL,
          };
          setGeoInfo(fallbackGeo);
          useStore.getState().setGeoData(fallbackGeo);
        } finally {
          setIsAnalyzing(false);
        }
      };
      reader.readAsDataURL(file);
    }

    const url = URL.createObjectURL(file);
    const isTiff = file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff');

    if (isTiff && parsedGeo && parsedGeo.previewUrl) {
      setPreviewFile(file);
      setPreviewData({ url: parsedGeo.previewUrl, width: parsedGeo.width, height: parsedGeo.height, format: file.name.split('.').pop().toUpperCase(), size: (file.size / 1024).toFixed(1) + ' KB' });
    } else {
      const img = new Image();
      img.onload = () => {
        setPreviewFile(file);
        setPreviewData({ url, width: img.width, height: img.height, format: file.name.split('.').pop().toUpperCase(), size: (file.size / 1024).toFixed(1) + ' KB' });
      };
      img.src = url;
    }
  };

  const handleFileUpload = (e) => {
    handleFileDrop(e.target.files?.[0]);
  };

  const startReconstruction = async () => {
    if (geoInfo) {
      useStore.getState().setGeoData(geoInfo);
    } else if (previewFile) {
      const baseASL = await fetchASLElevation(null, null, previewFile.name);
      useStore.getState().setGeoData({ baseElevationASL: baseASL });
    }
    useStore.getState().setOsmBuildings(null); // Clear previous OSM buildings
    setImage(previewFile, previewData.url, { width: previewData.width, height: previewData.height });
    setAppState('PROCESSING');
  };

  const handleSampleImage = async (filename = 'bhopal.jpg') => {
    try {
      const resp = await fetch(`/demo/${filename}`);
      const blob = await resp.blob();
      const file = new File([blob], filename, { type: filename.endsWith('.tif') ? 'image/tiff' : 'image/jpeg' });
      const url = URL.createObjectURL(file);

      let locData = { locationName: 'Bhopal, India', latitude: 23.2599, longitude: 77.4126, baseElevationASL: 508, bbox: [77.40, 23.25, 77.42, 23.27] };
      if (filename.includes('delhi')) {
        locData = { locationName: 'Delhi, India', latitude: 28.6139, longitude: 77.2090, baseElevationASL: 216, bbox: [77.19, 28.60, 77.22, 28.62] };
      } else if (filename.includes('mumbai')) {
        locData = { locationName: 'Mumbai, India', latitude: 19.0760, longitude: 72.8777, baseElevationASL: 14, bbox: [72.86, 19.06, 72.89, 19.08] };
      } else if (filename.includes('bengaluru')) {
        locData = { locationName: 'Bengaluru, India', latitude: 12.9716, longitude: 77.5946, baseElevationASL: 920, bbox: [77.58, 12.96, 77.60, 12.98] };
      } else if (filename.includes('new-york')) {
        locData = { locationName: 'New York, USA', latitude: 40.7128, longitude: -74.0060, baseElevationASL: 10, bbox: [-74.01, 40.70, -73.99, 40.72] };
      }

      useStore.getState().setGeoData(locData);
      useStore.getState().setOsmBuildings(null);

      const img = new Image();
      img.onload = () => {
        setImage(file, url, { width: img.width, height: img.height });
        setAppState('PROCESSING');
      };
      img.src = url;
    } catch (e) {
      console.error('Failed to load sample image:', e);
    }
  };


  return (
    <div className="landing-container">
      <div className="landing-bg-grid"></div>
      
      <div className="landing-content">
        <div className="brand-header">DEPTHWIZARD</div>
        <div className="landing-eyebrow">AI SINGLE-VIEW 3D RECONSTRUCTION</div>
        
        <h1 className="landing-title">
          <span className="text-white">AI-POWERED</span><br/>
          <span className="text-blue">SINGLE-VIEW &rarr; </span>
          <span className="text-cyan">3D TERRAIN</span>
        </h1>
        
        <p className="landing-subtitle">
          Transform any satellite image into an interactive 3D terrain surface<br/>
          — powered by Depth Anything V2 monocular depth estimation.
        </p>
        
        <div className="landing-coords">
          SINGLE OPTICAL IMAGE &rarr; AI FLOAT32 DEPTH &rarr; 3D DISPLACED MESH
        </div>
        
        <div className="landing-actions">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept=".jpg,.jpeg,.png,.tif,.tiff,.webp,image/*" 
            style={{ display: 'none' }} 
          />
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Upload size={18} style={{ marginRight: '8px' }} /> Upload Image
          </button>
          <button className="btn-secondary" onClick={() => handleSampleImage('bhopal.jpg')}>
            Try Bhopal Scene
          </button>
        </div>

        <div style={{ marginTop: '20px', display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', alignSelf: 'center', fontWeight: '600' }}>SAMPLE SCENES:</span>
          {['bhopal.jpg', 'delhi.jpg', 'mumbai.jpg', 'bengaluru.jpg', 'new-york.jpg'].map((file) => (
            <button
              key={file}
              onClick={() => handleSampleImage(file)}
              style={{
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#e2e8f0',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseOver={(e) => e.target.style.borderColor = '#38bdf8'}
              onMouseOut={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
            >
              {file.replace('.jpg', '').toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      
      <div className="landing-footer">
        <div className="footer-item">
          <div className="footer-label">MODEL</div>
          <div className="footer-value">Depth Anything V2 Small</div>
        </div>
        <div className="footer-item">
          <div className="footer-label">ADAPTATION</div>
          <div className="footer-value">Remote Sensing + LoRA</div>
        </div>
        <div className="footer-item">
          <div className="footer-label">BACKEND</div>
          <div className="footer-value text-green">Online (In-Browser)</div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button className="modal-close" onClick={() => { setShowModal(false); setPreviewFile(null); }}><X size={20}/></button>
            <div className="modal-header">
              <h3>Load a Scene</h3>
              <p>Single optical image &rarr; AI depth &rarr; 3D surface.</p>
            </div>
            
            {!previewFile ? (
              <div 
                className="upload-dropzone"
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFileDrop(e.dataTransfer.files?.[0]); }}
              >
                <div className="dropzone-icon"><Upload size={24}/></div>
                <div className="dropzone-title">DROP A SATELLITE IMAGE</div>
                <div className="dropzone-types">PNG &bull; JPG &bull; JPEG &bull; TIFF &bull; GeoTIFF &bull; WEBP</div>
                <button className="btn-outline-white" onClick={() => fileInputRef.current?.click()}>Browse Image</button>
              </div>
            ) : (
              <div className="preview-container">
                <div className="preview-image-wrapper">
                  <div className="upload-dropzone small" style={{marginBottom: '16px'}}>
                    <div className="dropzone-icon small" style={{margin:0, display:'inline-block'}}><Upload size={16}/></div>
                    <div className="dropzone-title" style={{display:'inline-block', margin:'0 10px'}}>DROP A SATELLITE IMAGE</div>
                    <button className="btn-outline-white small" onClick={() => fileInputRef.current?.click()}>Browse Image</button>
                  </div>
                  <img src={previewData.url} alt="Preview" className="preview-image" />
                </div>
                
                <div className="preview-details">
                  <div className="detail-row"><span>Filename</span><span className="detail-val">{previewFile.name}</span></div>
                  <div className="detail-row"><span>Dimensions</span><span className="detail-val">{previewData.width} &times; {previewData.height}</span></div>
                  <div className="detail-row"><span>Format</span><span className="detail-val">{previewData.format}</span></div>
                  <div className="detail-row"><span>Size</span><span className="detail-val">{previewData.size}</span></div>
                </div>

                <div className="location-input-section" style={{ marginTop: '14px', marginBottom: '14px', textAlign: 'left' }}>
                  <label style={{ fontSize: '11px', color: '#38bdf8', fontWeight: '700', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    📍 MANUAL LOCATION ADDER (MATCH SATELLITE TERRAIN & ASL ELEVATION)
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="text" 
                      placeholder="e.g. Bhopal, India or 23.2599, 77.4126" 
                      value={manualLocInput}
                      onChange={(e) => setManualLocInput(e.target.value)}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', background: '#0f172a', border: '1px solid #334155', color: '#fff', fontSize: '12px' }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleLookupManualLocation(); }}
                    />
                    <button 
                      className="btn-secondary small" 
                      onClick={handleLookupManualLocation}
                      disabled={isMatchingLocation}
                      style={{ padding: '8px 12px', fontSize: '12px', whiteSpace: 'nowrap', borderColor: '#38bdf8', color: '#38bdf8' }}
                    >
                      {isMatchingLocation ? 'Matching...' : 'Match Satellite DEM'}
                    </button>
                  </div>
                </div>

                {geoInfo && (
                  <div className="georef-badge" style={{ backgroundColor: '#0f766e', color: '#ffffff', textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '10px 12px', borderRadius: '6px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', fontSize: '12px' }}>
                      📍 Matched Satellite Location: {geoInfo.locationName || 'Custom Location'} <Check size={14}/>
                    </div>
                    <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.9 }}>
                      Lat: {geoInfo.latitude?.toFixed(4)}, Lon: {geoInfo.longitude?.toFixed(4)} &bull; Ground Elevation: {geoInfo.baseElevationASL || 500}m ASL
                    </div>
                  </div>
                )}
                
                <div className="preview-controls">
                  <div className="control-col">
                    <label>MESH RESOLUTION</label>
                    <select className="dropdown-select"><option>Medium (256x256)</option><option>High (512x512)</option></select>
                  </div>
                  <div className="control-col">
                    <label>ELEVATION PROFILE</label>
                    <select className="dropdown-select"><option>Metric ASL (Real-world)</option><option>Relative</option></select>
                  </div>
                </div>
                
                <button 
                  className="btn-primary w-full mt-4" 
                  style={{justifyContent: 'center'}} 
                  onClick={startReconstruction}
                  disabled={isAnalyzing || isMatchingLocation}
                >
                  {isAnalyzing ? 'Analyzing Location...' : 'Reconstruct 3D Surface'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
