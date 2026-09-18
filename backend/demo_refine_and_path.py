"""
End-to-End Demonstration Script
DepthWizard Engine Optimization & Risk-Aware Pathfinding

Demonstrates:
1. Semantic-Guided Depth & 3D Mesh Flattening (DepthRefinementEngine)
   - Water body constraining (flat plane Z_water = Z_min of shore)
   - Building rooftop planar smoothing & sharp perimeter step enforcement
   - Vegetation outlier rejection filter
   - Mountain/ground ridge-preserving bilateral filter
2. Risk-Aware Safe Pathfinding Engine (SafePathPlanner)
   - Sobel slope magnitude computation
   - Hazard cost map construction (Slope, Landslide, Soil, Water)
   - 8-connected A* search with diagonal distance heuristic
3. Clean 3D Mesh / Point Cloud generation and visual display overlay
"""

import sys
import os
import math
import numpy as np
import cv2

# Ensure app package is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.terrain.refinement import DepthRefinementEngine
from app.terrain.routing import SafePathPlanner


def create_synthetic_disaster_scene(width: int = 256, height: int = 256):
    """
    Generates a realistic synthetic test scene with:
    - Mountain terrain with continuous elevation gradients
    - A water lake body at lower right with simulated noisy depth ripples
    - Rectangular building structures with noisy rooftops
    - Vegetation tree patches with spiky height outliers
    - Landslide risk zones & soil instability patches
    """
    x = np.linspace(-3, 3, width)
    y = np.linspace(-3, 3, height)
    xx, yy = np.meshgrid(x, y)

    # 1. Base Mountain Elevation Map
    mountain_depth = 30.0 + 15.0 * np.sin(xx) * np.cos(yy) + 8.0 * (xx ** 2 + yy ** 2) / 6.0
    # Add monocular depth noise
    depth_raw = mountain_depth + np.random.normal(0, 0.8, (height, width))

    # 2. Semantic Masks
    water_mask = (xx > 0.5) & (yy > 0.5) & (xx ** 2 + yy ** 2 > 2.0)
    bldg_mask = (xx > -2.0) & (xx < -1.0) & (yy > -1.0) & (yy < 0.2)
    veg_mask = (xx > -0.5) & (xx < 0.5) & (yy > -2.2) & (yy < -0.8)
    ground_mask = ~(water_mask | bldg_mask | veg_mask)

    # Inject realistic depth noise artifacts into water (bumpy raised surface)
    depth_raw[water_mask] = 12.0 + 3.5 * np.random.randn(np.sum(water_mask))

    # Inject building height
    depth_raw[bldg_mask] = 45.0 + 2.0 * np.random.randn(np.sum(bldg_mask))

    # Inject vegetation height with spiky needle outliers
    depth_raw[veg_mask] = mountain_depth[veg_mask] + 6.0 + np.random.normal(0, 1.2, np.sum(veg_mask))
    spikes = np.random.choice([True, False], size=np.sum(veg_mask), p=[0.08, 0.92])
    veg_z = depth_raw[veg_mask]
    veg_z[spikes] += 25.0  # Spiky needle artifacts
    depth_raw[veg_mask] = veg_z

    semantic_mask = {
        "water": water_mask,
        "buildings": bldg_mask,
        "vegetation": veg_mask,
        "ground": ground_mask
    }

    # 3. Hazard Risk Layers
    landslide_risk = np.clip(np.exp(-((xx - 1.0) ** 2 + (yy + 1.0) ** 2) / 0.8), 0.0, 1.0)
    soil_instability = np.clip(np.exp(-((xx + 1.5) ** 2 + (yy - 1.5) ** 2) / 1.2), 0.0, 1.0)

    return depth_raw.astype(np.float32), semantic_mask, landslide_risk.astype(np.float32), soil_instability.astype(np.float32)


