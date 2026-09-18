import { useRef, useState, useEffect } from 'react';
import { useStore } from '../store';
import { Upload, X, Check } from 'lucide-react';
import { resolveLocationData, fetchASLElevation } from '../lib/locationFetcher';
import SpinningBorderButton from './ui/spinning-border-button';
import './Landing.css';

const LOCAL_VIDEO_SRC = "/earth-hero.mp4";
const REMOTE_VIDEO_SRC = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260912_104036_bd6924f6-3c8e-417e-8465-6d03c8c2e9e6.mp4";
const POSTER_SRC = "/earth-poster.webp";

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

  const videoARef = useRef(null);
  const videoBRef = useRef(null);

  // Video loop & entrance animation setup
  useEffect(() => {
    // 1. Entrance animation setup
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer = null;
    let safetyTimer = null;
    let cleaned = false;

    const clean = () => {
      if (cleaned) return;
      cleaned = true;
      if (safetyTimer) clearTimeout(safetyTimer);
      if (timer) clearTimeout(timer);
      document.documentElement.classList.remove('anim', 'go');
    };

    if (!isReduced) {
      document.documentElement.classList.add('anim');

      const start = () => {
        if (cleaned) return;
        if (timer) clearTimeout(timer);
        document.documentElement.classList.add('go');

        const onEnd = (e) => {
          if (e.animationName === 'pillIn' && e.target.classList && e.target.classList.contains('btn-ghost')) {
            document.removeEventListener('animationend', onEnd, true);
            clean();
          }
        };
        document.addEventListener('animationend', onEnd, true);
        safetyTimer = setTimeout(clean, 2600);
      };

      timer = setTimeout(start, 900);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(start, start);
      } else {
        start();
      }
    }

    // 2. Video continuous playback controller (No pause calls)
    const videoA = videoARef.current;
    const videoB = videoBRef.current;

    if (videoA) {
      if (isReduced) {
        videoA.pause();
        if (videoB) videoB.pause();
      } else {
        const safePlay = (v) => {
          if (!v) return;
          const p = v.play();
          if (p && typeof p.then === 'function') {
            p.catch(err => {
              console.warn("Video play interrupted/prevented:", err);
            });
          }
        };

        safePlay(videoA);

        // Smooth cross-fade near loop boundary (if dual video present)
        if (videoB) {
          let swapping = false;
          const FADE = 0.9;

          const tick = () => {
            if (swapping || !videoA.duration || isNaN(videoA.duration) || videoA.duration < 4.0) return;
            if (videoA.currentTime > 5.0 && (videoA.duration - videoA.currentTime <= FADE)) {
              swapping = true;
              videoB.currentTime = 0;
              safePlay(videoB);
              videoB.classList.add('is-active');
              videoA.classList.remove('is-active');

              setTimeout(() => {
                videoA.currentTime = 0;
                safePlay(videoA);
                videoA.classList.add('is-active');
                videoB.classList.remove('is-active');
                swapping = false;
              }, FADE * 1000 + 200);
            }
          };

          videoA.addEventListener('timeupdate', tick);
          return () => {
            videoA.removeEventListener('timeupdate', tick);
            clean();
          };
        }
      }
    }

    return () => clean();
  }, []);

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

    const objectUrl = URL.createObjectURL(file);
    const isTiff = file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff');

    const cleanLocationName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");

    const initialGeo = {
      isGeoreferenced: false,
      locationName: cleanLocationName,
      baseElevationASL: 500,
    };

    setGeoInfo(initialGeo);
    useStore.getState().setGeoData(initialGeo);
    useStore.getState().setOsmBuildings(null);

    // Immediately start reconstruction with standard image loader
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.width || 512, height: img.height || 512 };
      setImage(file, objectUrl, dims);
      setShowModal(false);
      setAppState('PROCESSING');
    };
    img.onerror = () => {
      setImage(file, objectUrl, { width: 512, height: 512 });
      setShowModal(false);
      setAppState('PROCESSING');
    };
    img.src = objectUrl;

    // Optional background GeoTIFF parse
    if (isTiff) {
      try {
        const { parseGeoTiff } = await import('../lib/geotiffParser');
        const parsedGeo = await parseGeoTiff(file);
        if (parsedGeo) {
          useStore.getState().setGeoData(parsedGeo);
        }
      } catch (err) {
        console.warn('GeoTIFF parsing failed, using standard image loader:', err);
      }
    }

    // AI Autofetch: Try to resolve real location from the filename in the background
    if (!isTiff && cleanLocationName && cleanLocationName.length > 2) {
      try {
        const locResult = await resolveLocationData(cleanLocationName);
        if (locResult && locResult.latitude) {
          setGeoInfo(locResult);
          useStore.getState().setGeoData(locResult);
        }
      } catch (locErr) {
        console.warn('AI location autofetch from filename failed (non-critical):', locErr);
      }
    }
  };

  const handleFileUpload = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileDrop(e.target.files[0]);
    }
    e.target.value = '';
  };

  const startReconstruction = async () => {
    if (!previewFile) return;
    const finalUrl = previewData ? previewData.url : URL.createObjectURL(previewFile);
    const finalDims = {
      width: previewData ? previewData.width : 512,
      height: previewData ? previewData.height : 512
    };
    if (geoInfo) {
      useStore.getState().setGeoData(geoInfo);
    } else {
      useStore.getState().setGeoData({
        isGeoreferenced: false,
        locationName: previewFile.name.replace(/\.[^/.]+$/, ""),
        baseElevationASL: 500
      });
    }
    useStore.getState().setOsmBuildings(null);
    setImage(previewFile, finalUrl, finalDims);
    setShowModal(false);
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
      } else if (filename.includes('kedarnath')) {
        locData = { locationName: 'Kedarnath, Uttarakhand, India', latitude: 30.7346, longitude: 79.0669, baseElevationASL: 3583, isGeoreferenced: true, isMetric: true, bbox: [79.05, 30.72, 79.08, 30.75] };
      }

      useStore.getState().setGeoData(locData);
      useStore.getState().setOsmBuildings(null);

      // Set image and transition to PROCESSING immediately
      setImage(file, url, { width: 512, height: 512 });
      setAppState('PROCESSING');

      const img = new Image();
      img.onload = () => {
        setImage(file, url, { width: img.width, height: img.height });
      };
      img.src = url;
    } catch (e) {
      console.error('Failed to load sample image:', e);
    }
  };

  // Special Kedarnath Disaster handler — loads the after image, prefetches before,
  // and auto-opens comparison modal for instant disaster analysis
  const handleKedarnathSample = async () => {
    try {
      // 1. Load the AFTER (post-disaster) image
      const afterResp = await fetch('/demo/kedarnath_after.jpg');
      const afterBlob = await afterResp.blob();
      const afterFile = new File([afterBlob], 'kedarnath_after.jpg', { type: 'image/jpeg' });
      const afterUrl = URL.createObjectURL(afterFile);

      // 2. Set correct Kedarnath geo data (ASL = 3583m, real coordinates)
      const locData = {
        locationName: 'Kedarnath, Uttarakhand, India',
        latitude: 30.7346,
        longitude: 79.0669,
        baseElevationASL: 3583,
        isGeoreferenced: true,
        isMetric: true,
        crs: 'EPSG:4326',
        bbox: [79.05, 30.72, 79.08, 30.75],
      };

      useStore.getState().setGeoData(locData);
      useStore.getState().setOsmBuildings(null);
      // Kedarnath 2013 was a flash flood disaster — set correct disaster type
      useStore.getState().setDisasterType('Flood & Inundation');

      // 3. Set after image and go to PROCESSING
      setImage(afterFile, afterUrl, { width: 512, height: 512 });
      setAppState('PROCESSING');

      const img = new Image();
      img.onload = () => {
        setImage(afterFile, afterUrl, { width: img.width, height: img.height });
      };
      img.src = afterUrl;

      // 4. Prefetch the BEFORE (pre-disaster) image in background
      // This will be base64-encoded and set into the store so the comparison modal can use it immediately
      try {
        const beforeResp = await fetch('/demo/kedarnath_before.jpg');
        const beforeBlob = await beforeResp.blob();
        const reader = new FileReader();
        reader.onload = () => {
          const b64 = reader.result.split(',')[1];
          useStore.getState().setPreDisasterB64(b64);
        };
        reader.readAsDataURL(beforeBlob);
      } catch (prefetchErr) {
        console.warn('Failed to prefetch Kedarnath before image:', prefetchErr);
      }
    } catch (e) {
      console.error('Failed to load Kedarnath sample:', e);
    }
  };

  const ArrowSVG = () => (
    <svg className="arw" viewBox="0 0 12 10" fill="none" aria-hidden="true">
      <path d="M0.8 5h10M7.1 1.4 10.9 5l-3.8 3.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  return (
    <main className="hero">
      {/* Top-level file input for immediate native OS file selector */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        accept=".jpg,.jpeg,.png,.tif,.tiff,.webp,image/*" 
        style={{ display: 'none' }} 
      />

      <div className="bg" role="img" aria-label="Stylised globe of Earth rendered as a purple dot matrix against a starfield, slowly rotating">
        <video 
          ref={videoARef} 
          className="bg-video is-active" 
          id="bgVideoA" 
          autoPlay 
          muted 
          loop 
          playsInline 
          preload="auto" 
          disablePictureInPicture 
          aria-hidden="true" 
          poster={POSTER_SRC}
          onCanPlay={() => { if (videoARef.current) videoARef.current.classList.add('is-active'); }}
        >
          <source src={LOCAL_VIDEO_SRC} type="video/mp4" />
          <source src={REMOTE_VIDEO_SRC} type="video/mp4" />
        </video>
        <video 
          ref={videoBRef} 
          className="bg-video" 
          id="bgVideoB" 
          muted 
          loop 
          playsInline 
          preload="auto" 
          disablePictureInPicture 
          aria-hidden="true" 
          poster={POSTER_SRC}
          onCanPlay={() => { if (videoBRef.current) videoBRef.current.classList.add('is-active'); }}
        >
          <source src={LOCAL_VIDEO_SRC} type="video/mp4" />
          <source src={REMOTE_VIDEO_SRC} type="video/mp4" />
        </video>
      </div>


      <div className="hero-inner">
        <div className="brand-badge">DEPTHWIZARD</div>

        <h1>
          <span className="ln"><span className="ln-i">Single-View</span></span>
          <span className="ln"><span className="ln-i">Terrain 3D</span></span>
        </h1>

        <p className="sub">
          Accept single satellite imagery, estimate AI depth with precision,<br/>
          enjoy seamless 3D elevation mesh generation and spatial intelligence,<br/>
          and explore integrated disaster analysis tools.
        </p>

        <div className="ctas">
          <button className="btn btn-lg btn-primary" onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} style={{ marginRight: '6px' }} /> Upload Image <ArrowSVG />
          </button>
          <SpinningBorderButton onClick={handleKedarnathSample}>
            🚨 Try Kedarnath Scene
          </SpinningBorderButton>
        </div>

        <div className="sample-scenes-bar">
          <span className="sample-label">SAMPLE SCENES:</span>
          {[
            { name: 'KEDARNATH DISASTER 🚨', file: 'kedarnath_after.jpg', isKedarnath: true },
            { name: 'DELHI', file: 'delhi.jpg' },
            { name: 'MUMBAI', file: 'mumbai.jpg' },
            { name: 'BENGALURU', file: 'bengaluru.jpg' },
            { name: 'NEW YORK', file: 'new-york.jpg' }
          ].map((item) => (
            <button
              key={item.file}
              className="sample-btn"
              onClick={() => item.isKedarnath ? handleKedarnathSample() : handleSampleImage(item.file)}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>


      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button className="modal-close" onClick={() => { setShowModal(false); setPreviewFile(null); }}><X size={20}/></button>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3>Load a Scene</h3>
                <p>Single optical image &rarr; AI depth &rarr; 3D surface.</p>
              </div>
              <button 
                onClick={() => { setShowModal(false); setPreviewFile(null); }}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#fff',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  marginRight: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                &larr; Back to Hero
              </button>
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
    </main>
  );
}

