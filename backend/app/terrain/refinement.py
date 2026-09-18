"""
DepthRefinementEngine — Semantic-Guided Depth & 3D Mesh Refinement
Applies semantic constraints to 3D elevation maps:
1. Water body flattening to minimum shore elevation Z_min with zero high-frequency variance.
2. Building rooftop planar smoothing (RANSAC/median) with sharp perimeter vertical step enforcement.
3. Vegetation outlier rejection filter to remove spiky floating artifacts.
4. Terrain ridge-preserving bilateral filtering on ground/mountain regions.
"""

import numpy as np
import cv2
from typing import Dict, Union, Optional, Tuple


class DepthRefinementEngine:
    """
    Refines monocular depth maps into clean 3D elevation representations
    using semantic segmentation masks and computer vision operations.
    """

    def __init__(self, bilateral_d: int = 5, bilateral_sigma_color: float = 25.0, bilateral_sigma_space: float = 25.0):
        self.bilateral_d = bilateral_d
        self.bilateral_sigma_color = bilateral_sigma_color
        self.bilateral_sigma_space = bilateral_sigma_space

    def parse_semantic_mask(
        self,
        semantic_mask: Optional[Union[Dict[str, np.ndarray], np.ndarray]] = None,
        rgb_image: Optional[np.ndarray] = None,
        shape: Tuple[int, int] = (512, 512)
    ) -> Dict[str, np.ndarray]:
        """
        Parses or auto-generates semantic masks for WATER, BUILDINGS, VEGETATION, and GROUND.

        Args:
            semantic_mask: Dictionary of boolean masks, or integer index array, or None.
            rgb_image: Optional (H, W, 3) uint8 RGB image for auto-segmentation heuristic.
            shape: (H, W) fallback grid size if mask is missing.

        Returns:
            Dict containing boolean 2D numpy arrays for 'water', 'buildings', 'vegetation', 'ground'.
        """
        if isinstance(semantic_mask, dict):
            # Normalize dictionary keys
            normalized = {}
            for k, v in semantic_mask.items():
                normalized[k.lower()] = v.astype(bool) if isinstance(v, np.ndarray) else v

            h, w = next(iter(normalized.values())).shape if normalized else shape
            water = normalized.get("water", np.zeros((h, w), dtype=bool))
            buildings = normalized.get("buildings", np.zeros((h, w), dtype=bool))
            vegetation = normalized.get("vegetation", np.zeros((h, w), dtype=bool))
            ground = normalized.get("ground", ~(water | buildings | vegetation))
            return {"water": water, "buildings": buildings, "vegetation": vegetation, "ground": ground}

        if isinstance(semantic_mask, np.ndarray):
            h, w = semantic_mask.shape[:2]
            if semantic_mask.ndim == 2:
                # Assuming index encoding: 0: ground, 1: water, 2: buildings, 3: vegetation
                water = (semantic_mask == 1)
                buildings = (semantic_mask == 2)
                vegetation = (semantic_mask == 3)
                ground = (semantic_mask == 0) | (~(water | buildings | vegetation))
                return {"water": water, "buildings": buildings, "vegetation": vegetation, "ground": ground}

        # Auto-segmentation fallback using OpenCV color and texture heuristics if RGB is provided
        if rgb_image is not None and isinstance(rgb_image, np.ndarray):
            h, w = rgb_image.shape[:2]
            hsv = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2HSV)

            # Water heuristic (blue / dark low saturation water regions)
            lower_blue = np.array([90, 40, 20])
            upper_blue = np.array([135, 255, 200])
            water_mask = cv2.inRange(hsv, lower_blue, upper_blue) > 0

            # Vegetation heuristic (green hue range)
            lower_green = np.array([35, 40, 40])
            upper_green = np.array([85, 255, 255])
            veg_mask = cv2.inRange(hsv, lower_green, upper_green) > 0

            # Building heuristic (high contrast edges / urban structural contours)
            gray = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2GRAY)
            edges = cv2.Canny(gray, 50, 150)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            closed_edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
            bldg_mask = (closed_edges > 0) & (~water_mask) & (~veg_mask)

            ground_mask = ~(water_mask | bldg_mask | veg_mask)
            return {"water": water_mask, "buildings": bldg_mask, "vegetation": veg_mask, "ground": ground_mask}

        # Default fallback: all ground
        h, w = shape
        return {
            "water": np.zeros((h, w), dtype=bool),
            "buildings": np.zeros((h, w), dtype=bool),
            "vegetation": np.zeros((h, w), dtype=bool),
            "ground": np.ones((h, w), dtype=bool),
        }

    def flatten_water_and_features(
        self,
        depth_map: np.ndarray,
        semantic_mask: Optional[Union[Dict[str, np.ndarray], np.ndarray]] = None,
        rgb_image: Optional[np.ndarray] = None
    ) -> np.ndarray:
        """
        Refines depth map by constraining water, smoothing building rooftops, filtering vegetation spikes,
        and applying bilateral filtering to ground terrain.

        Args:
            depth_map: 2D numpy array (float32 or float64) of raw elevation/depth.
            semantic_mask: Dict or array of semantic masks for water, buildings, vegetation, ground.
            rgb_image: Optional (H, W, 3) uint8 RGB image for fallback mask generation.

        Returns:
            Refined 2D numpy array (float32) ready for 3D point cloud / mesh generation.
        """
        refined = depth_map.astype(np.float32).copy()
        h, w = refined.shape

        masks = self.parse_semantic_mask(semantic_mask, rgb_image, shape=(h, w))
        water_mask = masks["water"]
        bldg_mask = masks["buildings"]
        veg_mask = masks["vegetation"]
        ground_mask = masks["ground"]

        # ---------------------------------------------------------
        # 1. WATER ELEVATION CONSTRAINING
        # ---------------------------------------------------------
        if np.any(water_mask):
            # Dilate water mask by 3px to locate shoreline boundary
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
            dilated_water = cv2.dilate(water_mask.astype(np.uint8), kernel) > 0
            shore_mask = dilated_water & (~water_mask) & (~bldg_mask)

            if np.any(shore_mask):
                # Calculate minimum shoreline ground elevation Z_min (5th percentile for noise robustness)
                z_min = float(np.percentile(refined[shore_mask], 5))
            else:
                z_min = float(np.min(refined[water_mask]))

            # Force all water pixels to perfectly flat plane Z_water = z_min
            refined[water_mask] = z_min

        # ---------------------------------------------------------
        # 2. FEATURE ELEVATION STRUCTURING: BUILDINGS
        # ---------------------------------------------------------
        if np.any(bldg_mask):
            bldg_u8 = bldg_mask.astype(np.uint8)
            num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(bldg_u8, connectivity=8)

            for label_idx in range(1, num_labels):
                area = stats[label_idx, cv2.CC_STAT_AREA]
                if area < 9:
                    continue  # skip tiny noisy components

                comp_mask = (labels == label_idx)
                ys, xs = np.where(comp_mask)
                z_vals = refined[ys, xs]

                # RANSAC planar fitting: z = a*x + b*y + c
                if len(xs) >= 6:
                    A = np.column_stack([xs, ys, np.ones_like(xs)])
                    # Fit plane via robust RANSAC or least squares
                    best_inliers = []
                    best_plane = None
                    for _ in range(15):
                        sample_indices = np.random.choice(len(xs), 3, replace=False)
                        A_sub = A[sample_indices]
                        z_sub = z_vals[sample_indices]
                        try:
                            plane_params, _, _, _ = np.linalg.lstsq(A_sub, z_sub, rcond=None)
                            preds = A @ plane_params
                            errors = np.abs(z_vals - preds)
                            inliers = np.where(errors < 0.05 * (np.max(z_vals) - np.min(z_vals) + 1e-5))[0]
                            if len(inliers) > len(best_inliers):
                                best_inliers = inliers
                                best_plane = plane_params
                        except np.linalg.LinAlgError:
                            continue

                    if best_plane is not None and len(best_inliers) > len(xs) * 0.4:
                        # Refit with all inliers
                        plane_params, _, _, _ = np.linalg.lstsq(A[best_inliers], z_vals[best_inliers], rcond=None)
                        fitted_z = A @ plane_params
                        refined[ys, xs] = fitted_z
                    else:
                        # Fallback: Median rooftop smoothing
                        refined[ys, xs] = np.median(z_vals)
                else:
                    refined[ys, xs] = np.median(z_vals)

                # Enforce sharp vertical step changes at perimeter
                contour_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
                eroded = cv2.erode(comp_mask.astype(np.uint8), contour_kernel) > 0
                perimeter_mask = comp_mask & (~eroded)

                # Sharpen perimeter edges
                if np.any(perimeter_mask) and np.any(eroded):
                    roof_interior_z = np.median(refined[eroded])
                    refined[perimeter_mask] = roof_interior_z

        # ---------------------------------------------------------
        # 3. FEATURE ELEVATION STRUCTURING: TREES / VEGETATION
        # ---------------------------------------------------------
        if np.any(veg_mask):
            # Statistical outlier rejection filter inside vegetation mask
            veg_z = refined[veg_mask]
            mean_z = np.mean(veg_z)
            std_z = np.std(veg_z) + 1e-6

            outliers = (np.abs(veg_z - mean_z) > 2.5 * std_z)
            if np.any(outliers):
                # Replace spiky outliers with median vegetation height
                med_z = np.median(veg_z)
                ys, xs = np.where(veg_mask)
                refined[ys[outliers], xs[outliers]] = med_z

            # Apply mild 3x3 median filter on vegetation pixels to retain offsets while smoothing needle spikes
            temp_veg = refined.copy()
            filtered_veg = cv2.medianBlur(temp_veg, 3)
            refined[veg_mask] = filtered_veg[veg_mask]

        # ---------------------------------------------------------
        # 4. MOUNTAINS & TERRAIN RIDGE PRESERVING BILATERAL FILTER
        # ---------------------------------------------------------
        if np.any(ground_mask):
            # Normalize to 0-255 uint8 range for OpenCV bilateral filter
            g_min, g_max = np.min(refined), np.max(refined)
            g_range = g_max - g_min + 1e-6
            norm_depth = ((refined - g_min) / g_range * 255.0).astype(np.uint8)

            filtered_u8 = cv2.bilateralFilter(
                norm_depth,
                d=self.bilateral_d,
                sigmaColor=self.bilateral_sigma_color,
                sigmaSpace=self.bilateral_sigma_space
            )
            filtered_float = (filtered_u8.astype(np.float32) / 255.0) * g_range + g_min

            # Preserve bilateral filtered ground while respecting water flat plane
            refined[ground_mask] = filtered_float[ground_mask]

        return refined