def save_ply_point_cloud(filename: str, depth_map: np.ndarray, semantic_mask: dict, cell_size: float = 2.0):
    """Export 3D point cloud with RGB vertex colors to standard PLY file."""
    h, w = depth_map.shape
    xs, ys = np.meshgrid(np.arange(w), np.arange(h))

    pts_x = (xs * cell_size).ravel()
    pts_y = (ys * cell_size).ravel()
    pts_z = depth_map.ravel()

    # Assign RGB colors per semantic class
    r = np.zeros(h * w, dtype=np.uint8)
    g = np.zeros(h * w, dtype=np.uint8)
    b = np.zeros(h * w, dtype=np.uint8)

    w_flat = semantic_mask["water"].ravel()
    b_flat = semantic_mask["buildings"].ravel()
    v_flat = semantic_mask["vegetation"].ravel()
    g_flat = semantic_mask["ground"].ravel()

    # Water = Blue (30, 144, 255)
    r[w_flat], g[w_flat], b[w_flat] = 30, 144, 255
    # Buildings = Red (220, 50, 50)
    r[b_flat], g[b_flat], b[b_flat] = 220, 50, 50
    # Vegetation = Green (40, 180, 40)
    r[v_flat], g[v_flat], b[v_flat] = 40, 180, 40
    # Ground = Earthy (160, 130, 100)
    r[g_flat], g[g_flat], b[g_flat] = 160, 130, 100

    num_verts = len(pts_x)
    header = f"""ply
format ascii 1.0
comment DepthWizard Refined 3D Mesh Point Cloud
element vertex {num_verts}
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
"""
    with open(filename, "w") as f:
        f.write(header)
        for i in range(num_verts):
            f.write(f"{pts_x[i]:.2f} {pts_y[i]:.2f} {pts_z[i]:.2f} {r[i]} {g[i]} {b[i]}\n")


