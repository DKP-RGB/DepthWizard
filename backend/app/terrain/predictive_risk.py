"""
PredictiveRiskEngine — Temporal Drift Analysis & Landslide/Erosion Early Warning
Compares two historical images from different epochs (e.g., 2020 vs 2023)
to detect gradual terrain destabilization and predict impending structural failures.

Pipeline:
1. Gradient Shift Map — Sobel magnitude change between epochs
2. Vegetation Recession Index — NDVI decrease indicating exposed soil
3. Structural Creep Detection — Farneback dense optical flow for lateral displacement
4. Water Proximity Risk — Distance-weighted risk from water/drainage bodies
5. Composite Risk Score — Calibrated 0.0–1.0 per-pixel danger map
6. Danger Zone Extraction — Connected component polygons with area, centroid, and severity
"""

import io
import base64
import math
import cv2
import numpy as np
from PIL import Image
from typing import Optional, Dict, Tuple, List, Any


class PredictiveRiskEngine:
    """
    Analyzes temporal shifts between two distinct historical satellite/aerial
    images to predict upcoming landslide, erosion, or structural failures.
    """

    def __init__(
        self,
        target_size: Tuple[int, int] = (512, 512),
        gsd_m_per_px: float = 1.5,
        danger_threshold: float = 0.55,
    ):
        self.target_size = target_size
        self.gsd_m_per_px = gsd_m_per_px
        self.sq_m_per_px = gsd_m_per_px ** 2
        self.danger_threshold = danger_threshold

    # -----------------------------------------------------------------------
    # 1. Gradient Shift Map
    # -----------------------------------------------------------------------
    def _gradient_shift(self, img_t1: np.ndarray, img_t2: np.ndarray) -> np.ndarray:
        """
        Computes terrain gradient magnitude difference between two epochs.
        Higher values indicate slope destabilization or terrain movement.
        """
        gray_t1 = cv2.cvtColor(img_t1, cv2.COLOR_RGB2GRAY)
        gray_t2 = cv2.cvtColor(img_t2, cv2.COLOR_RGB2GRAY)

        # Sobel gradient magnitude for epoch 1
        gx1 = cv2.Sobel(gray_t1, cv2.CV_32F, 1, 0, ksize=3)
        gy1 = cv2.Sobel(gray_t1, cv2.CV_32F, 0, 1, ksize=3)
        mag1 = cv2.magnitude(gx1, gy1)

        # Sobel gradient magnitude for epoch 2
        gx2 = cv2.Sobel(gray_t2, cv2.CV_32F, 1, 0, ksize=3)
        gy2 = cv2.Sobel(gray_t2, cv2.CV_32F, 0, 1, ksize=3)
        mag2 = cv2.magnitude(gx2, gy2)

        # Absolute difference in gradient magnitude
        diff = cv2.absdiff(mag1, mag2)
        diff_blur = cv2.GaussianBlur(diff, (7, 7), 0)

        p99 = np.percentile(diff_blur, 99) + 1e-5
        return np.clip(diff_blur / p99, 0.0, 1.0).astype(np.float32)

    # -----------------------------------------------------------------------
    # 2. Vegetation Recession Index
    # -----------------------------------------------------------------------
    def _vegetation_recession(
        self, img_t1: np.ndarray, img_t2: np.ndarray
    ) -> np.ndarray:
        """
        Track NDVI decrease between epochs. Exposed soil increases
        landslide susceptibility and erosion risk.
        """
        def ndvi(img):
            green = img[:, :, 1].astype(np.float32)
            red = img[:, :, 0].astype(np.float32)
            return (green - red) / (green + red + 1e-5)

        ndvi_t1 = ndvi(img_t1)
        ndvi_t2 = ndvi(img_t2)

        # Positive delta = vegetation loss
        veg_loss = np.clip(ndvi_t1 - ndvi_t2, 0.0, 1.0)
        veg_loss_blur = cv2.GaussianBlur(veg_loss, (9, 9), 0)

        p95 = np.percentile(veg_loss_blur, 95) + 1e-5
        return np.clip(veg_loss_blur / p95, 0.0, 1.0).astype(np.float32)

    # -----------------------------------------------------------------------
    # 3. Structural Creep Detection (Dense Optical Flow)
    # -----------------------------------------------------------------------
    def _structural_creep(
        self, img_t1: np.ndarray, img_t2: np.ndarray
    ) -> Tuple[np.ndarray, float]:
        """
        Detect slow lateral movement of terrain features, building edges,
        road cracks, or retaining walls using Farneback dense optical flow.
        Returns (creep_magnitude_map, mean_displacement_px).
        """
        gray_t1 = cv2.cvtColor(img_t1, cv2.COLOR_RGB2GRAY)
        gray_t2 = cv2.cvtColor(img_t2, cv2.COLOR_RGB2GRAY)

        # Farneback dense optical flow
        flow = cv2.calcOpticalFlowFarneback(
            gray_t1, gray_t2,
            None,
            pyr_scale=0.5,
            levels=5,
            winsize=15,
            iterations=3,
            poly_n=5,
            poly_sigma=1.2,
            flags=0,
        )

        # Flow magnitude
        mag = np.sqrt(flow[:, :, 0] ** 2 + flow[:, :, 1] ** 2)
        mag_blur = cv2.GaussianBlur(mag, (9, 9), 0)

        mean_disp = float(np.mean(mag_blur))

        p98 = np.percentile(mag_blur, 98) + 1e-5
        mag_norm = np.clip(mag_blur / p98, 0.0, 1.0).astype(np.float32)

        return mag_norm, mean_disp

    # -----------------------------------------------------------------------
    # 4. Water Proximity Risk
    # -----------------------------------------------------------------------
    def _water_proximity_risk(self, img: np.ndarray) -> np.ndarray:
        """
        Compute distance-weighted risk from detected water/drainage bodies.
        Pixels closer to water have higher landslide susceptibility.
        """
        hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
        h_ch = hsv[:, :, 0]
        s_ch = hsv[:, :, 1]
        v_ch = hsv[:, :, 2]

        # Water detection: blue hue range with moderate-high saturation, low-mid value
        water_mask = (
            ((h_ch >= 90) & (h_ch <= 130)) &
            (s_ch > 40) &
            (v_ch < 180)
        ).astype(np.uint8) * 255

        # Clean up
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        water_mask = cv2.morphologyEx(water_mask, cv2.MORPH_CLOSE, kernel)

        if np.sum(water_mask) == 0:
            return np.zeros(img.shape[:2], dtype=np.float32)

        # Distance transform from water — closer = higher risk
        dist = cv2.distanceTransform(255 - water_mask, cv2.DIST_L2, 5)

        # Normalize: max influence radius = 80 pixels
        max_radius = 80.0
        risk = np.clip(1.0 - dist / max_radius, 0.0, 1.0)
        return risk.astype(np.float32)

    # -----------------------------------------------------------------------
    # 5. Composite Risk Score
    # -----------------------------------------------------------------------
    def _build_risk_composite(
        self,
        gradient_shift: np.ndarray,
        veg_recession: np.ndarray,
        creep_mag: np.ndarray,
        water_risk: np.ndarray,
        w_grad: float = 0.30,
        w_veg: float = 0.25,
        w_creep: float = 0.25,
        w_water: float = 0.20,
    ) -> np.ndarray:
        """
        Weighted fusion into calibrated 0.0–1.0 risk map.
        """
        composite = (
            w_grad * gradient_shift +
            w_veg * veg_recession +
            w_creep * creep_mag +
            w_water * water_risk
        )
        composite = cv2.GaussianBlur(composite, (11, 11), 0)

        # Calibrated rescaling (stretch to use full 0–1 range)
        p05 = np.percentile(composite, 5)
        p98 = np.percentile(composite, 98) + 1e-5
        composite = np.clip((composite - p05) / (p98 - p05), 0.0, 1.0)

        return composite.astype(np.float32)

    # -----------------------------------------------------------------------
    # 6. Danger Zone Extraction
    # -----------------------------------------------------------------------
    def _extract_danger_zones(
        self, risk_map: np.ndarray
    ) -> List[Dict[str, Any]]:
        """
        Threshold risk map and extract connected danger zone polygons.
        Returns list of zones with centroid, area, and severity.
        """
        danger_mask = (risk_map >= self.danger_threshold).astype(np.uint8) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        danger_mask = cv2.morphologyEx(danger_mask, cv2.MORPH_CLOSE, kernel)
        danger_mask = cv2.morphologyEx(danger_mask, cv2.MORPH_OPEN, kernel)

        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(danger_mask)

        zones = []
        for i in range(1, num_labels):
            area_px = stats[i, cv2.CC_STAT_AREA]
            if area_px < 50:
                continue

            cx = int(centroids[i][0])
            cy = int(centroids[i][1])
            area_sqm = int(area_px * self.sq_m_per_px)

            # Mean risk within zone
            zone_mask = (labels == i)
            mean_risk = float(np.mean(risk_map[zone_mask]))

            if mean_risk >= 0.80:
                severity = "CRITICAL"
            elif mean_risk >= 0.65:
                severity = "HIGH"
            elif mean_risk >= 0.50:
                severity = "MEDIUM"
            else:
                severity = "LOW"

            zones.append({
                "zone_id": i,
                "centroid": [cx, cy],
                "area_px": int(area_px),
                "area_sqm": area_sqm,
                "area_hectares": round(area_sqm / 10000.0, 3),
                "mean_risk": round(mean_risk, 3),
                "severity": severity,
                "bbox": {
                    "x": int(stats[i, cv2.CC_STAT_LEFT]),
                    "y": int(stats[i, cv2.CC_STAT_TOP]),
                    "w": int(stats[i, cv2.CC_STAT_WIDTH]),
                    "h": int(stats[i, cv2.CC_STAT_HEIGHT]),
                },
            })

        # Sort by risk (highest first)
        zones.sort(key=lambda z: z["mean_risk"], reverse=True)
        return zones

    # -----------------------------------------------------------------------
    # 7. Risk Heatmap Overlay
    # -----------------------------------------------------------------------
    def _generate_risk_heatmap(self, risk_map: np.ndarray) -> str:
        """
        Generates RGBA heatmap overlay for risk visualization.
        Green → Yellow → Orange → Red → Dark Red
        """
        h, w = risk_map.shape
        overlay = np.zeros((h, w, 4), dtype=np.uint8)

        # Low risk (0.3–0.5): Green-Yellow
        low_mask = (risk_map >= 0.30) & (risk_map < 0.50)
        overlay[low_mask] = [34, 197, 94, 120]

        # Medium risk (0.5–0.65): Yellow-Orange
        med_mask = (risk_map >= 0.50) & (risk_map < 0.65)
        overlay[med_mask] = [245, 158, 11, 160]

        # High risk (0.65–0.80): Orange-Red
        high_mask = (risk_map >= 0.65) & (risk_map < 0.80)
        overlay[high_mask] = [239, 68, 68, 200]

        # Critical risk (>0.80): Dark Red
        crit_mask = risk_map >= 0.80
        overlay[crit_mask] = [153, 27, 27, 230]

        overlay_img = Image.fromarray(overlay, mode="RGBA")
        buf = io.BytesIO()
        overlay_img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    # -----------------------------------------------------------------------
    # 8. Early Warning Status
    # -----------------------------------------------------------------------
    def _compute_early_warning(
        self, risk_map: np.ndarray, danger_zones: List[Dict]
    ) -> Dict[str, Any]:
        """
        Compute overall early warning level and recommendation.
        """
        mean_risk = float(np.mean(risk_map))
        max_risk = float(np.max(risk_map))
        critical_zones = sum(1 for z in danger_zones if z["severity"] == "CRITICAL")
        high_zones = sum(1 for z in danger_zones if z["severity"] == "HIGH")

        if critical_zones >= 2 or max_risk >= 0.90:
            level = "RED"
            message = "IMMINENT LANDSLIDE/EROSION RISK — Immediate evacuation and monitoring required."
            confidence = min(0.95, mean_risk + 0.15)
        elif critical_zones >= 1 or high_zones >= 3 or max_risk >= 0.78:
            level = "ORANGE"
            message = "HIGH RISK — Structural monitoring and preparedness measures recommended."
            confidence = min(0.85, mean_risk + 0.10)
        elif high_zones >= 1 or max_risk >= 0.60:
            level = "YELLOW"
            message = "MODERATE RISK — Periodic inspection of slopes and drainage systems advised."
            confidence = min(0.70, mean_risk + 0.08)
        else:
            level = "GREEN"
            message = "LOW RISK — No immediate structural threat detected. Continue routine monitoring."
            confidence = max(0.30, 1.0 - mean_risk)

        return {
            "warning_level": level,
            "warning_message": message,
            "confidence_score": round(confidence, 3),
            "mean_risk": round(mean_risk, 4),
            "max_risk": round(max_risk, 4),
            "critical_zone_count": critical_zones,
            "high_zone_count": high_zones,
            "total_danger_zones": len(danger_zones),
        }

    # ===================================================================
    # PRIMARY API: Predictive Risk Analysis
    # ===================================================================
    def analyze(
        self,
        image_t1: Image.Image,
        image_t2: Image.Image,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        gsd: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Full predictive risk analysis between two historical epochs.

        Args:
            image_t1: Earlier historical image (e.g., 2020).
            image_t2: Later historical image (e.g., 2023).
            latitude: Optional latitude for region context.
            longitude: Optional longitude for region context.
            gsd: Ground sample distance (m/px).

        Returns:
            Dict with risk heatmap, danger zones, early warning, and metrics.
        """
        w, h = self.target_size
        if gsd is not None and gsd > 0:
            self.gsd_m_per_px = gsd
            self.sq_m_per_px = gsd ** 2

        img_t1 = np.array(image_t1.convert("RGB").resize((w, h), Image.LANCZOS))
        img_t2 = np.array(image_t2.convert("RGB").resize((w, h), Image.LANCZOS))

        # Step 1: Gradient shift
        grad_shift = self._gradient_shift(img_t1, img_t2)

        # Step 2: Vegetation recession
        veg_recession = self._vegetation_recession(img_t1, img_t2)

        # Step 3: Structural creep (optical flow)
        creep_mag, mean_displacement_px = self._structural_creep(img_t1, img_t2)
        mean_displacement_m = mean_displacement_px * self.gsd_m_per_px

        # Step 4: Water proximity risk (from later epoch)
        water_risk = self._water_proximity_risk(img_t2)

        # Step 5: Composite risk score
        risk_map = self._build_risk_composite(
            grad_shift, veg_recession, creep_mag, water_risk
        )

        # Step 6: Danger zone extraction
        danger_zones = self._extract_danger_zones(risk_map)

        # Step 7: Risk heatmap
        risk_heatmap_b64 = self._generate_risk_heatmap(risk_map)

        # Step 8: Early warning
        early_warning = self._compute_early_warning(risk_map, danger_zones)

        # Total at-risk area
        at_risk_pixels = int(np.sum(risk_map >= self.danger_threshold))
        at_risk_sqm = int(at_risk_pixels * self.sq_m_per_px)
        at_risk_hectares = round(at_risk_sqm / 10000.0, 2)

        # Per-component mean scores
        grad_mean = round(float(np.mean(grad_shift)) * 100, 2)
        veg_mean = round(float(np.mean(veg_recession)) * 100, 2)
        creep_mean = round(float(np.mean(creep_mag)) * 100, 2)
        water_mean = round(float(np.mean(water_risk)) * 100, 2)

        return {
            "risk_heatmap_png": risk_heatmap_b64,
            "danger_zones": danger_zones,
            "early_warning": early_warning,
            "at_risk_area_sqm": at_risk_sqm,
            "at_risk_area_hectares": at_risk_hectares,
            "mean_displacement_m": round(mean_displacement_m, 3),
            "mean_displacement_px": round(mean_displacement_px, 3),
            # Per-component breakdown (0–100 scale)
            "gradient_shift_score": grad_mean,
            "vegetation_recession_score": veg_mean,
            "structural_creep_score": creep_mean,
            "water_proximity_score": water_mean,
            "composite_risk_score": round(float(np.mean(risk_map)), 4),
        }
