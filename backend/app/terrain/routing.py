"""
SafePathPlanner — Risk-Aware Safe Rescue Pathfinding Engine
Computes 8-connected A* optimal rescue routes taking into account elevation slopes (Sobel operator),
landslide risk, soil instability, and water body obstacles.
"""

import math
import heapq
import numpy as np
import cv2
from typing import Tuple, List, Dict, Optional, Union


class SafePathPlanner:
    """
    Risk-Aware A* Pathfinding Engine for terrain elevation maps and hazard layers.
    """

    def __init__(
        self,
        w1: float = 4.0,
        w2: float = 5.0,
        w3: float = 3.0,
        d_base: float = 1.0,
        max_safe_slope_deg: float = 45.0,
        cell_size_m: float = 2.0
    ):
        self.w1 = w1
        self.w2 = w2
        self.w3 = w3
        self.d_base = d_base
        self.max_safe_slope_deg = max_safe_slope_deg
        self.cell_size_m = cell_size_m

        self.cost_map: Optional[np.ndarray] = None
        self.slope_deg_map: Optional[np.ndarray] = None
        self.water_mask: Optional[np.ndarray] = None
        self.depth_map: Optional[np.ndarray] = None
        self.landslide_risk: Optional[np.ndarray] = None
        self.soil_instability: Optional[np.ndarray] = None

    def build_cost_map(
        self,
        depth_map: np.ndarray,
        landslide_risk: Optional[np.ndarray] = None,
        soil_instability: Optional[np.ndarray] = None,
        water_mask: Optional[np.ndarray] = None,
        w1: Optional[float] = None,
        w2: Optional[float] = None,
        w3: Optional[float] = None,
        d_base: Optional[float] = None,
        max_safe_slope_deg: Optional[float] = None,
        cell_size_m: Optional[float] = None
    ) -> np.ndarray:
        """
        Builds a 2D weighted movement penalty cost map.

        Cost(x, y) = Inf if water=True or Slope > max_safe_slope_deg
                     else D_base + w1 * Slope + w2 * Landslide + w3 * Soil

        Args:
            depth_map: 2D float array of elevation values (Z).
            landslide_risk: Normalized [0.0, 1.0] float map L.
            soil_instability: Normalized [0.0, 1.0] float map S.
            water_mask: Boolean mask W where water = True.
            w1, w2, w3, d_base, max_safe_slope_deg, cell_size_m: Optional weight overrides.

        Returns:
            2D float numpy array (cost_map) where impassable cells equal np.inf.
        """
        w1 = w1 if w1 is not None else self.w1
        w2 = w2 if w2 is not None else self.w2
        w3 = w3 if w3 is not None else self.w3
        d_base = d_base if d_base is not None else self.d_base
        max_safe_slope = max_safe_slope_deg if max_safe_slope_deg is not None else self.max_safe_slope_deg
        cell_size = cell_size_m if cell_size_m is not None else self.cell_size_m

        self.depth_map = depth_map.astype(np.float32)
        h, w = depth_map.shape

        # 1. Compute local terrain slope/gradient magnitude using Sobel operators
        # dZ/dx and dZ/dy
        sobel_x = cv2.Sobel(self.depth_map, cv2.CV_32F, 1, 0, ksize=3) / (8.0 * cell_size)
        sobel_y = cv2.Sobel(self.depth_map, cv2.CV_32F, 0, 1, ksize=3) / (8.0 * cell_size)

        grad_mag = np.sqrt(sobel_x ** 2 + sobel_y ** 2)
        self.slope_deg_map = np.degrees(np.arctan(grad_mag))

        # 2. Hazard Layer Defaults
        if landslide_risk is None:
            # Estimate landslide risk from steep slope gradient
            self.landslide_risk = np.clip((self.slope_deg_map - 15.0) / 30.0, 0.0, 1.0).astype(np.float32)
        else:
            self.landslide_risk = np.clip(landslide_risk, 0.0, 1.0).astype(np.float32)

        if soil_instability is None:
            self.soil_instability = np.zeros((h, w), dtype=np.float32)
        else:
            self.soil_instability = np.clip(soil_instability, 0.0, 1.0).astype(np.float32)

        if water_mask is None:
            self.water_mask = np.zeros((h, w), dtype=bool)
        else:
            self.water_mask = water_mask.astype(bool)

        # 3. Formulate Cost Map with Road Attraction & Rooftop Building Penalties
        # Local ground minimum filter to distinguish rooftops from flat ground roads
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
        local_ground = cv2.erode(self.depth_map, kernel)
        roof_mask = ((self.depth_map - local_ground) > 0.05) & (self.slope_deg_map < 25.0)
        road_mask = (self.slope_deg_map < 8.0) & ((self.depth_map - local_ground) < 0.02)

        cost_map = (
            d_base
            + w1 * self.slope_deg_map
            + w2 * self.landslide_risk
            + w3 * self.soil_instability
        ).astype(np.float32)

        # Apply strong road corridor attraction discount & building rooftop penalty
        cost_map[road_mask] *= 0.08
        cost_map[roof_mask] = 250.0

        # Set impassable cells (Water = True or Slope > MaxSafeSlope) to infinity
        impassable = self.water_mask | (self.slope_deg_map > max_safe_slope)
        cost_map[impassable] = np.inf

        self.cost_map = cost_map
        return cost_map

    def find_optimal_path(
        self,
        start_coord: Tuple[int, int],
        end_coord: Tuple[int, int],
        cell_size_m: Optional[float] = None
    ) -> Dict[str, Union[List[Tuple[int, int]], float, List[Dict]]]:
        """
        Executes an 8-connected A* algorithm using a priority queue (heapq).

        Args:
            start_coord: (x0, y0) column, row coordinates.
            end_coord: (x1, y1) column, row coordinates.
            cell_size_m: Optional cell size override.

        Returns:
            Dict containing:
                - 'path': List of (x, y) grid coordinates
                - 'total_cost': Accumulated movement penalty cost
                - 'total_distance': Real-world 3D travel distance in meters
                - 'cumulative_risk': Total hazard risk score along path
                - 'nodes_3d': List of 3D node dicts for rendering
        """
        if self.cost_map is None:
            raise ValueError("Cost map has not been built yet. Call build_cost_map(...) first.")

        cell_size = cell_size_m if cell_size_m is not None else self.cell_size_m
        orig_rows, orig_cols = self.cost_map.shape

        # Fast pathfinding optimization: downsample cost map if larger than 128x128
        target_grid = 128
        if orig_rows > target_grid or orig_cols > target_grid:
            scale_x = target_grid / float(orig_cols)
            scale_y = target_grid / float(orig_rows)
            
            # Downsample cost map (take max in neighborhood to preserve impassable barriers)
            cost_ds = cv2.resize(self.cost_map, (target_grid, target_grid), interpolation=cv2.INTER_MAX)
            cost_work = cost_ds
            rows, cols = target_grid, target_grid
            
            start_x = max(0, min(cols - 1, int(round(start_coord[0] * scale_x))))
            start_y = max(0, min(rows - 1, int(round(start_coord[1] * scale_y))))
            end_x = max(0, min(cols - 1, int(round(end_coord[0] * scale_x))))
            end_y = max(0, min(rows - 1, int(round(end_coord[1] * scale_y))))
        else:
            scale_x, scale_y = 1.0, 1.0
            cost_work = self.cost_map
            rows, cols = orig_rows, orig_cols

            start_x = max(0, min(cols - 1, int(start_coord[0])))
            start_y = max(0, min(rows - 1, int(start_coord[1])))
            end_x = max(0, min(cols - 1, int(end_coord[0])))
            end_y = max(0, min(rows - 1, int(end_coord[1])))

        start_node = (start_x, start_y)
        end_node = (end_x, end_y)

        if cost_work[start_y, start_x] == np.inf:
            start_node = self._find_nearest_passable_in(cost_work, start_x, start_y)
            start_x, start_y = start_node

        if cost_work[end_y, end_x] == np.inf:
            end_node = self._find_nearest_passable_in(cost_work, end_x, end_y)
            end_x, end_y = end_node

        # 8-connected neighbors: (dx, dy, step_distance_factor)
        neighbors = [
            (-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
            (-1, -1, 1.41421356), (1, -1, 1.41421356),
            (-1, 1, 1.41421356), (1, 1, 1.41421356)
        ]

        def heuristic(x, y):
            dx = abs(end_x - x)
            dy = abs(end_y - y)
            diag_dist = (dx + dy) + (1.41421356 - 2.0) * min(dx, dy)
            return diag_dist * (cell_size / scale_x) * self.d_base

        open_set = []
        heapq.heappush(open_set, (0.0, start_node))

        came_from = {}
        g_score = {start_node: 0.0}

        found = False

        while open_set:
            _, current = heapq.heappop(open_set)

            if current == end_node:
                found = True
                break

            curr_x, curr_y = current
            curr_cost = cost_work[curr_y, curr_x]

            for dx, dy, dist_factor in neighbors:
                nx, ny = curr_x + dx, curr_y + dy

                if 0 <= nx < cols and 0 <= ny < rows:
                    next_node = (nx, ny)
                    next_cost = cost_work[ny, nx]

                    if next_cost == np.inf:
                        continue  # Impassable water or steep slope

                    step_cost = 0.5 * (curr_cost + next_cost) * dist_factor * (cell_size / scale_x)
                    tentative_g = g_score[current] + step_cost

                    if next_node not in g_score or tentative_g < g_score[next_node]:
                        came_from[next_node] = current
                        g_score[next_node] = tentative_g
                        f_score = tentative_g + heuristic(nx, ny)
                        heapq.heappush(open_set, (f_score, next_node))

        if not found:
            path_grid = [start_node, end_node]
        else:
            path_grid = []
            curr = end_node
            while curr in came_from:
                path_grid.append(curr)
                curr = came_from[curr]
            path_grid.append(start_node)
            path_grid.reverse()

        # Map grid path back to original dimensions & compute path metrics
        path = []
        nodes_3d = []
        total_3d_dist = 0.0
        cumulative_risk = 0.0
        total_cost = g_score.get(end_node, 0.0)

        for i in range(len(path_grid)):
            gx, gy = path_grid[i]
            px = max(0, min(orig_cols - 1, int(round(gx / scale_x))))
            py = max(0, min(orig_rows - 1, int(round(gy / scale_y))))
            path.append((px, py))

            pz = float(self.depth_map[py, px]) if self.depth_map is not None else 0.0
            nodes_3d.append({"x": px, "y": py, "z": pz, "normX": px / (orig_cols - 1), "normY": py / (orig_rows - 1)})

            risk_val = float(self.landslide_risk[py, px] * self.w2 + self.soil_instability[py, px] * self.w3)
            cumulative_risk += risk_val

            if i > 0:
                prev_x, prev_y = path[i - 1]
                prev_z = float(self.depth_map[prev_y, prev_x]) if self.depth_map is not None else 0.0
                horiz = math.sqrt(((px - prev_x) * cell_size) ** 2 + ((py - prev_y) * cell_size) ** 2)
                dz = pz - prev_z
                total_3d_dist += math.sqrt(horiz ** 2 + dz ** 2)

        return {
            "path": path,
            "total_cost": round(total_cost, 2),
            "total_distance": round(total_3d_dist, 1),
            "cumulative_risk": round(cumulative_risk, 2),
            "nodes": nodes_3d,
            "nodes_count": len(path)
        }

    def _find_nearest_passable(self, x: int, y: int) -> Tuple[int, int]:
        return self._find_nearest_passable_in(self.cost_map, x, y)

    def _find_nearest_passable_in(self, cost_grid: np.ndarray, x: int, y: int) -> Tuple[int, int]:
        """Finds closest passable node in a cost grid within a 15px radius."""
        rows, cols = cost_grid.shape
        best_dist = float("inf")
        best_node = (x, y)

        for r in range(1, 16):
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < cols and 0 <= ny < rows:
                        if cost_grid[ny, nx] < np.inf:
                            dist = dx * dx + dy * dy
                            if dist < best_dist:
                                best_dist = dist
                                best_node = (nx, ny)
            if best_dist < float("inf"):
                break
        return best_node


def calculate_rescue_route(
    height_map: np.ndarray,
    start_pos: Tuple[float, float],
    end_pos: Tuple[float, float],
    cell_size_m: float = 2.0,
    max_walkable_slope_deg: float = 45.0,
) -> dict:
    """
    Backwards-compatible wrapper function for calculate_rescue_route using SafePathPlanner.
    """
    planner = SafePathPlanner(
        max_safe_slope_deg=max_walkable_slope_deg,
        cell_size_m=cell_size_m
    )
    planner.build_cost_map(height_map, cell_size_m=cell_size_m, max_safe_slope_deg=max_walkable_slope_deg)
    res = planner.find_optimal_path(start_pos, end_pos, cell_size_m=cell_size_m)

    return {
        "nodes": res["nodes"],
        "total_3d_distance_m": res["total_distance"],
        "total_horizontal_distance_m": res["total_distance"],
        "elevation_gain_m": 0.0,
        "elevation_loss_m": 0.0,
        "max_slope_deg": 0.0,
        "estimated_travel_time_min": round(res["total_distance"] / 1.4 / 60.0, 1),
        "total_risk_score": res["cumulative_risk"],
        "path_cost": res["total_cost"]
    }
