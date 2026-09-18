"""
DepthWizard Backend — Depth Anything V2 Inference Server
Runs the depth model once at startup and serves predictions via FastAPI.
"""

import io
import base64
import time
import logging

import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image

from app.inference import DepthEstimator
from app.preprocessing import preprocess_image
from app.calibration import calibrate_depth
from app.exports import depth_to_npy_base64, depth_to_ply_base64

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="DepthWizard Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model instance — loaded once at startup
estimator: DepthEstimator = None


@app.on_event("startup")
async def load_model():
    global estimator
    logger.info("Loading Depth Anything V2 model (CPU)...")
    estimator = DepthEstimator()
    logger.info("Model loaded successfully.")


@app.get("/api/health")
async def health():
    return {
        "status": "ready" if estimator is not None else "loading",
        "model": "Depth-Anything-V2-Small",
        "device": str(estimator.device) if estimator else "unknown",
        "adaptation": "Not applied",
        "fine_tuning": "Not applied",
        "adapter": "No (base model)",
    }


@app.post("/api/reconstruct")
async def reconstruct(file: UploadFile = File(...)):
    if estimator is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    try:
        start_time = time.time()

        # Read and preprocess image
        raw_bytes = await file.read()
        image = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        original_width, original_height = image.size

        inference_image = preprocess_image(image)

        # Run depth inference
        depth_raw, depth_width, depth_height = estimator.predict(inference_image)

        # Refine depth via DepthRefinementEngine (water flattening, rooftop planar smoothing, terrain bilateral filter)
        from app.terrain.refinement import DepthRefinementEngine
        refiner = DepthRefinementEngine()
        depth_raw = refiner.flatten_water_and_features(depth_raw, rgb_image=np.array(image))

        # Normalize to 0-1 range
        d_min = float(np.min(depth_raw))
        d_max = float(np.max(depth_raw))
        d_range = d_max - d_min
        if d_range > 0:
            depth_normalized = (depth_raw - d_min) / d_range
        else:
            depth_normalized = np.zeros_like(depth_raw)

        d_mean = float(np.mean(depth_raw))

        # Generate clean linear grayscale visualization PNG
        raw_u8 = (depth_normalized * 255).astype(np.uint8)
        import cv2
        depth_vis = cv2.bilateralFilter(raw_u8, d=5, sigmaColor=25, sigmaSpace=25)

        depth_image = Image.fromarray(depth_vis, mode="L")
        buf = io.BytesIO()
        depth_image.save(buf, format="PNG")
        depth_png_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        # Encode float32 array as base64 for frontend
        depth_float32_b64 = base64.b64encode(depth_normalized.astype(np.float32).tobytes()).decode("utf-8")

        # Compute quality metrics
        valid_pixels = int(np.sum(np.isfinite(depth_raw)))
        total_pixels = depth_raw.size
        outlier_count = int(np.sum(
            (depth_raw < d_min + 0.01 * d_range) | (depth_raw > d_max - 0.01 * d_range)
        )) if d_range > 0 else 0

        processing_time = time.time() - start_time

        return JSONResponse({
            "depth_png": depth_png_b64,
            "depth_float32": depth_float32_b64,
            "width": depth_width,
            "height": depth_height,
            "original_width": original_width,
            "original_height": original_height,
            "mode": "relative",
            "metric_available": False,
            "min_depth": d_min,
            "max_depth": d_max,
            "mean_depth": d_mean,
            "valid_pixels_pct": round(valid_pixels / total_pixels * 100, 1),
            "outlier_pct": round(outlier_count / total_pixels * 100, 1),
            "processing_time": round(processing_time, 4),
            "device": str(estimator.device),
            "model": "Depth-Anything-V2-Small",
        })

    except Exception as e:
        logger.error(f"Reconstruction failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/calibrate")
async def calibrate(
    file: UploadFile = File(...),
    min_elev: float = 0.0,
    max_elev: float = 100.0,
):
    """Calibrate relative depth to metric elevation using H = aD + b."""
    if estimator is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    try:
        raw_bytes = await file.read()
        image = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        inference_image = preprocess_image(image)
        depth_raw, w, h = estimator.predict(inference_image)

        result = calibrate_depth(depth_raw, min_elev, max_elev)

        # Encode calibrated elevation as base64 float32
        elev_b64 = base64.b64encode(result["elevation"].astype(np.float32).tobytes()).decode("utf-8")

        return JSONResponse({
            "elevation_float32": elev_b64,
            "width": w,
            "height": h,
            "scale": result["scale"],
            "offset": result["offset"],
            "min_elevation": result["min_elevation"],
            "max_elevation": result["max_elevation"],
            "mean_elevation": result["mean_elevation"],
            "rmse": result["rmse"],
            "mae": result["mae"],
            "mode": "metric",
        })
    except Exception as e:
        logger.error(f"Calibration failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/export/npy")
async def export_npy(file: UploadFile = File(...)):
    """Export depth as NPY file."""
    if estimator is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    raw_bytes = await file.read()
    image = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    inference_image = preprocess_image(image)
    depth_raw, w, h = estimator.predict(inference_image)

    npy_b64 = depth_to_npy_base64(depth_raw)
    return JSONResponse({"npy": npy_b64, "width": w, "height": h})


