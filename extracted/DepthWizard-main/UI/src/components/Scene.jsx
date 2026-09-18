import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, FlyControls, Grid, useTexture, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';

import { contours } from 'd3-contour';
import { geoPath } from 'd3-geo';

const metricFragmentShader = `
  varying float vDepth;
  vec3 elevationColor(float t) {
    if (t < 0.20) return mix(vec3(0.05, 0.1, 0.6), vec3(0.0, 0.6, 0.8), t * 5.0);
    if (t < 0.40) return mix(vec3(0.0, 0.6, 0.8), vec3(0.1, 0.8, 0.2), (t - 0.20) * 5.0);
    if (t < 0.65) return mix(vec3(0.1, 0.8, 0.2), vec3(0.9, 0.8, 0.1), (t - 0.40) * 4.0);
    if (t < 0.85) return mix(vec3(0.9, 0.8, 0.1), vec3(0.9, 0.3, 0.1), (t - 0.65) * 5.0);
    return mix(vec3(0.9, 0.3, 0.1), vec3(1.0, 1.0, 1.0), (t - 0.85) * 6.66);
  }
  void main() {
    float normZ = clamp(vDepth * 2.5, 0.0, 1.0);
    gl_FragColor = vec4(elevationColor(normZ), 1.0);
  }
`;

function useContourTexture(depthMap, depthDimensions, viewMode, stats, geoData) {
  const [texture, setTexture] = useState(null);
  
  useEffect(() => {
    if ((viewMode !== 'Contour' && viewMode !== 'Hybrid') || !depthMap || !depthDimensions.width) return;
    
    const { width, height } = depthDimensions;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = viewMode === 'Contour' ? '#0f172a' : 'transparent';
    ctx.fillRect(0, 0, width, height);
    
    const thresholds = [];
    for (let i = 15; i < 245; i += 15) thresholds.push(i);
    
    const contourGenerator = contours().size([width, height]).thresholds(thresholds);
    const contourPolygons = contourGenerator(depthMap);
    const pathGenerator = geoPath(null, ctx);
    
    const baseASL = geoData?.baseElevationASL || 500;

    const getColor = (val) => {
      const t = val / 255.0;
      if (t < 0.25) return `rgb(0, ${Math.floor(200*t*4)}, 255)`;
      if (t < 0.5) return `rgb(0, 255, ${Math.floor(255 - 255*(t-0.25)*4)})`;
      if (t < 0.75) return `rgb(${Math.floor(255*(t-0.5)*4)}, 255, 0)`;
      return `rgb(255, ${Math.floor(255 - 200*(t-0.75)*4)}, 255)`;
    };

    contourPolygons.forEach((polygon, idx) => {
      ctx.beginPath();
      pathGenerator(polygon);
      ctx.strokeStyle = viewMode === 'Hybrid' ? '#38bdf8' : getColor(polygon.value);
      ctx.lineWidth = viewMode === 'Hybrid' ? 2.0 : 1.5;
      ctx.stroke();

      // Add elevation and slope numbers along contour lines
      if (idx % 2 === 0 && polygon.coordinates && polygon.coordinates.length > 0) {
        const ring = polygon.coordinates[0];
        if (ring && ring.length > 6) {
          const pt = ring[Math.floor(ring.length / 2)];
          if (pt && Array.isArray(pt) && pt.length >= 2) {
            const elevVal = Math.round(baseASL + (polygon.value / 255.0) * 45);
            const slopeVal = Math.round((polygon.value / 255.0) * 30);
            const labelText = `${elevVal}m (${slopeVal}°)`;

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.shadowColor = '#000000';
            ctx.shadowBlur = 4;
            ctx.fillText(labelText, pt[0], pt[1]);
            ctx.shadowBlur = 0;
          }
        }
      }
    });
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    setTexture(tex);
    
    return () => tex.dispose();
  }, [depthMap, depthDimensions, viewMode, stats, geoData]);
  
  return texture;
}


