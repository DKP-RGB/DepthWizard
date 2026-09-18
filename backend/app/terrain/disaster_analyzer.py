"""
DisasterAnalyzer — Dual-Temporal Disaster Intelligence Engine
Production-grade bi-temporal change detection with:
1. ORB feature-based spatial registration + homography warp alignment
2. CDF histogram matching for radiometric normalization
3. Multi-index change detection: SSIM, NDVI, NDWI, BSI, SCV
4. Composite disruption map with adaptive percentile thresholding
5. Auto disaster category classification
6. Location-aware demographics & tiered economic cost aggregation
"""

import io
import base64
import math
import cv2
import numpy as np
from PIL import Image
from typing import Optional, Dict, Tuple, List, Any


# ---------------------------------------------------------------------------
# Regional population density lookup (persons per sq km)
# Source: India Census 2011 + UIDAI 2024 estimates
# ---------------------------------------------------------------------------
REGIONAL_DENSITY = {
    "urban":      12000,   # Dense urban core (Delhi, Mumbai, Kolkata)
    "semi_urban":  3500,   # Peri-urban / city outskirts
    "rural":        450,   # Rural / village regions
    "hilly":        120,   # Himalayan / hilly terrain
    "default":      800,   # National fallback average
}

# Tiered cost per destroyed structure (INR)
COST_PER_STRUCTURE_INR = {
    "urban":      3500000,   # ₹35 Lakhs
    "semi_urban": 1800000,   # ₹18 Lakhs
    "rural":       800000,   # ₹8 Lakhs
    "hilly":       600000,   # ₹6 Lakhs
    "default":    1200000,   # ₹12 Lakhs
}

# Infrastructure & crop damage per hectare (INR)
INFRA_COST_PER_HECTARE_INR = {
    "urban":      250000,
    "semi_urban": 150000,
    "rural":       80000,
    "hilly":       50000,
    "default":    100000,
}

INR_TO_USD = 84.0