@app.post("/api/rescue-route")
async def rescue_route(payload: dict):
    """
    Calculate terrain-informed rescue route given a depth/height array, start position, and destination.
    """
    try:
        from app.terrain.routing import calculate_rescue_route

        depth_b64 = payload.get("depth_float32")
        width = payload.get("width")
        height = payload.get("height")
        start_pos = payload.get("start_pos")  # [x, y]
        end_pos = payload.get("end_pos")      # [x, y]

        if not depth_b64 or not width or not height or not start_pos or not end_pos:
            raise HTTPException(status_code=400, detail="Missing required parameters for route calculation")

        raw_bytes = base64.b64decode(depth_b64)
        depth_array = np.frombuffer(raw_bytes, dtype=np.float32).reshape((height, width))

        route_data = calculate_rescue_route(depth_array, start_pos, end_pos)
        return JSONResponse(route_data)

    except Exception as e:
        logger.error(f"Rescue route calculation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/fetch-pre-disaster-satellite")
async def fetch_pre_disaster_satellite_endpoint(payload: dict):
    """
    Fetches a real optical satellite image from ~1 month prior using ArcGIS World Imagery REST API.
    Accepts latitude, longitude, and optional bbox.
    """
    try:
        from app.terrain.damage import fetch_pre_disaster_satellite

        lat = payload.get("latitude")
        lon = payload.get("longitude")
        bbox = payload.get("bbox")

        img, png_b64 = fetch_pre_disaster_satellite(lat, lon, bbox)
        return JSONResponse({
            "pre_disaster_b64": png_b64,
            "width": img.width,
            "height": img.height,
            "timestamp": "1 Month Prior (~30 Days Ago)",
            "source": "ArcGIS World Imagery Satellite Archive"
        })
    except Exception as e:
        logger.error(f"Pre-disaster satellite fetch failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/analyze-damage")
async def analyze_damage_endpoint(
    after_file: UploadFile = File(...),
    before_file: UploadFile = File(None),
    disaster_type: str = "auto"
):
    """
    Compare past and present image pair (or analyze single present disaster image)
    for Flood, Earthquake, Landslide, Cyclone, and Wildfire disaster signatures.
    Returns 3D change overlay heatmap, destroyed structures count, affected population,
    impact area sqm/hectares, cost damages (INR Lakhs & USD), and rescue points.
    """
    try:
        from app.terrain.damage import analyze_disaster, analyze_single_image_disaster

        a_bytes = await after_file.read()
        a_img = Image.open(io.BytesIO(a_bytes)).convert("RGB")

        if before_file is not None and before_file.filename:
            b_bytes = await before_file.read()
            if len(b_bytes) > 0:
                b_img = Image.open(io.BytesIO(b_bytes)).convert("RGB")
                result = analyze_disaster(b_img, a_img, disaster_type=disaster_type)
                return JSONResponse(result)

        # Fallback to single-view disaster damage estimation
        result = analyze_single_image_disaster(a_img, disaster_type=disaster_type)
        return JSONResponse(result)

    except Exception as e:
        logger.error(f"Damage analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/analyze-damage-v2")
async def analyze_damage_v2_endpoint(
    after_file: UploadFile = File(...),
    before_file: UploadFile = File(None),
    disaster_type: str = Query("auto"),
    latitude: float = Query(None),
    longitude: float = Query(None),
    gsd: float = Query(None),
):
    """
    Enhanced dual-temporal damage analysis with multi-index change detection
    (SSIM, NDVI, NDWI, BSI, SCV), ORB spatial registration, histogram matching,
    and location-aware demographics/cost aggregation.
    """
    try:
        from app.terrain.disaster_analyzer import DisasterAnalyzer

        analyzer = DisasterAnalyzer(
            gsd_m_per_px=gsd if gsd and gsd > 0 else 1.5,
        )

        a_bytes = await after_file.read()
        a_img = Image.open(io.BytesIO(a_bytes)).convert("RGB")

        if before_file is not None and before_file.filename:
            b_bytes = await before_file.read()
            if len(b_bytes) > 0:
                b_img = Image.open(io.BytesIO(b_bytes)).convert("RGB")
                result = analyzer.analyze(
                    b_img, a_img,
                    disaster_type=disaster_type,
                    latitude=latitude,
                    longitude=longitude,
                    gsd=gsd,
                )
                return JSONResponse(result)

        # Fallback to single-view analysis
        result = analyzer.analyze_single(
            a_img,
            disaster_type=disaster_type,
            latitude=latitude,
            longitude=longitude,
            gsd=gsd,
        )
        return JSONResponse(result)

    except Exception as e:
        logger.error(f"Damage analysis v2 failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/predictive-risk")
async def predictive_risk_endpoint(
    image_t1: UploadFile = File(...),
    image_t2: UploadFile = File(...),
    latitude: float = Query(None),
    longitude: float = Query(None),
    gsd: float = Query(None),
):
    """
    Predictive landslide/erosion risk analysis between two historical epochs.
    Computes temporal terrain drift, vegetation recession, structural creep
    (optical flow), water proximity risk, and danger zone extraction.
    Returns risk heatmap, danger zones, and calibrated early warning.
    """
    try:
        from app.terrain.predictive_risk import PredictiveRiskEngine

        engine = PredictiveRiskEngine(
            gsd_m_per_px=gsd if gsd and gsd > 0 else 1.5,
        )

        t1_bytes = await image_t1.read()
        t2_bytes = await image_t2.read()
        t1_img = Image.open(io.BytesIO(t1_bytes)).convert("RGB")
        t2_img = Image.open(io.BytesIO(t2_bytes)).convert("RGB")

        result = engine.analyze(
            t1_img, t2_img,
            latitude=latitude,
            longitude=longitude,
            gsd=gsd,
        )
        return JSONResponse(result)

    except Exception as e:
        logger.error(f"Predictive risk analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))