function OSMBuildings({ geojson, geoData, width, height, verticalExaggeration, depthMap, depthDimensions, depthScale }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const meshes = useMemo(() => {
    if (!geojson || !geojson.features || !geoData || (!geoData.bbox && !geoData.latitude)) return [];
    
    let bbox = geoData.bbox;
    if (!bbox) {
      const offset = 0.005;
      bbox = [geoData.longitude - offset, geoData.latitude - offset, geoData.longitude + offset, geoData.latitude + offset];
    }
    const lonMin = bbox[0], latMin = bbox[1], lonMax = bbox[2], latMax = bbox[3];
    const lonRange = lonMax - lonMin;
    const latRange = latMax - latMin;
    
    if (lonRange === 0 || latRange === 0) return [];
    
    const getDepthAt = (u, v) => {
      if (!depthMap || !depthDimensions.width) return 0;
      const px = Math.floor(u * (depthDimensions.width - 1));
      const py = Math.floor((1 - v) * (depthDimensions.height - 1));
      const idx = py * depthDimensions.width + px;
      return (depthMap[idx] || 0) / 255.0;
    };
    
    const shapes = [];
    
    geojson.features.forEach((feature) => {
      if (feature.geometry && feature.geometry.type === 'Polygon') {
        const coords = feature.geometry.coordinates[0];
        if (!coords || coords.length < 3) return;
        
        const shape = new THREE.Shape();
        let centerU = 0, centerV = 0;
        
        coords.forEach((coord, i) => {
          const u = (coord[0] - lonMin) / lonRange;
          const v = (coord[1] - latMin) / latRange;
          const x = u * width - (width / 2);
          const y = v * height - (height / 2);
          
          centerU += u;
          centerV += v;
          
          if (i === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
        });
        
        centerU /= coords.length;
        centerV /= coords.length;
        
        const baseZ = getDepthAt(centerU, centerV) * depthScale;
        
        let h = 10;
        if (feature.properties) {
          if (feature.properties.height) h = parseFloat(feature.properties.height);
          else if (feature.properties['building:levels']) h = parseFloat(feature.properties['building:levels']) * 3;
        }
        if (isNaN(h)) h = 10;
        
        shapes.push({ 
          shape, 
          height: h * 0.02 * verticalExaggeration, 
          baseZ, 
          realHeight: h,
          centerX: centerU * width - (width / 2),
          centerY: centerV * height - (height / 2)
        }); 
      }
    });
    
    return shapes;
  }, [geojson, geoData, width, height, verticalExaggeration, depthMap, depthDimensions, depthScale]);

  if (!meshes.length) return null;

  return (
    <group>
      {meshes.map((m, i) => {
        const geom = new THREE.ExtrudeGeometry(m.shape, { depth: m.height, bevelEnabled: false });
        geom.translate(0, 0, m.baseZ);
        const isHovered = hoveredIdx === i;

        return (
          <mesh 
            key={i} 
            geometry={geom}
            onPointerOver={(e) => { e.stopPropagation(); setHoveredIdx(i); }}
            onPointerOut={(e) => { e.stopPropagation(); setHoveredIdx(null); }}
          >
            <meshStandardMaterial 
              color={isHovered ? "#3b82f6" : "#facc15"} 
              transparent 
              opacity={isHovered ? 0.9 : 0.7} 
            />
            {isHovered && (
              <Html 
                position={[m.centerX, m.centerY, m.baseZ + m.height]} 
                center
                style={{
                  background: 'rgba(15, 23, 42, 0.9)',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                Building Height: {m.realHeight.toFixed(1)}m (estimated)
              </Html>
            )}
          </mesh>
        );
      })}
    </group>
  );
}


function TerrainMesh({ depthMap, depthFloat32, imageDimensions, depthDimensions, imageUrl, viewMode, verticalExaggeration, interactionMode, stats, osmBuildings, overlayBuildings, geoData }) {
  const meshRef = useRef();
  
  const colorTexture = useTexture(imageUrl || '/vite.svg');
  colorTexture.colorSpace = THREE.SRGBColorSpace;

  const aspect = imageDimensions.width / (imageDimensions.height || 1);
  const width = 10;
  const height = 10 / aspect;
  const depthScale = 0.5 * verticalExaggeration;

  const gridRes = 256;

  const depthTexture = useMemo(() => {
    if (!depthMap || !depthDimensions.width) return null;
    const { width, height } = depthDimensions;
    const tex = new THREE.DataTexture(depthMap, width, height, THREE.RedFormat, THREE.UnsignedByteType);
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    return tex;
  }, [depthMap, depthDimensions]);

  const contourTexture = useContourTexture(depthMap, depthDimensions, viewMode, stats, geoData);

  const geometry = useMemo(() => {
    return new THREE.PlaneGeometry(width, height, gridRes, gridRes);
  }, [width, height]);

  // Update vertex Z positions directly from depth float32 array
  useEffect(() => {
    if (!geometry || !depthDimensions.width) return;

    const pos = geometry.attributes.position;
    const count = pos.count;
    const gridW = gridRes + 1;
    const gridH = gridRes + 1;

    let maxVal = -Infinity, minVal = Infinity;
    let maxIdx = 0, minIdx = 0;

    for (let i = 0; i < count; i++) {
      const ix = i % gridW;
      const iy = Math.floor(i / gridW);

      const u = ix / (gridW - 1) - 0.5;
      const v = 0.5 - iy / (gridH - 1);

      const px = Math.min(Math.floor((u + 0.5) * depthDimensions.width), depthDimensions.width - 1);
      const py = Math.min(Math.floor((0.5 - v) * depthDimensions.height), depthDimensions.height - 1);
      const idx = py * depthDimensions.width + px;

      let val = 0;
      if (depthFloat32 && depthFloat32.length > idx) {
        val = depthFloat32[idx];
      } else if (depthMap && depthMap.length > idx) {
        val = depthMap[idx] / 255.0;
      }

      if (val > maxVal) { maxVal = val; maxIdx = i; }
      if (val < minVal) { minVal = val; minIdx = i; }

      const edgeDistX = Math.min(ix, gridW - 1 - ix) / 4.0;
      const edgeDistY = Math.min(iy, gridH - 1 - iy) / 4.0;
      const edgeFactor = Math.min(1.0, Math.min(edgeDistX, edgeDistY));

      const reliefZ = Math.max(0.0, val) * depthScale * edgeFactor;
      pos.setZ(i, reliefZ);
    }

    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    // Calculate Highest and Lowest point 3D coordinates
    const maxIx = maxIdx % gridW;
    const maxIy = Math.floor(maxIdx / gridW);
    const uMax = maxIx / (gridW - 1) - 0.5;
    const vMax = 0.5 - maxIy / (gridH - 1);
    const xMax = uMax * width;
    const yMax = vMax * height;
    const zMax = Math.max(0, maxVal) * depthScale;

    const minIx = minIdx % gridW;
    const minIy = Math.floor(minIdx / gridW);
    const uMin = minIx / (gridW - 1) - 0.5;
    const vMin = 0.5 - minIy / (gridH - 1);
    const xMin = uMin * width;
    const yMin = vMin * height;
    const zMin = Math.max(0, minVal) * depthScale;

    const baseASL = geoData?.baseElevationASL || 500;

    useStore.getState().setMinMaxPoints({
      maxPoint: { x: xMax, y: yMax, z: zMax, aslHeight: baseASL + maxVal * 45, relHeight: maxVal * 45 },
      minPoint: { x: xMin, y: yMin, z: zMin, aslHeight: baseASL + minVal * 45, relHeight: minVal * 45 },
    });

  }, [geometry, depthMap, depthFloat32, depthDimensions, depthScale, width, height, geoData]);

  const materials = useMemo(() => {
    if (viewMode === 'Depth') {
      return new THREE.MeshStandardMaterial({
        map: depthTexture,
        side: THREE.DoubleSide,
        roughness: 0.6,
        metalness: 0.1
      });
    } else if (viewMode === 'Metric DSM') {
      return new THREE.ShaderMaterial({
        uniforms: { depthMap: { value: depthTexture } },
        vertexShader: `
          varying float vDepth;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vDepth = position.z;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: metricFragmentShader,
        side: THREE.DoubleSide
      });
    } else if (viewMode === 'Hybrid' && contourTexture) {
      return new THREE.ShaderMaterial({
        uniforms: {
          map: { value: colorTexture },
          contourMap: { value: contourTexture }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D map;
          uniform sampler2D contourMap;
          varying vec2 vUv;
          void main() {
            vec4 rgb = texture2D(map, vUv);
            vec4 contour = texture2D(contourMap, vUv);
            gl_FragColor = mix(rgb, contour, 0.60);
          }
        `,
        side: THREE.DoubleSide
      });
    } else if (viewMode === 'Contour' && contourTexture) {
      return new THREE.MeshStandardMaterial({
        map: contourTexture,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.1
      });
    } else if (viewMode === 'Wireframe') {
      return new THREE.MeshStandardMaterial({
        color: '#00e5ff',
        wireframe: true,
        side: THREE.DoubleSide
      });
    }

    return new THREE.MeshStandardMaterial({
      map: colorTexture,
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0.1
    });
  }, [colorTexture, depthTexture, viewMode, contourTexture]);

  const inspectData = useStore(state => state.inspectData);
  const measurePoints = useStore(state => state.measurePoints);
  const measureResult = useStore(state => state.measureResult);
  const minMaxPoints = useStore(state => state.minMaxPoints);

  // Inspect / Measure click handler
  const handleMeshClick = useCallback((event) => {
    if (interactionMode === 'Navigate Only') return;
    
    const point = event.point;
    const uv = event.uv;
    
    if (!uv || !depthMap || !depthDimensions.width) return;
    
    const px = Math.floor(uv.x * (depthDimensions.width - 1));
    const py = Math.floor((1 - uv.y) * (depthDimensions.height - 1));
    const depthIdx = py * depthDimensions.width + px;
    const depthVal = depthFloat32 ? depthFloat32[depthIdx] : ((depthMap[depthIdx] || 0) / 255.0);
    
    let slope = 0;
    if (px > 0 && px < depthDimensions.width - 1 && py > 0 && py < depthDimensions.height - 1) {
      const getD = (x, y) => depthFloat32 ? depthFloat32[y * depthDimensions.width + x] : ((depthMap[y * depthDimensions.width + x] || 0) / 255.0);
      const dLeft = getD(px - 1, py);
      const dRight = getD(px + 1, py);
      const dUp = getD(px, py - 1);
      const dDown = getD(px, py + 1);
      const dzdx = (dRight - dLeft) * depthScale / (2 / depthDimensions.width);
      const dzdy = (dDown - dUp) * depthScale / (2 / depthDimensions.height);
      slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * (180 / Math.PI);
    }
    
    const realHeightMeters = depthVal * 45;

    if (interactionMode === 'Inspect') {
      useStore.getState().setInspectData({
        x: point.x,
        y: point.y,
        z: point.z,
        height: realHeightMeters,
        slope: slope,
      });
    } else if (interactionMode === 'Measure') {
      const currentPoints = useStore.getState().measurePoints;
      if (currentPoints.length === 0) {
        useStore.getState().setMeasurePoints([{ x: point.x, y: point.y, z: point.z }]);
        useStore.getState().setMeasureResult(null);
      } else {
        const a = currentPoints[0];
        const b = { x: point.x, y: point.y, z: point.z };
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const horizontalDist = Math.sqrt(dx * dx + dy * dy) * 10;
        const dist3d = Math.sqrt(dx * dx + dy * dy + dz * dz) * 10;
        const heightDiff = Math.abs(dz) * 20;
        
        useStore.getState().setMeasureResult({ horizontalDist, dist3d, heightDiff });
        useStore.getState().setMeasurePoints([a, b]);
      }
    }
  }, [interactionMode, depthMap, depthFloat32, depthDimensions, depthScale]);

  const baseASL = geoData?.baseElevationASL || 500;

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={meshRef} geometry={geometry} material={materials} onClick={handleMeshClick} castShadow receiveShadow />
      
      {overlayBuildings && osmBuildings && (geoData?.bbox || geoData?.latitude) && (
        <OSMBuildings 
          geojson={osmBuildings} 
          geoData={geoData} 
          width={width} 
          height={height} 
          verticalExaggeration={verticalExaggeration} 
          depthMap={depthMap}
          depthDimensions={depthDimensions}
          depthScale={depthScale}
        />
      )}

      {/* HIGHEST & LOWEST POINT 3D BLIMPS & STEEP PINS */}
      {minMaxPoints && (
        <>
          {/* Highest Point 3D Marker Pin */}
          <group position={[minMaxPoints.maxPoint.x, minMaxPoints.maxPoint.y, minMaxPoints.maxPoint.z]}>
            <mesh position={[0, 0, 0]}>
              <sphereGeometry args={[0.08, 16, 16]} />
              <meshBasicMaterial color="#ef4444" />
            </mesh>
            <mesh position={[0, 0, 0.225]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.012, 0.012, 0.45, 8]} />
              <meshBasicMaterial color="#ef4444" />
            </mesh>
          </group>

          <Html position={[minMaxPoints.maxPoint.x, minMaxPoints.maxPoint.y, minMaxPoints.maxPoint.z + 0.5]} center>
            <div style={{
              background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.95), rgba(153, 27, 27, 0.95))',
              color: '#ffffff',
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: '800',
              boxShadow: '0 4px 16px rgba(239, 68, 68, 0.7)',
              border: '1.5px solid #fca5a5',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              letterSpacing: '0.3px',
            }}>
              <span style={{ fontSize: '12px' }}>🔴</span>
              <span>HIGHEST POINT: <strong>{minMaxPoints.maxPoint.aslHeight.toFixed(0)}m ASL</strong> (+{minMaxPoints.maxPoint.relHeight.toFixed(1)}m)</span>
            </div>
          </Html>

          {/* Lowest Point 3D Marker Pin */}
          <group position={[minMaxPoints.minPoint.x, minMaxPoints.minPoint.y, minMaxPoints.minPoint.z]}>
            <mesh position={[0, 0, 0]}>
              <sphereGeometry args={[0.08, 16, 16]} />
              <meshBasicMaterial color="#0284c7" />
            </mesh>
            <mesh position={[0, 0, 0.225]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.012, 0.012, 0.45, 8]} />
              <meshBasicMaterial color="#38bdf8" />
            </mesh>
          </group>

          <Html position={[minMaxPoints.minPoint.x, minMaxPoints.minPoint.y, minMaxPoints.minPoint.z + 0.5]} center>
            <div style={{
              background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.95), rgba(3, 105, 161, 0.95))',
              color: '#ffffff',
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: '800',
              boxShadow: '0 4px 16px rgba(56, 189, 248, 0.7)',
              border: '1.5px solid #7dd3fc',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              letterSpacing: '0.3px',
            }}>
              <span style={{ fontSize: '12px' }}>🔵</span>
              <span>LOWEST POINT: <strong>{minMaxPoints.minPoint.aslHeight.toFixed(0)}m ASL</strong> (Ground)</span>
            </div>
          </Html>
        </>
      )}

      {/* INSPECT MARKER TOOLTIP */}
      {interactionMode === 'Inspect' && inspectData && (
        <Html position={[inspectData.x, inspectData.y, inspectData.z + 0.3]} center>
          <div style={{
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #38bdf8',
            color: '#ffffff',
            padding: '8px 12px',
            borderRadius: '8px',
            fontSize: '11px',
            boxShadow: '0 6px 16px rgba(0,0,0,0.4)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}>
            <div style={{ fontWeight: 'bold', color: '#38bdf8', marginBottom: '4px' }}>🔍 INSPECTION POINT</div>
            <div>Altitude: <strong>{(baseASL + inspectData.height).toFixed(1)}m ASL</strong></div>
            <div>Relative Height: <strong>+{inspectData.height.toFixed(1)}m</strong></div>
            <div>Slope: <strong>{inspectData.slope.toFixed(1)}°</strong></div>
          </div>
        </Html>
      )}

      {/* MEASURE LINE & BADGE */}
      {interactionMode === 'Measure' && measurePoints && measurePoints.length > 0 && (
        <>
          {measurePoints.map((pt, idx) => (
            <mesh key={idx} position={[pt.x, pt.y, pt.z + 0.05]}>
              <sphereGeometry args={[0.08, 16, 16]} />
              <meshBasicMaterial color={idx === 0 ? "#38bdf8" : "#facc15"} />
            </mesh>
          ))}

          {measurePoints.length === 2 && measureResult && (
            <Html position={[(measurePoints[0].x + measurePoints[1].x)/2, (measurePoints[0].y + measurePoints[1].y)/2, (measurePoints[0].z + measurePoints[1].z)/2 + 0.4]} center>
              <div style={{
                background: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid #facc15',
                color: '#ffffff',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '11px',
                boxShadow: '0 6px 16px rgba(0,0,0,0.4)',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}>
                <div style={{ fontWeight: 'bold', color: '#facc15', marginBottom: '4px' }}>📏 3D MEASUREMENT</div>
                <div>3D Line Dist: <strong>{measureResult.dist3d.toFixed(1)}m</strong></div>
                <div>Horizontal Dist: <strong>{measureResult.horizontalDist.toFixed(1)}m</strong></div>
                <div>Height Diff (ΔZ): <strong>+{measureResult.heightDiff.toFixed(1)}m</strong></div>
              </div>
            </Html>
          )}
        </>
      )}
    </group>
  );
}

export default function Scene() {
  const { 
    depthMap, 
    depthFloat32,
    imageDimensions, 
    depthDimensions,
    imageUrl, 
    viewMode, 
    cameraMode, 
    verticalExaggeration, 
    interactionMode,
    stats,
    osmBuildings,
    overlayBuildings,
    geoData,
  } = useStore();

  return (
    <Canvas camera={{ position: [0, 5, 10], fov: 45 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 10, 5]} intensity={1.5} />
      
      {depthMap && imageUrl && (
        <TerrainMesh 
          depthMap={depthMap}
          depthFloat32={depthFloat32}
          imageDimensions={imageDimensions}
          depthDimensions={depthDimensions}
          imageUrl={imageUrl}
          viewMode={viewMode}
          verticalExaggeration={verticalExaggeration}
          interactionMode={interactionMode}
          stats={stats}
          osmBuildings={osmBuildings}
          overlayBuildings={overlayBuildings}
          geoData={geoData}
        />
      )}

      <Grid infiniteGrid fadeDistance={50} sectionColor="#3b82f6" cellColor="#1e2532" position={[0, -2, 0]} />

      {cameraMode === 'Orbit' ? (
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.05} />
      ) : (
        <FlyControls makeDefault movementSpeed={5} rollSpeed={0.5} dragToLook />
      )}
    </Canvas>
  );
}