class DisasterAnalyzer:
    """
    Dual-temporal disaster change detection engine with multi-spectral index
    analysis and geospatial demographics aggregation.
    """

    def __init__(
        self,
        target_size: Tuple[int, int] = (512, 512),
        gsd_m_per_px: float = 1.5,
        region_type: str = "default",
    ):
        self.target_size = target_size
        self.gsd_m_per_px = gsd_m_per_px
        self.region_type = region_type
        self.sq_m_per_px = gsd_m_per_px ** 2

    # -----------------------------------------------------------------------
    # 1. Spatial Alignment — ORB Feature Registration
    # -----------------------------------------------------------------------
    def _align_images(
        self, before: np.ndarray, after: np.ndarray
    ) -> Tuple[np.ndarray, np.ndarray, bool]:
        """
        Align before image to after image using ORB keypoint matching +
        homography warp. Returns (aligned_before, after, success).
        """
        gray_b = cv2.cvtColor(before, cv2.COLOR_RGB2GRAY)
        gray_a = cv2.cvtColor(after, cv2.COLOR_RGB2GRAY)

        orb = cv2.ORB_create(nfeatures=2000, scaleFactor=1.2, nlevels=8)
        kp_b, des_b = orb.detectAndCompute(gray_b, None)
        kp_a, des_a = orb.detectAndCompute(gray_a, None)

        if des_b is None or des_a is None or len(kp_b) < 10 or len(kp_a) < 10:
            return before, after, False

        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
        matches = bf.knnMatch(des_b, des_a, k=2)

        # Lowe's ratio test
        good = []
        for pair in matches:
            if len(pair) == 2:
                m, n = pair
                if m.distance < 0.75 * n.distance:
                    good.append(m)

        if len(good) < 8:
            return before, after, False

        src_pts = np.float32([kp_b[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst_pts = np.float32([kp_a[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)

        H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
        if H is None:
            return before, after, False

        h, w = after.shape[:2]
        aligned = cv2.warpPerspective(before, H, (w, h), borderMode=cv2.BORDER_REFLECT)
        return aligned, after, True

    # -----------------------------------------------------------------------
    # 2. Radiometric Normalization — Histogram Matching
    # -----------------------------------------------------------------------
    def _histogram_match(self, source: np.ndarray, reference: np.ndarray) -> np.ndarray:
        """
        Match histogram of source to reference per channel (CDF-based).
        """
        matched = np.zeros_like(source)
        for c in range(3):
            src_ch = source[:, :, c]
            ref_ch = reference[:, :, c]

            src_hist, _ = np.histogram(src_ch.ravel(), bins=256, range=(0, 256))
            ref_hist, _ = np.histogram(ref_ch.ravel(), bins=256, range=(0, 256))

            src_cdf = np.cumsum(src_hist).astype(np.float64)
            src_cdf /= src_cdf[-1] + 1e-10
            ref_cdf = np.cumsum(ref_hist).astype(np.float64)
            ref_cdf /= ref_cdf[-1] + 1e-10

            lookup = np.zeros(256, dtype=np.uint8)
            for i in range(256):
                j = np.argmin(np.abs(ref_cdf - src_cdf[i]))
                lookup[i] = j

            matched[:, :, c] = lookup[src_ch]

        return matched

    # -----------------------------------------------------------------------
    # 3. Multi-Index Change Detection
    # -----------------------------------------------------------------------
    def _compute_ndvi(self, img: np.ndarray) -> np.ndarray:
        """NDVI proxy using (Green - Red) / (Green + Red + ε)."""
        green = img[:, :, 1].astype(np.float32)
        red = img[:, :, 0].astype(np.float32)
        return (green - red) / (green + red + 1e-5)

    def _compute_ndwi(self, img: np.ndarray) -> np.ndarray:
        """NDWI proxy using (Blue - Green) / (Blue + Green + ε)."""
        blue = img[:, :, 2].astype(np.float32)
        green = img[:, :, 1].astype(np.float32)
        return (blue - green) / (blue + green + 1e-5)

    def _compute_bsi(self, img: np.ndarray) -> np.ndarray:
        """Bare Soil Index proxy: ((R + B) - G) / ((R + B) + G + ε)."""
        red = img[:, :, 0].astype(np.float32)
        green = img[:, :, 1].astype(np.float32)
        blue = img[:, :, 2].astype(np.float32)
        return ((red + blue) - green) / ((red + blue) + green + 1e-5)

    def _compute_scv(self, img1: np.ndarray, img2: np.ndarray) -> np.ndarray:
        """Spectral Change Vector: Euclidean distance across RGB channels."""
        diff = img1.astype(np.float32) - img2.astype(np.float32)
        return np.sqrt(np.sum(diff ** 2, axis=2)) / (255.0 * math.sqrt(3))

    def _compute_ssim_map(self, img1: np.ndarray, img2: np.ndarray) -> np.ndarray:
        """
        Structural Similarity Index Map (grayscale).
        Returns 1 - SSIM so higher = more damage.
        """
        gray1 = cv2.cvtColor(img1, cv2.COLOR_RGB2GRAY).astype(np.float64)
        gray2 = cv2.cvtColor(img2, cv2.COLOR_RGB2GRAY).astype(np.float64)

        C1 = (0.01 * 255) ** 2
        C2 = (0.03 * 255) ** 2

        mu1 = cv2.GaussianBlur(gray1, (11, 11), 1.5)
        mu2 = cv2.GaussianBlur(gray2, (11, 11), 1.5)
        mu1_sq = mu1 ** 2
        mu2_sq = mu2 ** 2
        mu1_mu2 = mu1 * mu2

        sigma1_sq = cv2.GaussianBlur(gray1 ** 2, (11, 11), 1.5) - mu1_sq
        sigma2_sq = cv2.GaussianBlur(gray2 ** 2, (11, 11), 1.5) - mu2_sq
        sigma12 = cv2.GaussianBlur(gray1 * gray2, (11, 11), 1.5) - mu1_mu2

        ssim_map = ((2 * mu1_mu2 + C1) * (2 * sigma12 + C2)) / \
                   ((mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2))

        # Invert: 1 - SSIM → higher = more structural damage
        return np.clip(1.0 - ssim_map, 0.0, 1.0).astype(np.float32)

    # -----------------------------------------------------------------------
    # 4. Edge / Texture Disruption
    # -----------------------------------------------------------------------
    def _edge_disruption(self, img1: np.ndarray, img2: np.ndarray) -> np.ndarray:
        """Compute Sobel edge magnitude difference between two images."""
        gray1 = cv2.cvtColor(img1, cv2.COLOR_RGB2GRAY)
        gray2 = cv2.cvtColor(img2, cv2.COLOR_RGB2GRAY)

        gx1 = cv2.Sobel(gray1, cv2.CV_32F, 1, 0, ksize=3)
        gy1 = cv2.Sobel(gray1, cv2.CV_32F, 0, 1, ksize=3)
        edge1 = cv2.magnitude(gx1, gy1)

        gx2 = cv2.Sobel(gray2, cv2.CV_32F, 1, 0, ksize=3)
        gy2 = cv2.Sobel(gray2, cv2.CV_32F, 0, 1, ksize=3)
        edge2 = cv2.magnitude(gx2, gy2)

        diff = cv2.absdiff(edge1, edge2)
        p99 = np.percentile(diff, 99) + 1e-5
        return np.clip(diff / p99, 0.0, 1.0).astype(np.float32)

    # -----------------------------------------------------------------------
    # 5. Composite Disruption Map
    # -----------------------------------------------------------------------
    def _build_composite(
        self,
        ssim_damage: np.ndarray,
        edge_diff: np.ndarray,
        ndvi_loss: np.ndarray,
        ndwi_gain: np.ndarray,
        bsi_gain: np.ndarray,
        scv: np.ndarray,
    ) -> np.ndarray:
        """
        Weighted fusion of multi-index change maps:
        0.25 × SSIM + 0.20 × edge + 0.15 × NDVI + 0.15 × NDWI + 0.15 × BSI + 0.10 × SCV
        """
        composite = (
            0.25 * ssim_damage +
            0.20 * edge_diff +
            0.15 * ndvi_loss +
            0.15 * ndwi_gain +
            0.15 * bsi_gain +
            0.10 * scv
        )
        composite = cv2.GaussianBlur(composite, (9, 9), 0)

        # Adaptive percentile normalization with a realistic significance floor
        # to prevent background sensor noise from inflating into 100% red false positives
        p95 = np.percentile(composite, 95)
        scale_denom = max(p95, 0.32)
        composite = np.clip(composite / scale_denom, 0.0, 1.0)

        return composite.astype(np.float32)

    # -----------------------------------------------------------------------
    # 6. Disaster Category Auto-Detection
    # -----------------------------------------------------------------------
    def _classify_disaster(
        self,
        ndwi_gain_pct: float,
        ndvi_loss_pct: float,
        bsi_gain_pct: float,
        edge_pct: float,
        user_type: str = "auto",
    ) -> str:
        if user_type != "auto":
            return user_type

        if ndwi_gain_pct > 12.0:
            return "Flood & Inundation"
        elif ndvi_loss_pct > 20.0 and bsi_gain_pct < 8.0:
            return "Wildfire Burn Scar"
        elif bsi_gain_pct > 15.0:
            return "Landslide / Mudflow"
        elif edge_pct > 18.0:
            return "Earthquake Building Collapse"
        elif edge_pct > 10.0 and ndvi_loss_pct > 10.0:
            return "Cyclone & Storm Damage"
        else:
            return "General Disaster"

    # -----------------------------------------------------------------------
    # 7. Connected Component Footprint Analysis
    # -----------------------------------------------------------------------
    def _count_damaged_structures(
        self, high_mask: np.ndarray
    ) -> Tuple[int, int, int, int]:
        """
        Returns (building_count, max_footprint_area_px, epicenter_x, epicenter_y).
        Also stores self._damaged_centroids as list of [x, y] for each building.
        """
        h, w = high_mask.shape
        high_u8 = (high_mask.astype(np.uint8)) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        cleaned = cv2.morphologyEx(high_u8, cv2.MORPH_OPEN, kernel)
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(cleaned)

        count = 0
        max_area = 0
        epi_x, epi_y = w // 2, h // 2
        building_centroids = []

        for i in range(1, num_labels):
            area = stats[i, cv2.CC_STAT_AREA]
            if 25 <= area <= 5000:
                count += 1
                cx = int(centroids[i][0])
                cy = int(centroids[i][1])
                building_centroids.append([cx, cy])
                if area > max_area:
                    max_area = area
                    epi_x = cx
                    epi_y = cy

        if count == 0 and np.sum(high_mask) > 0:
            count = max(1, int(np.sum(high_mask) / 120.0))
            # Generate approximate centroids from high-damage regions
            ys, xs = np.where(high_mask)
            if len(xs) > 0:
                # Cluster into approximate building locations
                step = max(1, len(xs) // min(count, 50))
                indices = list(range(0, len(xs), step))[:count]
                for idx in indices:
                    building_centroids.append([int(xs[idx]), int(ys[idx])])

        self._damaged_centroids = building_centroids
        return count, max_area, epi_x, epi_y

    # -----------------------------------------------------------------------
    # 8. Demographics & Economic Aggregation
    # -----------------------------------------------------------------------
    def _aggregate_demographics(
        self,
        building_count: int,
        impact_pixels: int,
        impact_hectares: float,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Location-aware population & cost estimation.
        """
        region = self.region_type

        # Heuristic region detection from coordinates (India)
        if latitude is not None and longitude is not None:
            if latitude > 30.0:
                region = "hilly"  # Himalayan belt
            elif latitude < 15.0 and longitude > 78.0:
                region = "semi_urban"
            # Default stays as initialized

        density = REGIONAL_DENSITY.get(region, REGIONAL_DENSITY["default"])
        cost_per_bldg = COST_PER_STRUCTURE_INR.get(region, COST_PER_STRUCTURE_INR["default"])
        infra_per_ha = INFRA_COST_PER_HECTARE_INR.get(region, INFRA_COST_PER_HECTARE_INR["default"])

        # Affected population = density × impact area in sq km
        impact_sq_km = (impact_pixels * self.sq_m_per_px) / 1e6
        affected_pop = max(int(density * impact_sq_km), int(building_count * 4.8))

        # Economic cost
        structure_cost_inr = building_count * cost_per_bldg
        infra_cost_inr = int(impact_hectares * infra_per_ha)
        total_inr = structure_cost_inr + infra_cost_inr
        total_usd = int(total_inr / INR_TO_USD)
        total_inr_lakhs = round(total_inr / 100000.0, 2)

        return {
            "region_type": region,
            "population_density_per_sqkm": density,
            "affected_population": affected_pop,
            "cost_inr": total_inr,
            "cost_inr_lakhs": total_inr_lakhs,
            "cost_usd": total_usd,
            "structure_cost_inr": structure_cost_inr,
            "infrastructure_cost_inr": infra_cost_inr,
        }

    # -----------------------------------------------------------------------
    # 9. Heatmap Overlay Generation
    # -----------------------------------------------------------------------
    def _generate_heatmap_overlay(
        self, diff_norm: np.ndarray, detected_type: str, img_after: Optional[np.ndarray] = None
    ) -> Tuple[str, np.ndarray, np.ndarray]:
        """
        Generates crystal-clear satellite-blended damage heatmap PNG (base64).
        """
        h, w = diff_norm.shape
        mod_mask = (diff_norm >= 0.25) & (diff_norm < 0.50)
        high_mask = diff_norm >= 0.50

        if img_after is not None:
            bg_rgb = img_after.astype(np.float32)
            blended = bg_rgb.copy()
            blended[mod_mask] = 0.55 * bg_rgb[mod_mask] + 0.45 * np.array([245, 158, 11])
            blended[high_mask] = 0.40 * bg_rgb[high_mask] + 0.60 * np.array([239, 68, 68])

            high_u8 = high_mask.astype(np.uint8) * 255
            contours, _ = cv2.findContours(high_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(blended, contours, -1, (255, 255, 255), 1)

            final_rgba = np.dstack((blended.astype(np.uint8), np.full((h, w), 255, dtype=np.uint8)))
            overlay_img = Image.fromarray(final_rgba, mode="RGBA")
        else:
            overlay = np.zeros((h, w, 4), dtype=np.uint8)
            overlay[mod_mask] = [245, 158, 11, 160]
            overlay[high_mask] = [239, 68, 68, 220]
            overlay_img = Image.fromarray(overlay, mode="RGBA")

        buf = io.BytesIO()
        overlay_img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        return b64, mod_mask, high_mask

    # -----------------------------------------------------------------------
    # 10. Staging Point Detection
    # -----------------------------------------------------------------------
    def _find_staging_point(self, diff_norm: np.ndarray) -> Tuple[int, int]:
        """Find low-risk staging location for rescue team."""
        low_mask = diff_norm < 0.20
        if np.any(low_mask):
            y_idxs, x_idxs = np.where(low_mask)
            return int(x_idxs[0]), int(y_idxs[0])
        return 30, 30

    # ===================================================================
    # PRIMARY API: Full Bi-Temporal Analysis
    # ===================================================================
    def analyze(
        self,
        before_image: Image.Image,
        after_image: Image.Image,
        disaster_type: str = "auto",
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        gsd: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Full dual-temporal change detection and impact assessment.
        Returns comprehensive metrics dict.
        """
        w, h = self.target_size
        if gsd is not None and gsd > 0:
            self.gsd_m_per_px = gsd
            self.sq_m_per_px = gsd ** 2

        img_before = np.array(before_image.convert("RGB").resize((w, h), Image.LANCZOS))
        img_after = np.array(after_image.convert("RGB").resize((w, h), Image.LANCZOS))

        # Step 1: Spatial alignment
        aligned_before, img_after, was_aligned = self._align_images(img_before, img_after)

        # Step 2: Radiometric normalization
        matched_before = self._histogram_match(aligned_before, img_after)

        # Step 3: Multi-index computation
        ssim_damage = self._compute_ssim_map(matched_before, img_after)
        edge_diff = self._edge_disruption(matched_before, img_after)

        ndvi_before = self._compute_ndvi(matched_before)
        ndvi_after = self._compute_ndvi(img_after)
        ndvi_loss = np.clip(ndvi_before - ndvi_after, 0.0, 1.0)

        ndwi_before = self._compute_ndwi(matched_before)
        ndwi_after = self._compute_ndwi(img_after)
        ndwi_gain = np.clip(ndwi_after - ndwi_before, 0.0, 1.0)

        bsi_before = self._compute_bsi(matched_before)
        bsi_after = self._compute_bsi(img_after)
        bsi_gain = np.clip(bsi_after - bsi_before, 0.0, 1.0)

        scv = self._compute_scv(matched_before, img_after)

        # Step 4: Composite disruption map
        composite = self._build_composite(
            ssim_damage, edge_diff, ndvi_loss, ndwi_gain, bsi_gain, scv
        )

        # Step 5: Classification percentages
        ndwi_pct = float(np.mean(ndwi_gain > 0.25)) * 100.0
        ndvi_pct = float(np.mean(ndvi_loss > 0.20)) * 100.0
        bsi_pct = float(np.mean(bsi_gain > 0.20)) * 100.0
        edge_pct = float(np.mean(edge_diff > 0.30)) * 100.0

        detected_type = self._classify_disaster(
            ndwi_pct, ndvi_pct, bsi_pct, edge_pct, disaster_type
        )

        # Step 6: Heatmap overlay
        heatmap_b64, mod_mask, high_mask = self._generate_heatmap_overlay(composite, detected_type, img_after=img_after)

        total_change_pct = round(float(np.mean(composite >= 0.25)) * 100.0, 1)
        high_damage_pct = round(float(np.mean(high_mask)) * 100.0, 1)
        mod_damage_pct = round(float(np.mean(mod_mask)) * 100.0, 1)

        # Step 7: Footprint analysis
        building_count, max_fp, epi_x, epi_y = self._count_damaged_structures(high_mask)

        # Step 8: Demographics & cost
        impact_pixels = int(np.sum(composite >= 0.25))
        impact_area_sqm = int(impact_pixels * self.sq_m_per_px)
        impact_hectares = round(impact_area_sqm / 10000.0, 2)

        demographics = self._aggregate_demographics(
            building_count, impact_pixels, impact_hectares, latitude, longitude
        )

        # Step 9: Staging point
        staging_x, staging_y = self._find_staging_point(composite)

        # Step 10: Damage status
        damage_status = "Minimal / Undetected"
        if total_change_pct > 25.0:
            damage_status = f"CRITICAL {detected_type.upper()} ZONE"
        elif total_change_pct > 10.0:
            damage_status = f"HIGH {detected_type.upper()} IMPACT"
        elif total_change_pct > 3.0:
            damage_status = f"MODERATE {detected_type.upper()}"

        # Mean SSIM score for overall structural integrity
        mean_ssim = round(float(1.0 - np.mean(ssim_damage)), 4)

        return {
            "change_heatmap_png": heatmap_b64,
            "disaster_type": detected_type,
            "total_change_pct": total_change_pct,
            "high_damage_pct": high_damage_pct,
            "moderate_damage_pct": mod_damage_pct,
            "damage_status": damage_status,
            "building_count": building_count,
            "affected_population": demographics["affected_population"],
            "impact_area_sqm": impact_area_sqm,
            "impact_area_hectares": impact_hectares,
            "cost_usd": demographics["cost_usd"],
            "cost_inr_lakhs": demographics["cost_inr_lakhs"],
            "epicenter_pos": [epi_x, epi_y],
            "staging_pos": [staging_x, staging_y],
            # Enhanced multi-index breakdown
            "spatial_aligned": was_aligned,
            "mean_ssim": mean_ssim,
            "ndvi_loss_pct": round(ndvi_pct, 1),
            "ndwi_gain_pct": round(ndwi_pct, 1),
            "bsi_gain_pct": round(bsi_pct, 1),
            "edge_disruption_pct": round(edge_pct, 1),
            "scv_mean": round(float(np.mean(scv)) * 100.0, 2),
            "region_type": demographics["region_type"],
            "population_density_per_sqkm": demographics["population_density_per_sqkm"],
            "structure_cost_inr": demographics["structure_cost_inr"],
            "infrastructure_cost_inr": demographics["infrastructure_cost_inr"],
            "damaged_centroids": getattr(self, '_damaged_centroids', [])[:50],
        }

    # ===================================================================
    # SECONDARY API: Single-Image Disaster Analysis
    # ===================================================================
    def analyze_single(
        self,
        after_image: Image.Image,
        disaster_type: str = "auto",
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        gsd: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Single-view multi-disaster assessment on a present optical image.
        """
        w, h = self.target_size
        if gsd is not None and gsd > 0:
            self.gsd_m_per_px = gsd
            self.sq_m_per_px = gsd ** 2

        img = np.array(after_image.convert("RGB").resize((w, h), Image.LANCZOS))
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

        # Texture disruption via Laplacian
        laplacian = cv2.Laplacian(gray, cv2.CV_32F)
        abs_lap = np.abs(laplacian)
        lap_blur = cv2.GaussianBlur(abs_lap, (15, 15), 0)

        # HSV-based anomaly
        hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
        val = hsv[:, :, 2].astype(np.float32) / 255.0

        p98_lap = np.percentile(lap_blur, 98) + 1e-5
        disruption = 0.6 * (lap_blur / p98_lap) + 0.4 * (1.0 - val)
        disruption_norm = np.clip(cv2.GaussianBlur(disruption, (11, 11), 0), 0.0, 1.0)

        # Generate satellite-blended heatmap overlay
        change_b64, mod_mask, high_mask = self._generate_heatmap_overlay(disruption_norm, disaster_type, img_after=img)

        total_change_pct = round(float(np.mean(disruption_norm >= 0.35)) * 100.0, 1)
        high_damage_pct = round(float(np.mean(high_mask)) * 100.0, 1)
        mod_damage_pct = round(float(np.mean(mod_mask)) * 100.0, 1)

        building_count, _, epi_x, epi_y = self._count_damaged_structures(high_mask)
        staging_x, staging_y = self._find_staging_point(disruption_norm)

        impact_pixels = int(np.sum(disruption_norm >= 0.35))
        impact_area_sqm = int(impact_pixels * self.sq_m_per_px)
        impact_hectares = round(impact_area_sqm / 10000.0, 2)

        demographics = self._aggregate_demographics(
            building_count, impact_pixels, impact_hectares, latitude, longitude
        )

        damage_status = "Minimal / Undetected"
        if total_change_pct > 25.0:
            damage_status = "CRITICAL DISASTER ZONE"
        elif total_change_pct > 10.0:
            damage_status = "HIGH DISASTER IMPACT"
        elif total_change_pct > 3.0:
            damage_status = "MODERATE STRUCTURAL SHIFT"

        return {
            "change_heatmap_png": change_b64,
            "disaster_type": "Disaster Assessment (Single View)",
            "total_change_pct": total_change_pct,
            "high_damage_pct": high_damage_pct,
            "moderate_damage_pct": mod_damage_pct,
            "damage_status": damage_status,
            "building_count": building_count,
            "affected_population": demographics["affected_population"],
            "impact_area_sqm": impact_area_sqm,
            "impact_area_hectares": impact_hectares,
            "cost_usd": demographics["cost_usd"],
            "cost_inr_lakhs": demographics["cost_inr_lakhs"],
            "epicenter_pos": [epi_x, epi_y],
            "staging_pos": [staging_x, staging_y],
            "spatial_aligned": False,
            "mean_ssim": None,
            "ndvi_loss_pct": None,
            "ndwi_gain_pct": None,
            "bsi_gain_pct": None,
            "edge_disruption_pct": None,
            "scv_mean": None,
            "region_type": demographics["region_type"],
            "population_density_per_sqkm": demographics["population_density_per_sqkm"],
            "damaged_centroids": getattr(self, '_damaged_centroids', [])[:50],
        }
