import { useStore } from '../store';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import Scene from './Scene';
import { Globe } from 'lucide-react';
import './Dashboard.css';

export default function Dashboard() {
  const { 
    viewMode, setViewMode, 
    cameraMode, setCameraMode, 
    interactionMode, setInteractionMode,
    depthDimensions, backendAvailable, stats,
  } = useStore();

  const viewModes = ['RGB', 'Depth', 'Metric DSM', 'Hybrid', 'Wireframe', 'Contour'];
  
  const meshRes = depthDimensions.width && depthDimensions.height 
    ? `${depthDimensions.width}x${depthDimensions.height}` 
    : '---';
  const vertCount = depthDimensions.width && depthDimensions.height 
    ? (depthDimensions.width * depthDimensions.height).toLocaleString()
    : '---';
  const deviceLabel = stats.device || 'Unknown';
  const statusLabel = backendAvailable === true 
    ? `Model Ready · Python (${deviceLabel})` 
    : backendAvailable === false 
    ? 'Model Ready · Browser' 
    : 'Model Ready';

  return (
    <div className="dashboard-layout">
      {/* Top Bar */}
      <header className="dashboard-header">
        <div className="header-brand">
          <Globe size={18} className="brand-icon" /> DEPTHWIZARD
        </div>
        <div className="header-title">Single-View RGB &rarr; 3D DSM</div>
        <div className="header-actions">
          <button className="btn-outline" onClick={() => window.location.reload()}>New Upload</button>
          <button className="btn-outline">Export</button>
          <div className="status-badge"><span className="dot green"></span> {statusLabel}</div>
        </div>
      </header>
      
      <div className="dashboard-main">
        <LeftSidebar />
        
        <div className="viewer-container">
          <div className="viewer-toolbar">
            <div className="toolbar-group">
              {viewModes.map(m => (
                <button 
                  key={m} 
                  className={`toolbar-btn ${viewMode === m ? 'active' : ''}`}
                  onClick={() => setViewMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            
            <div className="toolbar-group">
              <button 
                className={`toolbar-btn ${cameraMode === 'Orbit' ? 'active' : ''}`}
                onClick={() => setCameraMode('Orbit')}
              >Orbit</button>
              <button 
                className={`toolbar-btn ${cameraMode === 'Fly' ? 'active' : ''}`}
                onClick={() => setCameraMode('Fly')}
              >Fly</button>
            </div>
            
            <div className="toolbar-group">
              <button 
                className={`toolbar-btn ${interactionMode === 'Inspect' ? 'active' : ''}`}
                onClick={() => setInteractionMode('Inspect')}
              >Inspect</button>
              <button 
                className={`toolbar-btn ${interactionMode === 'Measure' ? 'active' : ''}`}
                onClick={() => setInteractionMode('Measure')}
              >Measure</button>
              <button 
                className={`toolbar-btn ${interactionMode === 'Navigate Only' ? 'active' : ''}`}
                onClick={() => setInteractionMode('Navigate Only')}
              >Navigate Only</button>
            </div>
          </div>
          
          <div className="canvas-wrapper">
            <Scene />
          </div>
          
          <div className="viewer-footer">
            Mesh {meshRes} ({vertCount} verts) · Device: {deviceLabel}
          </div>
        </div>
        
        <RightSidebar />
      </div>
    </div>
  );
}
