import cv2
import numpy as np
import torch
from PIL import Image
from transformers import pipeline


class DepthEstimator:
    def __init__(self):
        self.device = "cpu"
        self.pipe = pipeline(
            task="depth-estimation",
            model="depth-anything/Depth-Anything-V2-Small-hf",
            device=self.device,
        )

    def adapt_satellite_height(self, raw_depth: np.ndarray, original_img: Image.Image) -> np.ndarray:
        """
        Overhead Satellite Topography & Building Extrusion Engine:
        1. Vegetation / Green Belt Suppression: Forest/park regions are flattened to local ground elevation.
        2. Urban Building Footprint Extrusion: Isolates building rooftops via multi-scale morphological top-hat & edge density, extruding 3D building blocks across urban tiles.
        3. Water Body Leveling: Lakes/rivers locked flat at z = 0.
        4. Camera Tilt & Low-Frequency Detrending.
        """
        h, w = raw_depth.shape
        img_np = np.array(original_img.resize((w, h), Image.LANCZOS).convert("RGB"))
        gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
        hsv = cv2.cvtColor(img_np, cv2.COLOR_RGB2HSV)

        # -------------------------------------------------------------
        # 1. Vegetation / Green Belt Detection
        # -------------------------------------------------------------
        r, g, b = img_np[:, :, 0].astype(np.float32), img_np[:, :, 1].astype(np.float32), img_np[:, :, 2].astype(np.float32)
        exg = 2.0 * g - r - b
        hue, sat, val = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

        # Green vegetation: Green hue range (35 to 85) with strong green saturation (>45) and ExG (>18)
        veg_mask = ((hue >= 35) & (hue <= 85) & (sat > 45) & (exg > 18)).astype(np.uint8)
        kernel_veg = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        veg_mask_dilated = cv2.dilate(cv2.morphologyEx(veg_mask, cv2.MORPH_CLOSE, kernel_veg), kernel_veg, iterations=1).astype(bool)

        # -------------------------------------------------------------
        # 2. Water Body Detection
        # -------------------------------------------------------------
        water_candidates = ((sat < 50) & (val < 130) & (val > 25) & (~veg_mask_dilated)).astype(np.uint8)
        kernel_water = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        water_candidates = cv2.morphologyEx(water_candidates, cv2.MORPH_OPEN, kernel_water)
        water_candidates = cv2.morphologyEx(water_candidates, cv2.MORPH_CLOSE, kernel_water)

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(water_candidates)
        water_mask = np.zeros((h, w), dtype=bool)
        min_water_area = int((h * w) * 0.008)
        for i in range(1, num_labels):
            if stats[i, cv2.CC_STAT_AREA] >= min_water_area:
                water_mask[labels == i] = True

        # -------------------------------------------------------------
        # 3. Detrending & Vegetation Flattening
        # -------------------------------------------------------------
        # Remove low-frequency camera perspective tilt
        low_pass = cv2.GaussianBlur(raw_depth, (101, 101), 0)
        detrended = raw_depth - 0.75 * low_pass

        # Smooth ground baseline
        ground_smooth = cv2.GaussianBlur(detrended, (61, 61), 0)

        # Flatten green belts: Replace artificial forest depth spikes with smooth ground baseline
        height_map = detrended.copy()
        height_map[veg_mask_dilated] = 0.20 * detrended[veg_mask_dilated] + 0.80 * ground_smooth[veg_mask_dilated]

        # -------------------------------------------------------------
        # 4. Urban Building Rooftop Extrusion
        # -------------------------------------------------------------
        urban_gray = gray.copy()
        urban_gray[water_mask] = 0

        # Multi-scale Morphological Top-Hat on Grayscale to isolate small, medium, and large building rooftops
        top_hat_s = cv2.morphologyEx(urban_gray, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)))
        top_hat_m = cv2.morphologyEx(urban_gray, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15)))
        top_hat_l = cv2.morphologyEx(urban_gray, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25)))

        top_hat_combined = (0.4 * top_hat_s + 0.4 * top_hat_m + 0.2 * top_hat_l).astype(np.float32) / 255.0

        # Structural edge density for urban building blocks
        grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        edge_mag = cv2.magnitude(grad_x, grad_y)
        edge_mag[water_mask] = 0

        edge_density = cv2.GaussianBlur(edge_mag, (7, 7), 0)
        p85 = np.percentile(edge_density, 85)
        if p85 > 0:
            edge_density_norm = np.clip(edge_density / p85, 0, 1.0)
        else:
            edge_density_norm = np.zeros_like(edge_density)

        building_score = 0.50 * top_hat_combined + 0.50 * (top_hat_combined * edge_density_norm)

        # Elevate building rooftops above ground level
        height_map = 0.65 * height_map + 0.35 * building_score

        # Sharpen building edges with bilateral filter
        height_map = cv2.bilateralFilter((height_map * 255.0).astype(np.float32), 7, 40, 40) / 255.0

        # Lock water bodies to flat 0.0 elevation
        height_map[water_mask] = 0.0

        # Percentile clipping (1st to 99th percentile) to normalize cleanly [0.0, 1.0]
        p1, p99 = np.percentile(height_map, 1), np.percentile(height_map, 99)
        if p99 > p1:
            height_map = np.clip((height_map - p1) / (p99 - p1), 0.0, 1.0)
        else:
            height_map = np.zeros_like(height_map)

        return height_map.astype(np.float32)

    def predict(self, image: Image.Image) -> tuple:
        """
        Run satellite overhead height estimation on a PIL Image.

        Returns:
            height_array: np.ndarray float32 of shape (H, W), satellite height map
            width: int
            height: int
        """
        result = self.pipe(image)

        depth_tensor = result["predicted_depth"]
        if isinstance(depth_tensor, torch.Tensor):
            raw_depth = depth_tensor.squeeze().cpu().numpy().astype(np.float32)
        else:
            raw_depth = np.array(result["depth"]).astype(np.float32)

        height, width = raw_depth.shape

        # Apply satellite height adaptation layer
        adapted_height = self.adapt_satellite_height(raw_depth, image)

        return adapted_height, width, height
