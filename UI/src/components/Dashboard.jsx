import { useStore } from '../store';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import Scene from './Scene';
import DisasterComparisonModal from './DisasterComparisonModal';
import { Globe, AlertTriangle, ArrowLeft, Building2 } from 'lucide-react';
import './Dashboard.css';

export default function Dashboard() {
  const { 
    viewMode, setViewMode, 
    cameraMode, setCameraMode, 
    interactionMode, setInteractionMode,
    depthDimensions, backendAvailable, stats,
    setIsComparisonModalOpen, setAppState,
    layers, toggleLayer, damageData
  } = useStore();

  const handleToggleBlimps = () => {
    // Toggle building blimps layer independently from heatmap
    toggleLayer('buildingBlimps');
  };

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

  const isBlimpsActive = layers?.buildingBlimps !== false;
  const blimpCount = damageData?.damagedCentroids?.length || 0;

  return (
    <div className="dashboard-layout">
      {/* Disaster Comparison Modal Window */}
      <DisasterComparisonModal />

      {/* Top Bar */}
      <header className="dashboard-header">
        <div className="header-brand" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button 
            className="btn-outline" 
            onClick={() => setAppState('LANDING')}
            style={{ 
              background: 'rgba(255, 255, 255, 0.08)', 
              borderColor: 'rgba(255, 255, 255, 0.2)', 
              color: '#38bdf8', 
              fontSize: '0.72rem', 
              fontWeight: 'bold', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '4px',
              padding: '4px 10px'
            }}
            title="Return to Hero Landing Page"
          >
            <ArrowLeft size={14} /> Back to Hero
          </button>
          <Globe size={18} className="brand-icon" /> DEPTHWIZARD <span style={{ fontSize: '0.65rem', background: 'rgba(59, 130, 246, 0.2)', padding: '2px 6px', borderRadius: '4px', border: '1px solid #3b82f6' }}>SIH 2026 #26175</span>
        </div>
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          Single-View RGB &rarr; 3D Terrain Intelligence
          <span style={{ 
            fontSize: '0.7rem', 
            fontWeight: 'bold', 
            padding: '2px 8px', 
            borderRadius: '12px',
            background: useStore.getState().reconstructionMode === 'metric' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
            color: useStore.getState().reconstructionMode === 'metric' ? '#34d399' : '#60a5fa',
            border: useStore.getState().reconstructionMode === 'metric' ? '1px solid #10b981' : '1px solid #3b82f6'
          }}>
            {useStore.getState().reconstructionMode === 'metric' ? '● ESTIMATED METRIC MODE' : '○ RELATIVE 3D MODE'}
          </span>
        </div>
        <div className="header-actions">
          <button 
            className="btn-outline"
            style={{
              background: isBlimpsActive ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.08)',
              color: isBlimpsActive ? '#fca5a5' : '#e2e8f0',
              borderColor: isBlimpsActive ? '#ef4444' : 'rgba(255, 255, 255, 0.2)',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              fontSize: '0.72rem',
              transition: 'all 0.2s ease'
            }}
            onClick={handleToggleBlimps}
            title="Toggle 3D Damaged Building Blimps on Terrain"
          >
            <Building2 size={14} />
            {isBlimpsActive ? 'Building Blimps: ON' : 'Building Blimps: OFF'}
          </button>
          <button 
            className="btn-outline" 
            style={{ background: '#2563eb', color: '#fff', borderColor: '#3b82f6', fontWeight: 'bold' }}
            onClick={() => setIsComparisonModalOpen(true)}
          >
            🚨 Dual Image Comparison
          </button>
          <button className="btn-outline" onClick={() => setAppState('LANDING')}>New Upload</button>
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
