import { create } from 'zustand';

export const useStore = create((set) => ({
  // App State
  appState: 'LANDING', // LANDING, PROCESSING, DASHBOARD
  
  // Image Data
  imageFile: null,
  imageUrl: null,
  imageDimensions: { width: 0, height: 0 },
  
  // Depth Data
  depthMap: null,        // Uint8Array for visualization/displacement
  depthFloat32: null,    // Float32Array — the real depth values
  depthUrl: null,        // Grayscale image data URI
  depthDimensions: { width: 0, height: 0 },
  
  // Geo Metadata
  geoData: {
    crs: 'Unknown',
    latitude: null,
    longitude: null,
    altitude: null,
    gsd: null,
    isGeoreferenced: false,
    isMetric: false,
    bbox: null,
    aiGenerated: false,
    locationName: '',
    baseElevationASL: 500, // Default 500m ASL
  },
  
  manualLocation: '',
  minMaxPoints: null, // { maxPoint, minPoint }
  
  // Elevation Mode
  elevationMode: 'relative', // 'relative' or 'metric'
  
  // Reconstruction Stats — ALL must come from real data
  stats: {
    minDepth: null,
    maxDepth: null,
    meanDepth: null,
    processingTime: null,
    validPixelsPct: null,
    outlierPct: null,
    device: null,
  },
  
  // Calibration Results
  calibration: {
    scale: null,
    offset: null,
    minElevation: null,
    maxElevation: null,
    meanElevation: null,
    rmse: null,
    mae: null,
  },
  
  // Backend Status
  backendAvailable: null, // null = unknown, true = ready, false = offline
  backendModel: null,
  
  // 3D Viewer Settings
  viewMode: 'RGB',
  cameraMode: 'Orbit',
  interactionMode: 'Navigate Only',
  
  // Inspect/Measure state
  inspectData: null,   // { x, y, height, slope }
  measurePoints: [],   // [{ x, y, z }, ...]
  measureResult: null, // { horizontalDist, dist3d, heightDiff }
  
  // Right Panel Settings
  verticalExaggeration: 0.20,
  contourInterval: 'Medium',
  fog: true,
  shadows: true,
  slopeOverlay: false,
  overlayBuildings: true,
  osmBuildings: null,
  isFetchingOSM: false,
  
  // Actions
  setAppState: (state) => set({ appState: state }),
  setImage: (file, url, dimensions) => set({ imageFile: file, imageUrl: url, imageDimensions: dimensions }),
  setDepthData: (uint8, float32, url, width, height) => set({
    depthMap: uint8,
    depthFloat32: float32,
    depthUrl: url,
    depthDimensions: { width, height },
  }),
  setManualLocation: (loc) => set({ manualLocation: loc }),
  setMinMaxPoints: (points) => set({ minMaxPoints: points }),
  setGeoData: (data) => set((state) => ({ geoData: { ...state.geoData, ...data } })),
  setElevationMode: (mode) => set({ elevationMode: mode }),
  setStats: (stats) => set({ stats: { ...stats } }),
  setCalibration: (cal) => set({ calibration: { ...cal }, elevationMode: 'metric' }),
  setBackendStatus: (available, model) => set({ backendAvailable: available, backendModel: model }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setCameraMode: (mode) => set({ cameraMode: mode }),
  setInteractionMode: (mode) => set({ interactionMode: mode }),
  setInspectData: (data) => set({ inspectData: data }),
  setMeasurePoints: (points) => set({ measurePoints: points }),
  setMeasureResult: (result) => set({ measureResult: result }),
  setOsmBuildings: (data) => set({ osmBuildings: data }),
  setFetchingOSM: (isFetching) => set({ isFetchingOSM: isFetching }),
  setVerticalExaggeration: (val) => set({ verticalExaggeration: val }),
  setContourInterval: (val) => set({ contourInterval: val }),
  setToggle: (key, val) => set({ [key]: val }),
}));
