import { useEffect, useState, useRef } from 'react';
import { useStore } from '../store';
import './Processing.css';

const STEPS = [
  'Image Analysis',
  'Depth Extraction',
  'Depth Refinement',
  'Scale Calibration',
  'DSM Generation',
  'Mesh Construction',
  'Texture Projection',
  '3D Environment Ready'
];

export default function Processing() {
  const { imageUrl, imageFile, setDepthData, setAppState, setStats, setBackendStatus } = useStore();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [statusMessage, setStatusMessage] = useState('Initializing...');
  const [inferenceDevice, setInferenceDevice] = useState('CPU');
  const workerRef = useRef(null);
  const startTime = useRef(Date.now());

  useEffect(() => {
    if (!imageUrl) {
      setAppState('LANDING');
      return;
    }

    let cancelled = false;

    const runPipeline = async () => {
      // Step 0: Image Analysis
      setCurrentStepIndex(0);
      setStatusMessage('Analyzing image...');

      // Try Python backend first
      try {
        const healthRes = await fetch('/pyapi/health', { signal: AbortSignal.timeout(3000) });
        if (healthRes.ok) {
          const health = await healthRes.json();
          setBackendStatus(true, health.model);
          setInferenceDevice(health.device === 'cpu' ? 'CPU' : 'GPU');

          // Backend is available — use it
          setCurrentStepIndex(1);
          setStatusMessage('Running Depth Anything V2 (Python backend)...');

          const formData = new FormData();
          if (imageFile) {
            formData.append('file', imageFile);
          } else {
            // Convert imageUrl (blob URL or data URI) to file
            const resp = await fetch(imageUrl);
            const blob = await resp.blob();
            formData.append('file', new File([blob], 'image.png', { type: blob.type }));
          }

          const res = await fetch('/pyapi/reconstruct', {
            method: 'POST',
            body: formData,
          });

          if (!res.ok) {
            throw new Error(`Backend error: ${res.status}`);
          }

          const data = await res.json();
          if (cancelled) return;

          // Step 2-6: Fast forward visual steps
          for (let step = 2; step < STEPS.length; step++) {
            if (cancelled) return;
            setCurrentStepIndex(step);
            setStatusMessage(STEPS[step] + '...');
            await new Promise(r => setTimeout(r, 300));
          }

          // Decode float32 depth array
          const float32Bytes = Uint8Array.from(atob(data.depth_float32), c => c.charCodeAt(0));
          const depthFloat32 = new Float32Array(float32Bytes.buffer);

          // Create uint8 visualization for Three.js displacement
          const uint8Depth = new Uint8Array(depthFloat32.length);
          for (let i = 0; i < depthFloat32.length; i++) {
            uint8Depth[i] = Math.round(depthFloat32[i] * 255);
          }

          const depthPngUrl = `data:image/png;base64,${data.depth_png}`;

          setDepthData(uint8Depth, depthFloat32, depthPngUrl, data.width, data.height);
          setStats({
            minDepth: data.min_depth,
            maxDepth: data.max_depth,
            meanDepth: data.mean_depth,
            processingTime: data.processing_time,
            validPixelsPct: data.valid_pixels_pct,
            outlierPct: data.outlier_pct,
            device: data.device,
          });
          setAppState('DASHBOARD');
          return;
        }
      } catch (e) {
        console.warn('Python backend unavailable, falling back to browser inference:', e.message);
        setBackendStatus(false, null);
      }

      // FALLBACK: Browser-based inference via Web Worker
      if (cancelled) return;
      setStatusMessage('Loading AI model in browser (WebGPU/WASM)...');

      workerRef.current = new Worker(new URL('../lib/depthWorker.js', import.meta.url), {
        type: 'module'
      });

      workerRef.current.onmessage = (e) => {
        const msg = e.data;

        if (msg.status === 'progress') {
          if (msg.data && msg.data.status === 'downloading') {
            const p = msg.data.progress || 0;
            setDownloadProgress(`Downloading model: ${msg.data.file || '...'} (${p.toFixed(1)}%)`);
          } else if (msg.data && msg.data.status === 'ready') {
            setDownloadProgress('');
          }
        }

        if (msg.status === 'ready') {
          setCurrentStepIndex(1);
          setStatusMessage('Extracting depth (browser)...');
          workerRef.current.postMessage({ type: 'predict', imageUrl });
        }

        if (msg.status === 'complete') {
          const { width, height, data } = msg.result;

          // Normalize
          let min = Infinity, max = -Infinity;
          for (let i = 0; i < data.length; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
          }

          const range = max - min;
          const normalizedUint8 = new Uint8Array(data.length);
          const normalizedFloat32 = new Float32Array(data.length);

          if (range > 0) {
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - min) / range;
              normalizedFloat32[i] = v;
              normalizedUint8[i] = Math.round(v * 255);
            }
          }

          // Generate grayscale data URI for UI previews
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          const imgData = ctx.createImageData(width, height);
          for (let i = 0; i < normalizedUint8.length; i++) {
            const val = normalizedUint8[i];
            const idx = i * 4;
            imgData.data[idx] = val;
            imgData.data[idx + 1] = val;
            imgData.data[idx + 2] = val;
            imgData.data[idx + 3] = 255;
          }
          ctx.putImageData(imgData, 0, 0);
          const depthPngUrl = canvas.toDataURL('image/png');

          const endTime = Date.now();
          const mean = data.length > 0 ? Array.from(data).reduce((a, b) => a + b, 0) / data.length : 0;

          setDepthData(normalizedUint8, normalizedFloat32, depthPngUrl, width, height);
          setStats({
            minDepth: min,
            maxDepth: max,
            meanDepth: mean,
            processingTime: ((endTime - startTime.current) / 1000).toFixed(4),
            validPixelsPct: 100,
            outlierPct: 0,
            device: 'browser (WebGPU/WASM)',
          });

          // Animate remaining steps
          let step = 2;
          const interval = setInterval(() => {
            setCurrentStepIndex(step);
            step++;
            if (step >= STEPS.length) {
              clearInterval(interval);
              setAppState('DASHBOARD');
            }
          }, 250);
        }

        if (msg.status === 'error') {
          console.error('Worker error:', msg.error);
          alert('Error processing image: ' + msg.error);
          setAppState('LANDING');
        }
      };

      workerRef.current.postMessage({ type: 'load' });
    };

    runPipeline();

    return () => {
      cancelled = true;
      if (workerRef.current) workerRef.current.terminate();
    };
  }, [imageUrl]);

  return (
    <div className="processing-container">
      <div className="processing-bg-grid"></div>
      
      <div className="modal-overlay">
        <div className="modal-content processing-modal">
          <div className="modal-header" style={{marginBottom: '20px'}}>
            <h3 style={{fontSize: '1rem'}}>Reconstructing Scene</h3>
            <p style={{fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px'}}>{statusMessage}</p>
          </div>
          
          {downloadProgress && <div className="download-progress">{downloadProgress}</div>}
          
          <div className="steps-container">
            {STEPS.map((step, index) => {
              let statusClass = 'pending';
              if (index < currentStepIndex) statusClass = 'done';
              if (index === currentStepIndex) statusClass = 'active';
              
              const num = String(index + 1).padStart(2, '0');
              
              return (
                <div key={step} className={`step-item ${statusClass}`}>
                  <div className="step-num">{num}</div>
                  <div className="step-indicator">
                    {statusClass === 'done' && '✓'}
                    {statusClass === 'active' && <div className="spinner-half"></div>}
                    {statusClass === 'pending' && <div className="circle-empty"></div>}
                  </div>
                  <div className="step-label">{step}</div>
                  <div className={`step-line ${statusClass}`}></div>
                </div>
              );
            })}
          </div>

          <div className="processing-footer">
            <div className="footer-left">Device: {inferenceDevice}</div>
            <div className="footer-right">Inference: {currentStepIndex > 0 && currentStepIndex < 7 ? 'running...' : currentStepIndex >= 7 ? 'complete' : 'initializing'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
