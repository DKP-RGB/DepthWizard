/**
 * Fast Client-Side 8-Connected Road-Following A* Pathfinding Engine
 * Enforces strict road network preference, building rooftop avoidance,
 * and terrain slope obstacle penalties.
 */

export function computeFastRescueRoute(depthFloat32, width, height, sp, ep, rgbImage = null) {
  if (!depthFloat32 || !width || !height || !sp || !ep) return null;

  // 1. Downsample grid for fast sub-10ms execution
  const targetW = Math.min(160, width);
  const targetH = Math.min(160, height);
  const scaleX = targetW / width;
  const scaleY = targetH / height;

  const dsGrid = new Float32Array(targetW * targetH);
  for (let gy = 0; gy < targetH; gy++) {
    for (let gx = 0; gx < targetW; gx++) {
      const origX = Math.min(width - 1, Math.floor(gx / scaleX));
      const origY = Math.min(height - 1, Math.floor(gy / scaleY));
      dsGrid[gy * targetW + gx] = depthFloat32[origY * width + origX] || 0;
    }
  }

  // 2. Local Ground Minimum Filter to detect rooftops vs ground roads
  const localGround = new Float32Array(targetW * targetH);
  const win = 4;
  for (let gy = 0; gy < targetH; gy++) {
    for (let gx = 0; gx < targetW; gx++) {
      let minZ = dsGrid[gy * targetW + gx];
      for (let dy = -win; dy <= win; dy += 2) {
        for (let dx = -win; dx <= win; dx += 2) {
          const nx = Math.max(0, Math.min(targetW - 1, gx + dx));
          const ny = Math.max(0, Math.min(targetH - 1, gy + dy));
          const val = dsGrid[ny * targetW + nx];
          if (val < minZ) minZ = val;
        }
      }
      localGround[gy * targetW + gx] = minZ;
    }
  }

  // 3. Compute Road Preference & Building Obstacle Cost Map
  const costMap = new Float32Array(targetW * targetH);
  const cellMeters = 2.0;

  for (let gy = 0; gy < targetH; gy++) {
    for (let gx = 0; gx < targetW; gx++) {
      const idx = gy * targetW + gx;
      const z = dsGrid[idx];
      const gZ = localGround[idx];

      const zL = gx > 0 ? dsGrid[gy * targetW + (gx - 1)] : z;
      const zR = gx < targetW - 1 ? dsGrid[gy * targetW + (gx + 1)] : z;
      const zU = gy > 0 ? dsGrid[(gy - 1) * targetW + gx] : z;
      const zD = gy < targetH - 1 ? dsGrid[(gy + 1) * targetW + gx] : z;

      const dzdx = (zR - zL) / (2 * cellMeters);
      const dzdy = (zD - zU) / (2 * cellMeters);
      const slopeDeg = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * (180 / Math.PI);

      const isBuildingRoof = (z - gZ) > 0.05 && slopeDeg < 25.0;

      if (slopeDeg > 45.0) {
        costMap[idx] = 9999.0; // Steep cliff obstacle
      } else if (isBuildingRoof) {
        costMap[idx] = 250.0;  // Severe penalty for walking over building roofs
      } else if (slopeDeg < 8.0 && (z - gZ) < 0.02) {
        costMap[idx] = 0.08;   // High road/street discount (follow roads!)
      } else {
        costMap[idx] = 2.5 + 4.0 * (slopeDeg / 45.0); // Off-road terrain penalty
      }
    }
  }

  // 4. Start & End in grid space
  let startGx = Math.max(0, Math.min(targetW - 1, Math.round(sp.px * scaleX)));
  let startGy = Math.max(0, Math.min(targetH - 1, Math.round(sp.py * scaleY)));
  let endGx = Math.max(0, Math.min(targetW - 1, Math.round(ep.px * scaleX)));
  let endGy = Math.max(0, Math.min(targetH - 1, Math.round(ep.py * scaleY)));

  // Snap start & end away from building roofs to nearest road/street
  const snapToRoad = (gx, gy) => {
    let bestDist = Infinity;
    let bestX = gx, bestY = gy;
    for (let r = 0; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx >= 0 && nx < targetW && ny >= 0 && ny < targetH) {
            const cost = costMap[ny * targetW + nx];
            if (cost < 1.0) { // Road node
              const dist = dx * dx + dy * dy;
              if (dist < bestDist) {
                bestDist = dist;
                bestX = nx;
                bestY = ny;
              }
            }
          }
        }
      }
      if (bestDist < Infinity) break;
    }
    return [bestX, bestY];
  };

  [startGx, startGy] = snapToRoad(startGx, startGy);
  [endGx, endGy] = snapToRoad(endGx, endGy);

  const getKey = (x, y) => y * targetW + x;
  const startKey = getKey(startGx, startGy);
  const endKey = getKey(endGx, endGy);

  // 5. A* Priority Queue Search
  const neighbors = [
    [-1, 0, 1.0], [1, 0, 1.0], [0, -1, 1.0], [0, 1, 1.0],
    [-1, -1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [1, 1, 1.414]
  ];

  const gScore = new Map();
  const cameFrom = new Map();
  gScore.set(startKey, 0);

  const openSet = [{ key: startKey, x: startGx, y: startGy, f: 0 }];

  const heuristic = (x, y) => {
    const dx = Math.abs(endGx - x);
    const dy = Math.abs(endGy - y);
    return ((dx + dy) + (1.414 - 2.0) * Math.min(dx, dy)) * cellMeters * 0.08;
  };

  let found = false;
  let iterations = 0;
  const maxIterations = 40000;

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;
    let minIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[minIdx].f) minIdx = i;
    }
    const current = openSet.splice(minIdx, 1)[0];

    if (current.key === endKey) {
      found = true;
      break;
    }

    const { x, y } = current;
    const currCost = costMap[y * targetW + x];

    for (const [dx, dy, distFactor] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < targetW && ny >= 0 && ny < targetH) {
        const nextKey = getKey(nx, ny);
        const nextCost = costMap[nextKey];
        if (nextCost >= 9999.0 && nextKey !== endKey) continue;

        const stepCost = 0.5 * (currCost + nextCost) * distFactor * cellMeters;
        const tentativeG = gScore.get(current.key) + stepCost;

        if (!gScore.has(nextKey) || tentativeG < gScore.get(nextKey)) {
          cameFrom.set(nextKey, current.key);
          gScore.set(nextKey, tentativeG);
          const f = tentativeG + heuristic(nx, ny);
          openSet.push({ key: nextKey, x: nx, y: ny, f: f });
        }
      }
    }
  }

  // Reconstruct path
  const gridPath = [];
  if (found) {
    let curr = endKey;
    while (cameFrom.has(curr)) {
      const gy = Math.floor(curr / targetW);
      const gx = curr % targetW;
      gridPath.push([gx, gy]);
      curr = cameFrom.get(curr);
    }
    gridPath.push([startGx, startGy]);
    gridPath.reverse();
  } else {
    // Direct interpolation fallback
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      gridPath.push([Math.round(startGx + t * (endGx - startGx)), Math.round(startGy + t * (endGy - startGy))]);
    }
  }

  // Map grid path back to full resolution & compute 3D metrics
  const pathNodes = [];
  let total3dM = 0;
  let totalHorizM = 0;
  let elevGainM = 0;
  let maxSlopeDeg = 0;

  for (let i = 0; i < gridPath.length; i++) {
    const [gx, gy] = gridPath[i];
    const px = Math.min(width - 1, Math.max(0, Math.round(gx / scaleX)));
    const py = Math.min(height - 1, Math.max(0, Math.round(gy / scaleY)));
    const idx = py * width + px;
    const val = depthFloat32[idx] || 0;

    const normX = px / (width - 1);
    const normY = py / (height - 1);

    pathNodes.push({
      px, py, normX, normY, z: val
    });

    if (i > 0) {
      const prev = pathNodes[i - 1];
      const horizM = Math.hypot((px - prev.px) * 1.5, (py - prev.py) * 1.5);
      const dzM = (val - prev.z) * 45;
      const step3d = Math.hypot(horizM, dzM);

      totalHorizM += horizM;
      total3dM += step3d;
      if (dzM > 0) elevGainM += dzM;

      const slope = horizM > 0 ? (Math.atan2(Math.abs(dzM), horizM) * 180 / Math.PI) : 0;
      if (slope > maxSlopeDeg) maxSlopeDeg = slope;
    }
  }

  const estTimeMin = (total3dM / 1.4) / 60;

  return {
    pathNodes,
    total3dDistance: Math.round(total3dM * 10) / 10,
    horizDistance: Math.round(totalHorizM * 10) / 10,
    elevGain: Math.round(elevGainM * 10) / 10,
    maxSlope: Math.round(maxSlopeDeg * 10) / 10,
    estTimeMin: Math.round(estTimeMin * 10) / 10,
  };
}