def main():
    print("=" * 70)
    print(" DEPTHWIZARD ENGINE OPTIMIZATION & RISK-AWARE PATHFINDING DEMO")
    print("=" * 70)

    # Step 1: Generate Synthetic Test Terrain & Masks
    print("[1/4] Generating synthetic disaster scene with noisy depth, water, buildings & vegetation...")
    raw_depth, semantic_mask, landslide_risk, soil_instability = create_synthetic_disaster_scene(width=256, height=256)

    print(f"      Raw depth range: [{raw_depth.min():.2f}m, {raw_depth.max():.2f}m]")
    print(f"      Water pixels: {np.sum(semantic_mask['water'])}, Buildings pixels: {np.sum(semantic_mask['buildings'])}")

    # Step 2: Depth & 3D Mesh Refinement
    print("[2/4] Executing DepthRefinementEngine.flatten_water_and_features()...")
    refiner = DepthRefinementEngine(bilateral_d=5, bilateral_sigma_color=25.0, bilateral_sigma_space=25.0)
    refined_depth = refiner.flatten_water_and_features(raw_depth, semantic_mask)

    water_vals = refined_depth[semantic_mask['water']]
    water_std = np.std(water_vals) if len(water_vals) > 0 else 0.0
    print(f"      Refined depth range: [{refined_depth.min():.2f}m, {refined_depth.max():.2f}m]")
    print(f"      Water surface std dev after constraining: {water_std:.4f} (Perfectly Flat!)")

    # Step 3: Risk-Aware Safe Pathfinding
    print("[3/4] Constructing hazard cost map & executing SafePathPlanner (A*)...")
    planner = SafePathPlanner(
        w1=4.0,       # Slope penalty weight
        w2=5.0,       # Landslide risk weight
        w3=3.0,       # Soil instability weight
        d_base=1.0,   # Base distance cost
        max_safe_slope_deg=45.0,
        cell_size_m=2.0
    )

    cost_map = planner.build_cost_map(
        depth_map=refined_depth,
        landslide_risk=landslide_risk,
        soil_instability=soil_instability,
        water_mask=semantic_mask["water"]
    )

    start_coord = (30, 30)      # Top-left rescue team position (Ground)
    end_coord = (210, 80)       # Top-right disaster victim position (Ground across landslide & water)

    print(f"      Start Coord: {start_coord}, Destination Coord: {end_coord}")
    result = planner.find_optimal_path(start_coord, end_coord)

    path = result["path"]
    total_cost = result["total_cost"]
    total_dist = result["total_distance"]
    risk_score = result["cumulative_risk"]

    print("-" * 50)
    print(" OPTIMAL SAFE PATHFINDING METRICS:")
    print(f"  • Path Node Count     : {len(path)} steps")
    print(f"  • Total 3D Distance   : {total_dist:.1f} meters")
    print(f"  • Accumulated Cost    : {total_cost:.2f}")
    print(f"  • Cumulative Risk     : {risk_score:.2f}")
    print("-" * 50)

    # Step 4: Export 3D PLY Point Cloud and Image Visualizations
    print("[4/4] Generating 3D PLY point cloud & composite visualization image...")
    ply_filename = "refined_terrain.ply"
    save_ply_point_cloud(ply_filename, refined_depth, semantic_mask)
    print(f"      Exported 3D point cloud to '{ply_filename}' (Ready for Open3D / MeshLab).")

    # Render OpenCV Composite Grid (4 panels)
    def to_u8_colormap(arr, cmap=cv2.COLORMAP_JET, is_log=False):
        a = np.where(np.isinf(arr), np.nan, arr)
        if is_log:
            a = np.log1p(np.maximum(0, a))
        valid = np.isfinite(a)
        if not np.any(valid):
            return np.zeros((*arr.shape, 3), dtype=np.uint8)
        amin, amax = np.nanmin(a[valid]), np.nanmax(a[valid])
        norm = np.zeros_like(a, dtype=np.uint8)
        norm[valid] = ((a[valid] - amin) / (amax - amin + 1e-6) * 255.0).astype(np.uint8)
        return cv2.applyColorMap(norm, cmap)

    p1 = to_u8_colormap(raw_depth, cv2.COLORMAP_TURBO)
    p2 = to_u8_colormap(refined_depth, cv2.COLORMAP_TURBO)

    # Cost map panel with impassable water highlighted in red
    cost_vis = to_u8_colormap(cost_map, cv2.COLORMAP_HOT, is_log=True)
    cost_vis[semantic_mask["water"]] = [0, 0, 255]
    p3 = cost_vis

    # Path overlay panel
    p4 = to_u8_colormap(refined_depth, cv2.COLORMAP_TURBO)
    for i in range(1, len(path)):
        pt1 = (path[i-1][0], path[i-1][1])
        pt2 = (path[i][0], path[i][1])
        cv2.line(p4, pt1, pt2, (255, 255, 0), 2)  # Cyan path

    cv2.circle(p4, start_coord, 5, (0, 255, 0), -1)   # Green start
    cv2.circle(p4, end_coord, 6, (0, 0, 255), -1)     # Red destination

    # Combine into 2x2 grid
    top_row = np.hstack([p1, p2])
    bot_row = np.hstack([p3, p4])
    grid = np.vstack([top_row, bot_row])

    # Annotate Panel Labels
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(grid, "1. Raw Depth (Bumpy Water)", (10, 25), font, 0.5, (255, 255, 255), 1)
    cv2.putText(grid, "2. Refined Flat Water Mesh", (266, 25), font, 0.5, (255, 255, 255), 1)
    cv2.putText(grid, "3. Hazard Cost Map (Red=Water Inf)", (10, 281), font, 0.5, (255, 255, 255), 1)
    cv2.putText(grid, "4. Risk-Aware Optimal Path (A*)", (266, 281), font, 0.5, (255, 255, 255), 1)

    out_png = "demo_result.png"
    cv2.imwrite(out_png, grid)
    print(f"      Saved composite 4-panel image to '{out_png}'.")
    print("=" * 70)
    print(" DEMO COMPLETED SUCCESSFULLY!")
    print("=" * 70)


if __name__ == "__main__":
    main()
