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
  
  // 3D Spatial Layer System
  layers: {
    rgb: true,
    elevation: false,
    slope: false,
    contours: false,
    rescueRoute: false,
    damage: false,
    buildingBlimps: true,
    population: false,
    moisture: false,
    wireframe: false,
  },

  // Reconstruction Mode: 'relative' | 'metric' | 'reference'
  reconstructionMode: 'relative',
  
  // Surface Type: 'DSM' | 'DTM'
  surfaceType: 'DSM',

  // Rescue Route State
  rescueRoute: {
    startPoint: null,     // { x, y, z, normX, normY }
    endPoint: null,       // { x, y, z, normX, normY }
    pathNodes: [],        // [{ x, y, z, normX, normY }, ...]
    total3dDistance: null,
    horizDistance: null,
    elevGain: null,
    maxSlope: null,
    estTimeMin: null,
    isCalculating: false,
  },

  // Multi-Disaster & Satellite Comparison State
  isComparisonModalOpen: false,
  disasterType: 'auto',
  preDisasterB64: null,
  comparisonTab: 'damage', // 'damage' | 'predictive'

  // Damage & Historical Change State
  damageData: {
    beforeUrl: null,
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
    isFetchingSatellite: false,
    // Enhanced v2 multi-index fields
    spatialAligned: null,
    meanSsim: null,
    ndviLossPct: null,
    ndwiGainPct: null,
    bsiGainPct: null,
    edgeDisruptionPct: null,
    scvMean: null,
    regionType: null,
    populationDensity: null,
    damagedCentroids: null, // Array of [x, y] positions for affected building blimps
  },

  // Predictive Risk & Early Warning State
  predictiveRisk: {
    riskHeatmapUrl: null,
    dangerZones: [],
    earlyWarning: null,
    atRiskAreaSqm: null,
    atRiskAreaHectares: null,
    meanDisplacementM: null,
    gradientShiftScore: null,
    vegetationRecessionScore: null,
    structuralCreepScore: null,
    waterProximityScore: null,
    compositeRiskScore: null,
    isAnalyzing: false,
  },

  // Actions
  setAppState: (state) => set({ appState: state }),
  setImage: (file, url, dimensions) => set((state) => ({
    imageFile: file,
    imageUrl: url,
    imageDimensions: dimensions,
    preDisasterB64: null,
    minMaxPoints: null,
    inspectData: null,
    measurePoints: [],
    measureResult: null,
    isComparisonModalOpen: false,
    damageData: {
      beforeUrl: null,
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
      isFetchingSatellite: false,
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
    },
    rescueRoute: {
      startPoint: null,
      endPoint: null,
      pathNodes: [],
      total3dDistance: null,
      horizDistance: null,
      elevGain: null,
      maxSlope: null,
      estTimeMin: null,
      isCalculating: false,
    },
    layers: {
      ...state.layers,
      damage: false,
      buildingBlimps: true,
      rescueRoute: false,
    },
  })),
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
  setReconstructionMode: (mode) => set({ reconstructionMode: mode }),
  setSurfaceType: (type) => set({ surfaceType: type }),
  setStats: (stats) => set({ stats: { ...stats } }),
  setCalibration: (cal) => set({ calibration: { ...cal }, elevationMode: 'metric', reconstructionMode: 'metric' }),
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
  setIsComparisonModalOpen: (isOpen) => set({ isComparisonModalOpen: isOpen }),
  setDisasterType: (type) => set({ disasterType: type }),
  setPreDisasterB64: (b64) => set({ preDisasterB64: b64 }),
  setComparisonTab: (tab) => set({ comparisonTab: tab }),

  // Predictive risk actions
  setPredictiveRisk: (data) => set((state) => ({
    predictiveRisk: { ...state.predictiveRisk, ...data }
  })),

  // Layer toggle action
  toggleLayer: (layerKey) => set((state) => ({
    layers: { ...state.layers, [layerKey]: !state.layers[layerKey] }
  })),

  // Rescue route actions
  setRouteStartPoint: (pt) => set((state) => ({
    rescueRoute: { ...state.rescueRoute, startPoint: pt, pathNodes: [], total3dDistance: null }
  })),
  setRouteEndPoint: (pt) => set((state) => ({
    rescueRoute: { ...state.rescueRoute, endPoint: pt }
  })),
  setRescueRouteResult: (result) => set((state) => ({
    rescueRoute: { ...state.rescueRoute, ...result, isCalculating: false }
  })),
  setCalculatingRoute: (isCalc) => set((state) => ({
    rescueRoute: { ...state.rescueRoute, isCalculating: isCalc }
  })),

  // Damage analysis actions
  setDamageData: (data) => set((state) => ({
    damageData: { ...state.damageData, ...data }
  })),
}));

