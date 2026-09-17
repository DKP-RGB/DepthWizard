# DepthWizard — Implementation-Ready PRD (Revision 3)
### SIH 2026 · Problem Statement 26175 · Organization: ISRO / Department of Space

This revision replaces ambiguous descriptions with concrete input→output→technology specifications so a small student team can build directly from it. Priority order for every decision in this document:

**1. SIH compliance → 2. Working end-to-end pipeline → 3. DSM/depth accuracy & validation → 4. Correct geospatial processing → 5. Functional 3D reconstruction → 6. UX/UI polish → 7. Advanced features.**

The MVP must run, start to finish, as:

**Input Image → AI Depth → Calibration → DSM/rDSM → 3D Mesh → Visualization → Validation**

---

## 1. Executive Summary

DepthWizard converts a single optical image into a measurable, explorable 3D elevation model. It supports two concrete input modes — non-georeferenced JPG/PNG (relative depth only) and georeferenced GeoTIFF (metric, DEM-calibrated depth) — plus an optional location-assisted path for JPG/PNG that adds DEM-based calibration when the user supplies coordinates. Every capability below is specified concretely enough to implement directly: exact model, exact calibration formula, exact API contracts, exact storage layout, exact fallback behavior. Nothing in the MVP path depends on a paid API key or a live network connection — everything has a local/cached fallback so the pipeline is guaranteed to complete during judging.

---

## 2. Problem Definition

Single optical images are abundant; elevation data is not. The MVP must prove — with real, computed numbers, not narrative claims — that a pretrained monocular depth model plus a simple, defensible calibration step against coarse open DEM data can produce a usable elevation surface, and that this surface can be turned into a navigable, measurable 3D environment. The hardest real problem is not generating a depth map; it is correctly converting an unscaled, unitless relative depth map into meters, and being honest about how good that conversion actually is.

---

## 3. Product Vision

A serious, self-contained geospatial instrument, not a demo toy: upload one image, get a real (not simulated) elevation reconstruction with a real validation number attached to it, explorable in 3D. Every screen must let a technical judge find the computed evidence behind what they're looking at within one click.

---

## 4. Goals

1. Ship a fully working P0 pipeline (Section 31) end-to-end, with no simulated/fake steps outside explicitly labeled Demo Mode.
2. Make Mode A (JPG/PNG, relative) and Mode B (GeoTIFF, metric) both fully functional and clearly distinguished everywhere elevation is shown.
3. Make location-assisted calibration for JPG/PNG optional and non-blocking — manual coordinate entry always works even if imagery matching or any external API fails.
4. Make every displayed number traceable to an actual computation, with a collapsible Technical Inspector (Section 45) showing exactly how it was produced.
5. Guarantee the full flow (upload → depth → calibration → DSM → 3D → validation) completes in a network-independent Demo Mode.

## 5. Non-Goals

- No multi-image stereo/SfM reconstruction.
- No claim of survey-grade (cm-level) accuracy.
- No general GIS suite (layers, vector editing, multi-user collaboration).
- No training a depth model from scratch.
- No guaranteed global geolocation from an arbitrary photo — image matching is a confidence-scored, user-confirmed assist only.
- No mobile app.
- No dependency, anywhere in the P0 path, on a paid API key.

---

## 6. Users

Same four personas as the prior revision (ISRO remote-sensing scientist, SIH judge, urban-planning non-specialist, student teammate/builder) — unchanged; see prior PRD for full descriptions. This revision does not alter who the product is for, only what it concretely does.

---

## 7. User Journey

1. Upload JPG/PNG or GeoTIFF → metadata read and shown immediately.
2. **Mode B (GeoTIFF):** pipeline proceeds automatically toward metric calibration using the embedded CRS.
3. **Mode A (JPG/PNG):** user optionally supplies a location (coordinates / map pin / place search); if skipped, pipeline proceeds relative-only.
4. If location supplied: candidate imagery retrieved, matched, confidence shown, user confirms or rejects before calibration proceeds.
5. Pipeline runs through explicit states (Section 28), each visible in the UI with real timing.
6. Results screen: depth map, DSM/rDSM, elevation stats, Technical Inspector.
7. 3D flythrough: navigate, measure height/distance/slope.
8. Validation screen (Mode B, or Mode A with a reference dataset available): RMSE/MAE/correlation/error heatmap, clearly labeled Demo/Precomputed or Computed from current reconstruction.
9. Project saved to history with full artifact set (Section 29).

---

## 8. Core Features

Same feature list as the prior PRD (Section 9 there), now each one respecified below with **Input → Processing → Output → Technology → API → Storage → UI** in Sections 9–17. No feature description in this revision is allowed to stand as a vague verb phrase.

---

## 9. Input Modes — Concrete Specification

### Mode A — Non-Georeferenced JPG/PNG

```
Image (JPG/PNG)
 → Preprocessing (decode, EXIF strip, resize to model input, normalize)
 → DepthEstimator.predict() → relative depth map (H×W float32)
 → rDSM generation (normalize relative depth to a display-friendly relative-elevation raster)
 → Mesh generation from rDSM
 → RGB texture (original image, pixel-aligned) applied to mesh
 → 3D flythrough (relative units only — UI explicitly labels axis as "relative," no meters)
```
**Technology:** PIL/OpenCV (preprocessing), PyTorch + Depth Anything V2 (Section 16), NumPy (rDSM), trimesh (mesh), Three.js (client render).
**API:** `POST /projects` (upload) → `POST /projects/{id}/process` (mode auto-detected as `relative`) → `GET /projects/{id}/dsm`, `GET /projects/{id}/mesh`.
**Storage:** original image, depth map (`.npy` + PNG preview), rDSM raster, mesh (`.glb`), all under `data/{project_id}/{run_id}/`.
**UI:** elevation values shown as unitless "relative height" with no meter suffix; a persistent badge reading **"Relative Only — No Location Provided"**.

### Mode B — Georeferenced GeoTIFF

```
GeoTIFF
 → Rasterio: read CRS, geotransform, bounds, band count, nodata
 → Reject if CRS missing (fall back to Mode A relative path with a UI notice)
 → DepthEstimator.predict() → relative depth map
 → Compute image geographic footprint (bounds in EPSG:4326)
 → DEMProvider.getRaster(footprint) → reference DEM tile
 → Reproject DEM to image CRS/resolution (Rasterio.warp)
 → Sample correspondence points (Section 14)
 → CalibrationEngine.fit(relative_depth_samples, dem_elevation_samples) → (a, b, residual)
 → Apply Z = a·D + b across full relative depth map → absolute DSM (float32, meters)
 → Mesh generation from DSM (real-world scale via geotransform)
 → Texture projection using geotransform-derived UVs
 → Validation against reference DEM/DSM if available
```
**Technology:** Rasterio, GDAL, PyProj, PyTorch, NumPy/SciPy (`scipy.optimize` or `numpy.polyfit` for affine fit), trimesh, Three.js.
**API:** `POST /projects` → `POST /projects/{id}/process` (mode auto-detected as `metric`) → `GET /projects/{id}/dsm` (GeoTIFF) → `GET /projects/{id}/validation`.
**Storage:** original GeoTIFF, relative depth `.npy`, DEM tile cache (`data/cache/dem/{tile_key}.tif`), calibration params JSON, absolute DSM GeoTIFF, mesh `.glb`, validation JSON.
**UI:** elevation values shown with `m` suffix; a persistent badge reading **"Metric — Calibrated via {DEM source}, residual {x} m"**.

---

## 10. Location-Assisted JPG/PNG Workflow — Concrete Specification

**With location:**
```
JPG/PNG + user location (lat/long from map pin, search, or manual entry)
 → ImageryProvider.getCandidateTile(location, radius) → candidate satellite tile(s)
 → ImageMatcher.match(uploaded_image, candidate_tiles) → best_match, confidence, matched_bbox
 → User reviews match on a side-by-side panel → Confirm / Reject / Retry-with-adjusted-pin
 → On confirm: proceed exactly as Mode B from "compute footprint" onward, using the confirmed bbox as the footprint instead of embedded GeoTIFF bounds
 → On reject or skip: proceed as Mode A relative-only
```
**Without location:** proceeds directly as Mode A relative-only — this path is never blocked by anything location-related.

**API:**
- `POST /projects/{id}/location` — body: `{ "lat": number, "lon": number, "source": "map_pin"|"search"|"manual" }` or `{ "skipped": true }`.
- `POST /projects/{id}/match` — triggers matching against the stored location; returns `{ "confidence": 0-1, "matched_bbox": [...], "candidate_thumbnail_url": string }`.
- `POST /projects/{id}/match/confirm` — body: `{ "confirmed": boolean }`.

**Critical rule (non-negotiable):** `POST /projects/{id}/process` must accept and complete successfully with `location: null` at all times. Location and matching are additive, never required, anywhere in the code path.

---

## 11. Image-Matching MVP — Concrete Specification

Global image retrieval/matching is out of scope. The MVP implements a **bounded, coordinate-anchored verification matcher**, not a search engine:

1. User supplies an approximate coordinate (never inferred blind).
2. `ImageryProvider` fetches a bounded candidate tile set: one tile centered on the coordinate plus, optionally, a small grid (e.g., 3×3) of adjacent tiles at a fixed zoom level, sourced from a keyless public XYZ tile service (ESRI World Imagery, which requires no API key for reasonable request volumes) — see Section 8/16 provider architecture.
3. Each candidate tile is compared against the uploaded image using **ORB feature detection + descriptor matching + RANSAC homography inlier count** (OpenCV `cv2.ORB_create`, `cv2.BFMatcher`, `cv2.findHomography`). This is deliberately a classical CV approach — reliable, dependency-light, explainable to a judge, and requires no trained embedding model.
4. Confidence score = `inlier_count / total_matched_keypoints`, clamped to [0,1]; candidate with the highest score and at least a minimum inlier count (e.g., 15) is returned as best match. Below that threshold, no confident match is returned and the UI surfaces "No confident match — proceed with manual pin or continue unlocated."
5. Best match's tile geographic bounds become the confirmed footprint if the user accepts.

If ORB matching performs poorly on a given image class during testing, the documented fallback is: **skip automatic matching entirely, keep manual coordinate + map-pin as the sole location mechanism for the live demo.** This is an explicitly sanctioned MVP outcome, not a failure state — Section 5 policy.

---

## 12. DEM Provider Architecture

```python
class DEMProvider(Protocol):
    def get_raster(self, bounds: BBox, target_resolution_m: float | None = None) -> DEMTile: ...
    def get_elevation(self, lat: float, lon: float) -> float | None: ...
    def get_resolution_m(self) -> float: ...
    def get_metadata(self) -> dict:  # source name, vertical datum, acquisition date, license
        ...
```

**Primary MVP provider — Local SRTM (required, keyless):** SRTM 30m tiles fetched/cached via the `elevation` Python package (wraps public SRTM 1-arc-second `.hgt` tiles, no API key) on first request per bounding box, cached to `data/cache/dem/srtm/`. This guarantees the P0 path never depends on a paid or rate-limited external key.

**Optional provider — Copernicus DEM (30m/90m) via OpenTopography's public Global DEM API:** used when the free-tier API key (`DEM_API_KEY`, optional env var) is configured; otherwise silently skipped in favor of SRTM.

**Fallback chain:** `Copernicus (if key present) → SRTM (always) → cached tile from a prior identical bbox request → scene-statistics calibration (Section 13, method 3) if no DEM tile is retrievable at all.`

**Required failure handling (must not crash the pipeline):**
| Condition | Behavior |
|---|---|
| DEM API timeout | Retry once (5s timeout, 1 retry), then fall to next provider in chain |
| Coverage missing for footprint | Fall to next provider; if none, use scene-statistics calibration with confidence downgraded to Low |
| Rate limit hit | Fall to cached/local SRTM; log the event |
| Invalid/corrupt response | Discard, fall to next provider, log the event |

---

## 13. Calibration Architecture

**Model:** affine fit, exactly as specified —

```
Z_metric = a × D_relative + b
```

**Depth polarity check (mandatory, before fitting):** Depth Anything V2's default output is *relative depth where larger values = closer to camera* (inverse-depth-like for the base checkpoint used here — see Section 16 for exact output convention). Before fitting, compute the Pearson correlation between `D_relative` and `DEM_elevation` at correspondence points; if correlation is negative beyond a small tolerance, invert `D_relative → -D_relative` (or `1/D_relative` if using true inverse-depth) before fitting, and record which transform was applied in the calibration metadata. This step is explicit and logged — it must never be silently assumed in either direction.

**Fitting procedure:**
1. Generate correspondence points (Section 14).
2. Remove outliers: drop samples where `|z-score| > 2.5` on either `D_relative` or `DEM_elevation`, and drop any sample landing on a DEM nodata pixel.
3. Require a minimum of 30 valid correspondence points to attempt a DEM-based fit; below that, fall to scene-statistics calibration (method 3 below) with confidence forced to Low.
4. Fit `a, b` via least-squares (`numpy.polyfit(D_relative, DEM_elevation, 1)`).
5. Compute residual: RMSE of `(a·D_relative + b) − DEM_elevation` over the correspondence set — this is the number shown in the "Metric — Calibrated" badge (Section 9).
6. Apply the fitted transform to the *entire* relative depth raster (not just the sample points) to produce the DSM.
7. Store `{a, b, residual_rmse, n_samples, polarity_correction_applied, method: "dem_affine"}` as the calibration parameters JSON artifact.

**Calibration method ranking (unchanged from prior PRD, now formally tied into the fallback chain):**
1. **DEM affine fit (primary)** — as above.
2. **GCP-based fit** — same affine procedure, but correspondence points come from user-entered `(pixel_x, pixel_y, lat, lon, elevation)` tuples instead of DEM sampling; used when GCPs are supplied, overrides DEM fit if both are present and GCP count ≥ 4.
3. **Scene-statistics fallback** — no DEM/GCP fit possible: assume a flat local ground-plane elevation (from a single DEM point-sample at the image center, or 0 if no DEM sample exists at all) and apply only a fixed default scale derived from typical relative-depth range assumptions; **confidence is forced to Low and the UI must display "Uncalibrated estimate — terrain reference unavailable."**

---

## 14. Calibration Data Sampling

For georeferenced imagery (Mode B or confirmed-match Mode A):

```
Image pixel (px, py)
 → geographic coordinate via geotransform: (lon, lat) = transform * (px, py)
 → DEM pixel via DEM's own geotransform (after reprojecting DEM to image CRS)
 → reference elevation value
```

**Sampling density:** a regular grid of correspondence points at a fixed stride (e.g., every 20th pixel in both axes, capped at a maximum of 2,000 samples for performance) rather than every pixel — sufficient for a global affine fit and fast to compute.

**Stored per valid sample** (as specified): `pixel_x, pixel_y, relative_depth, latitude, longitude, reference_elevation`. The full sample table is persisted as `calibration_samples.json` per run so the fit is auditable/reproducible, not just the final `(a, b)`.

**Alignment requirement:** never assume image and DEM share resolution or pixel grid — DEM is always reprojected/resampled (bilinear) into the image's CRS and pixel grid via Rasterio before sampling, using the image geotransform as the sampling authority.

---

## 15. DEM ≠ DSM — Explicit Handling

The DEM (SRTM/Copernicus) is used **only** as the absolute-elevation reference for calibrating the *scale and offset* of the AI depth signal — it is never itself displayed as the output DSM. The output DSM's *spatial detail* (building edges, local structure variation) comes entirely from the monocular depth model's relative predictions; the DEM only anchors that signal to real-world meters. This distinction is stated directly in the Technical Inspector (Section 45) and in the Help documentation, and the UI must never render the raw DEM tile as if it were the reconstruction result.

---

## 16. Depth Model — Concrete Specification

**Model:** Depth Anything V2 — Small checkpoint (`depth-anything/Depth-Anything-V2-Small-hf`) for CPU-feasible inference speed during a live demo; Base checkpoint (`depth-anything/Depth-Anything-V2-Base-hf`) used when a CUDA GPU is available and higher spatial fidelity is worth the extra latency. Loaded via Hugging Face `transformers` (`AutoModelForDepthEstimation` + `AutoImageProcessor`), which requires no external API key and runs fully offline once weights are cached locally.

```python
class DepthEstimator(Protocol):
    def load(self) -> None: ...
    def predict(self, image: np.ndarray) -> DepthResult: ...

@dataclass
class DepthResult:
    relative_depth: np.ndarray   # H×W float32, matches predict() input H×W after resize-back
    input_size: tuple[int, int]
    inference_ms: float
    device: str                  # "cuda" | "cpu"
```

**Preprocessing:** resize longest edge to a fixed model input size (518px, per the model's default processor config), normalize per the model's published mean/std, RGB channel order enforced (convert grayscale/RGBA inputs — Section 32).

**Output convention:** the model returns a single-channel relative depth map where **higher value = closer to the camera** (its native convention). This is documented explicitly so the Calibration module (Section 13) knows which polarity to expect before its own correlation check.

**Resizing strategy:** model output is resized back to the *original* image dimensions (or the processing-resolution dimensions after tiling — Section 33) via bilinear interpolation before any downstream raster operation, so pixel-to-geocoordinate mapping stays valid.

**Device handling:** `torch.cuda.is_available()` checked at `load()`; falls to CPU automatically with no crash, and the UI surfaces `device: "cpu"` with an expected-slower-processing notice (Section 34).

**Model caching:** weights downloaded once to a local cache dir (`MODEL_PATH` env var, default `~/.cache/depthwizard/models`) on first run; subsequent runs and the offline Demo Mode load from this local cache with no network call required.

**Invalid pixel handling:** any NaN/Inf in raw model output clipped to the valid min/max of the finite values in that map before use; a warning is logged (should not occur with this model family under normal conditions, but the guard is mandatory).

---

## 17. Remote-Sensing Domain Gap

**Baseline:** Depth Anything V2 run as-is (Section 16) — pretrained on ground-level/general imagery, not aerial/satellite data. Expect measurably weaker performance on pure top-down orthoimagery than on oblique/aerial perspective shots, since the model was not trained on nadir viewpoints.

**Improvement path (not a P0 dependency):** if time and compute allow, evaluate fine-tuning or few-shot adaptation on a remote-sensing depth dataset such as **GAMUS**, and report a baseline-vs-adapted comparison using the same validation metrics (Section 23) on the same held-out scenes — never comparing a fine-tuned model's in-domain score against the baseline's out-of-domain score without matching test sets. If fine-tuning is not completed in time, the PRD explicitly permits shipping the baseline-only pipeline; this must be stated plainly in the judge-facing Technical Inspector rather than hidden.

---

## 18. Depth Representation — Formal Definition

```
Input:  H × W × 3 uint8 RGB
Output: H × W float32 relative depth, "higher = closer to camera" convention (Section 16)
```
- **Normalization:** raw model logits/output passed through the model's own post-processing (per `transformers` pipeline) to produce a continuous float32 map; no additional ad hoc rescaling before calibration except the documented polarity check (Section 13).
- **Invalid pixels:** NaN/Inf clipped as in Section 16; no separate "invalid" mask is currently modeled for depth output (the model produces a dense prediction for every pixel by construction).
- **Outlier/clipping:** outlier removal happens at the *calibration sample* level (Section 13, z-score filtering), not by altering the depth raster itself — the full relative depth map is preserved for visualization even where individual calibration samples were excluded.
- **Resizing back to original dimensions:** mandatory, bilinear, performed immediately after inference (Section 16) so every downstream module operates in original-image pixel space.

---

## 19. 3D Mesh Pipeline — Concrete Specification

```
DSM/rDSM raster (H×W float32)
 → downsample raster to a fixed maximum grid (e.g., 512×512) via area-averaging if larger — this is the primary "decimation" strategy (simpler and more predictable for a hackathon than post-hoc mesh simplification)
 → generate vertex grid: (x, y) from pixel indices × pixel size (meters, from geotransform, or unit spacing for Mode A), z from elevation value × vertical_scale
 → triangulate as a regular grid mesh (two triangles per quad) via trimesh
 → generate UV coordinates directly from normalized pixel row/col (0–1 range), matching the *original* image aspect ratio
 → bake the original RGB image (resized to a fixed texture resolution, e.g., 2048×2048 max) as the mesh's diffuse texture
 → export as .glb (via trimesh's GLTF exporter)
```

**Specified limits:** max grid 512×512 (≈524k triangles at full density before any further reduction — acceptable for Three.js on mid-range hardware per Section 28 performance targets; team may reduce further to 256×256 if frame rate targets aren't met in testing); max texture size 2048×2048; nodata cells in the source raster are excluded from triangulation (produce a mesh hole) rather than rendered at a false elevation of zero.

**Vertical scale:** default `1.0` for Mode B (true meters); for Mode A (relative-only, no real units), a default exaggeration factor is applied and clearly labeled as such (e.g., "×3 exaggerated — relative units") since there is no real "1:1" scale to anchor to without calibration.

**Edge handling:** raster edges/borders are clamped (no wraparound), and any resulting degenerate triangles (zero-area, from nodata boundaries) are dropped before export.

**Spatial correspondence requirement:** the mesh's vertex grid spacing is derived directly from the DSM's geotransform pixel size (Mode B) so that on-mesh measurement tools (Section 22) report real meters, not arbitrary Three.js units.

---

## 20. Texture Alignment

- **Orthorectified/top-down imagery (primary supported case):** image pixel coordinates map directly and linearly to mesh UV coordinates — `(u, v) = (px / width, py / height)` — since a top-down image's pixel grid is already aligned with the DSM's pixel grid by construction (both derived from the same source raster).
- **GeoTIFF:** the image *is* the texture source and the DSM raster; UVs are generated from the same pixel grid used for the DSM, guaranteeing pixel-perfect alignment without any additional registration step.
- **Perspective aerial/drone photographs:** explicitly **not** a physically-accurate-projection case in this MVP — no camera intrinsics/extrinsics are estimated. The image is still applied as a texture using the same simple pixel-grid UV mapping, but the UI must show a visible disclaimer ("Approximate texture projection — perspective image, no camera calibration used") whenever the input is detected/declared as non-orthorectified. See Section 21.

---

## 21. Image Type Limitation — Explicit Statement

**"Single-view image" for this MVP means:** primarily **orthorectified, top-down remote-sensing imagery** (satellite crops, nadir drone orthomosaics). This is the only input class for which metric reconstruction and texture alignment are both fully supported and validated.

**Perspective aerial/drone photographs** are still accepted and will still produce a relative depth map and a mesh, but:
- metric calibration confidence is capped lower by design (no camera geometry to properly resolve scale/perspective distortion),
- texture projection is approximate only (Section 20),
- the UI surfaces both limitations automatically based on a simple heuristic (aspect/EXIF-tilt hints where present, otherwise a manual "this is a top-down/orthorectified image" toggle the user confirms at upload).

The product never claims equal accuracy across both input classes.

---

## 22. 3D Coordinate System

- **Geographic CRS (lat/long, degrees)** used only for input/display (map pin, search, DEM queries).
- **Projected CRS (meters)** used for all mesh generation, distance, slope, and area calculations — the image/DEM data is reprojected (via Rasterio/PyProj) into an appropriate local UTM zone (auto-selected from the footprint's centroid) before any mesh or measurement math, never treating raw degree deltas as meters.
- All CRS transforms go through PyProj/GDAL/Rasterio exclusively — no manual/naïve degree-to-meter approximations anywhere in the codebase.

---

## 23. Slope Calculation

```
DSM raster (meters, projected CRS, known pixel size in meters)
 → gradient via finite differences: dz/dx, dz/dy (numpy.gradient, scaled by pixel size)
 → slope_rad = arctan(sqrt((dz/dx)^2 + (dz/dy)^2))
 → slope_deg = degrees(slope_rad)
```
Output: a full slope raster (for the heatmap/inspection layer) plus summary stats (mean, max, and a simple histogram) exposed via `GET /projects/{id}/dsm` metadata. In the 3D view, point/region inspection reads the slope raster at the picked location — not a recomputed or approximated value — so the on-screen number and the underlying raster are always the same source of truth.

---

## 24. Validation Pipeline

```
Predicted DSM  +  Reference DSM/DEM
 → reproject both into a common CRS and resolution (Rasterio.warp, reference resampled to predicted DSM's grid via bilinear)
 → align bounds to the overlapping extent only
 → build a valid-pixel mask (exclude nodata in either raster)
 → compute per-pixel error = predicted − reference over valid mask
 → RMSE = sqrt(mean(error²))
 → MAE  = mean(|error|)
 → Bias = mean(error)
 → Correlation = Pearson r(predicted_valid, reference_valid)
 → Error heatmap = the error raster itself, colorized on the same shared elevation color ramp convention (Section 19 of prior UI system) reused for signed-error diverging colors
```

**Mandatory pre-steps before any metric is computed:** CRS alignment, resolution alignment, bounds alignment, nodata handling, resampling — skipping any of these produces meaningless numbers and is treated as a bug, not an acceptable shortcut, even under time pressure.

**API:** `GET /projects/{id}/validation` → `{ "rmse": number, "mae": number, "bias": number, "correlation": number, "n_valid_pixels": number, "reference_source": string, "reference_resolution_m": number, "heatmap_url": string }`.

---

## 25. Reference Data — Dataset Roles

| Dataset role | Purpose | Example source |
|---|---|---|
| **Development dataset** | Used while building/tuning the calibration and testing the pipeline | A small internally-curated set of GeoTIFF scenes with known DEM coverage |
| **Validation dataset** | Held-out scenes never used during development/tuning, used only to measure reported RMSE/MAE/correlation | A disjoint subset of the same source type, explicitly set aside before development begins |
| **Demo dataset** | Precomputed, cached, guaranteed to work live regardless of network conditions | 1–2 curated scenes with every pipeline artifact pre-generated and bundled (Section 32) |

**Rule:** validation-set scenes must never appear in the development/tuning set. If time forces a smaller dataset, still keep at minimum one truly held-out scene for the reported validation number — reporting a number computed on a scene the team already tuned against is scientifically indefensible and explicitly disallowed by Section 48/54.

---

## 26. Dataset Strategy

- **GAMUS** (or an equivalent open remote-sensing depth/DSM dataset) — used only for the optional fine-tuning/evaluation path (Section 17), not required for P0.
- **SRTM** — required, primary calibration DEM (Section 16 provider).
- **Copernicus DEM** — optional secondary/fallback calibration DEM.
- **A small reference DSM/DEM set with independently-sourced elevation** (e.g., a region where both SRTM and a higher-resolution reference are available) — used specifically for the Validation dataset role above.
- **Bundled demo scenes** — used specifically for the Demo Mode role above; never reused as the validation dataset.

---

## 27. Offline Demo Mode — Concrete Specification

Demo Mode bundles, per demo scene, a complete precomputed artifact set matching the exact schema real processing produces:
```
data/demo/{scene_id}/
  image.tif (or .jpg/.png)
  depth.npy + depth_preview.png
  dem_tile.tif
  calibration_params.json
  dsm.tif
  mesh.glb
  validation.json
  reference.tif
```
When Demo Mode is active (`DEMO_MODE=true`), `POST /projects/{id}/process` for a demo-flagged project serves these precomputed artifacts through the *same* API endpoints and state machine (Section 28) real processing uses — stage transitions are still shown in the UI, but each stage returns its cached artifact rather than recomputing, and the pipeline UI displays a persistent **"Demo / Precomputed"** badge (never silently presented as live inference — Section 46). A live, non-demo project always runs the real pipeline regardless of whether Demo Mode is toggled on globally, unless the user explicitly creates a project from a "Demo Scene" entry point.

---

## 28. Pipeline State Machine

```
UPLOADED → VALIDATING → PREPROCESSING → DEPTH_RUNNING → DEPTH_COMPLETE
  → LOCATION_PENDING (Mode A only, optional) → LOCATION_MATCHING (if location given)
  → DEM_FETCHING → CALIBRATING → DSM_GENERATING → MESH_GENERATING
  → VALIDATING_ACCURACY → COMPLETE
(any state) → FAILED
```

Each stage record:
```json
{
  "stage": "DEPTH_RUNNING",
  "status": "running" | "complete" | "failed" | "skipped",
  "start_time": "...",
  "end_time": "...",
  "duration_ms": 0,
  "confidence": 0.0,
  "error": null,
  "artifact_ref": "depth.npy"
}
```
Persisted server-side per project run (not just held in frontend state) so `GET /projects/{id}/status` is always the single source of truth and a page refresh mid-pipeline never desyncs the UI.

---

## 29. Artifact Storage

Per project, per pipeline run (`run_id` incremented on every reprocess — prior runs never overwritten):
```
data/{project_id}/{run_id}/
  original.(jpg|png|tif)
  metadata.json                 # dims, CRS, bands, upload info
  depth.npy + depth_preview.png
  location.json                 # lat/lon/source, or {"skipped": true}
  match.json                    # confidence, matched_bbox, candidate thumbnail ref (if attempted)
  dem_tile.tif                  # cached/reprojected DEM used for this run
  calibration_samples.json
  calibration_params.json
  dsm.tif  (Mode B)  /  rdsm.tif (Mode A)
  validation.json + error_heatmap.png (if a reference was available)
  mesh.glb
  texture.png
  processing_log.jsonl
```
Project metadata (id, name, created_at, current status, latest run_id) lives in the relational store (Section 21/35); large binary artifacts live on disk/object storage, referenced by path.

---

## 30. API Contracts

| Endpoint | Method | Request | Success Response | Error Response |
|---|---|---|---|---|
| `/projects` | POST | multipart file upload | `201 { project_id, metadata }` | `400 { error, detail }` unsupported/corrupt file |
| `/projects/{id}/location` | POST | `{ lat, lon, source }` or `{ skipped: true }` | `200 { location_id }` | `422` invalid coords |
| `/projects/{id}/match` | POST | — | `200 { confidence, matched_bbox, candidate_thumbnail_url }` | `200 { confidence: 0, no_confident_match: true }` (never a hard error — Section 11) |
| `/projects/{id}/match/confirm` | POST | `{ confirmed: bool }` | `200 { accepted: bool }` | — |
| `/projects/{id}/process` | POST | `{ resume_from_stage?: string }` | `202 { run_id, status: "started" }` | `409` already running |
| `/projects/{id}/status` | GET | — | `200 { stages: [...], overall_status }` | `404` |
| `/projects/{id}/depth` | GET | — | `200` PNG preview + `.npy` download link | `404` if stage incomplete |
| `/projects/{id}/dsm` | GET | — | `200` GeoTIFF/raster + stats JSON | `404` |
| `/projects/{id}/mesh` | GET | — | `200` `.glb` binary | `404` |
| `/projects/{id}/validation` | GET | — | `200 { rmse, mae, bias, correlation, heatmap_url }` | `404` if no reference available |
| `/projects` | GET | query: page, limit | `200 { projects: [...] }` | — |
| `/projects/{id}` | DELETE | — | `204` | `404` |

Authentication: none required for the hackathon build (single-session/local use assumed); the contract is written so an auth middleware can be inserted later without changing endpoint shapes. All error responses share the shape `{ "error": string, "detail": string, "stage": string | null }` so the frontend can always attribute a failure to a specific pipeline stage rather than showing a generic message (Section 38).

---

## 31. Frontend Architecture

**State management:** React Query (TanStack Query) for all server state (project data, pipeline status polling, DSM/mesh/validation fetches) — avoids hand-rolled caching/loading-state logic; local UI-only state (active camera mode, selected measurement tool, panel open/closed) in component-local `useState`/a small Zustand store if state needs to be shared across distant components (e.g., current project ID across the workspace shell). This is intentionally lightweight — no Redux — to match hackathon scope.

**Tracked state surfaces:** current project, upload progress, pipeline stage status (polled via `GET /status` every 1–2s while any stage is `running`, or via SSE if implemented — Section 27 of prior PRD), errors (attributed per-stage per Section 30), loaded DSM raster + stats, loaded 3D asset, validation metrics, map/location selection.

---

## 32. Backend Architecture — File Handling

**Supported:** JPG, JPEG, PNG, TIFF, GeoTIFF.

**Validation on upload:**
- MIME type check (`python-magic`, not just file extension).
- Magic-byte signature check.
- Dimension bounds check (reject 0×0 or absurd aspect ratios).
- File size ceiling (configurable, default 50MB for MVP).
- Corruption check: attempt a real decode (`PIL.Image.open().verify()` / `rasterio.open()`) before accepting.
- Band count check for TIFF/GeoTIFF.
- CRS/transform presence check (determines Mode A vs Mode B routing).

**Explicit handling:**
| Input case | MVP behavior |
|---|---|
| Grayscale image | Converted to 3-channel RGB (channel duplication) before model input |
| RGBA image | Alpha channel dropped, RGB retained |
| Multispectral TIFF (>4 bands) | **Rejected for MVP** with a clear message ("Multispectral imagery is not supported — please provide an RGB or RGBA image/GeoTIFF"); not silently truncated to the first 3 bands, to avoid producing a misleading result |
| Huge TIFF (exceeds processing-resolution ceiling) | Routed through the large-image tiling strategy (Section 33), never rejected outright if otherwise valid |
| Corrupted TIFF | Rejected at upload with the specific decode error surfaced |

---

## 33. Large Image Strategy

```
Large image (exceeds MAX_PROCESSING_DIM, e.g., 2048px on the long edge)
 → tile into overlapping windows (e.g., 1024×1024 with 64px overlap) via Rasterio windowed reads
 → run DepthEstimator.predict() per tile
 → stitch relative depth tiles back together with linear-blend feathering in the overlap regions
 → proceed with the stitched full-resolution relative depth map into calibration/DSM as normal
```
**Maximum supported MVP resolution:** defined explicitly as a configurable ceiling (default 4096×4096 input, downsampled further if it would exceed available memory) — beyond that, the system automatically downsamples to a "processing resolution" and the UI states plainly: **"Processed at reduced resolution (X×Y) for performance — full-resolution DSM export not available for this image size in the MVP."** This is a stated, visible limitation, never a silent quality loss.

---

## 34. Hardware Requirements

**Development:** NVIDIA GPU recommended (any CUDA-capable card with ≥4GB VRAM comfortably runs the Small/Base Depth Anything V2 checkpoints); CPU-only development fully supported, just slower.

**Production/demo minimums:** 8GB system RAM minimum (16GB recommended for comfortable GeoTIFF + mesh generation headroom), GPU optional but recommended for live-demo responsiveness; CPU-only fallback must still complete the full pipeline within a presentable time window for the bundled demo scene sizes (validated during rehearsal — Section 40).

**CUDA detection:** `torch.cuda.is_available()` checked once at service startup and cached; if unavailable, the system runs in CPU mode automatically, surfaces `device: "cpu"` in the Technical Inspector, and never crashes or blocks on a missing GPU.

---

## 35. Dependency Management

- **Python:** 3.11
- **Node:** 20 LTS
- **Package managers:** `pip` (backend, with a pinned `requirements.txt`) / `pnpm` (frontend)
- **Model weights:** downloaded on first run via `transformers` to `MODEL_PATH` (default `~/.cache/depthwizard/models`), committed to `.gitignore`, not checked into the repo
- **GDAL:** installed via system package (`apt install gdal-bin libgdal-dev`) or a conda environment (`conda install -c conda-forge gdal`) — GDAL's native dependency is the single most common local-setup failure point for this stack and must be documented explicitly in the README with both install paths
- **Environment variables:** see Section 36
- **API keys:** all optional (Section 36) — the system installs and runs completely with zero keys configured

**Project setup (expected sequence):**
```
git clone <repo>
cd depthwizard
# backend
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
python backend/scripts/download_models.py   # caches Depth Anything V2 weights locally
# frontend
cd frontend && pnpm install
# run
docker compose up   # or: backend `uvicorn` + frontend `pnpm dev` separately
```

---

## 36. Environment Variables

```
# Required for full functionality, but all have safe defaults/fallbacks — nothing here blocks a zero-config run
DEM_API_KEY=            # optional — Copernicus DEM via OpenTopography; falls back to local SRTM if unset
IMAGERY_TILE_SOURCE=    # optional — defaults to keyless ESRI World Imagery XYZ endpoint
MODEL_PATH=~/.cache/depthwizard/models
STORAGE_PATH=./data
DATABASE_URL=sqlite:///./data/depthwizard.db
DEMO_MODE=false
MAX_UPLOAD_MB=50
MAX_PROCESSING_DIM=4096
CORS_ORIGINS=http://localhost:5173
```
No secret is ever hard-coded in source; all configuration flows through this single `.env` file, loaded via `pydantic-settings` on the backend.

---

## 37. Security

- MIME/magic-byte validation and forced re-encode of raster inputs before processing (Section 32).
- Path traversal protection: all storage paths built from validated internal IDs (UUIDs), never from user-supplied filenames directly.
- Upload size limits enforced at both the reverse-proxy/ASGI layer and application layer.
- Per-IP/session rate limiting on `POST /projects` and `POST /projects/{id}/process` to prevent abuse during public demo access.
- Temporary/staging files (e.g., intermediate tiles during large-image processing) cleaned up on a TTL job.
- API keys (Section 36), when configured, read only from environment/`.env`, never logged or returned in any API response.
- CORS explicitly configured to the known frontend origin(s) only, not `*`.
- Project isolation: no endpoint allows cross-project artifact access by guessing/incrementing IDs (UUIDs, not sequential integers).

---

## 38. Error Handling

Every external dependency (DEM provider, imagery provider, depth model load) is wrapped with: **timeout → limited retry → fallback (per the chains defined in Sections 11/12) → a specific user-facing message naming the failed stage → a full developer-facing log entry.** The generic "Something went wrong" string is disallowed anywhere in the product; every error surfaced to the user includes which pipeline stage failed and, where relevant, what fallback was applied instead (e.g., "DEM retrieval from Copernicus failed — used cached SRTM tile instead").

---

## 39. Testing Requirements

**Unit tests:** CRS conversion/reprojection correctness, DEM sampling alignment, calibration fit (against a synthetic known-affine dataset to confirm `a, b` recovery), RMSE/MAE/correlation computation, slope calculation, raster I/O (nodata handling, band handling).

**Integration tests:** `upload → depth → calibration → DSM` executed end-to-end against a small fixture GeoTIFF with a known, hand-checked expected elevation range.

**End-to-end test:** the bundled demo scene run through the full API surface (upload → process → status polling to COMPLETE → mesh fetch → validation fetch), asserting the pipeline reaches `COMPLETE` and every artifact endpoint returns `200`.

**Visual/manual test checklist:** texture alignment (spot-check a known landmark/edge in the source image against the same feature in the rendered mesh), mesh orientation (elevation increases where it visually should), elevation color-ramp direction sanity check, camera navigation responsiveness across all four camera modes.

---

## 40. MVP Feature Priority (P0/P1/P2)

**P0 — must work, non-negotiable:** image upload (both formats), Mode A relative pipeline, Mode B metric pipeline, DEM retrieval (SRTM required path), DEM-affine calibration, DSM/rDSM generation + stats, DSM viewer, mesh generation, RGB texture, 3D navigation (at least orbit + first-person), height measurement, validation metrics (RMSE/MAE/correlation) against at least one bundled reference, full error handling per Section 38, working offline Demo Mode.

**P1 — important, build if P0 is solid:** location map/coordinate input UI, Copernicus DEM fallback provider, slope analysis, distance measurement, project history persistence, image matching (Section 11).

**P2 — nice to have, cut first under time pressure:** semantic priors for building detection, any attempt at automatic global geolocation beyond the bounded matcher, GCP editor UI, multi-image support, change detection, user accounts, collaboration features.

**Cutting order under time pressure: P2 entirely → then P1 items in reverse build order → P0 is never cut.**

---

## 41. Judge Experience — 30-Second Understanding

Landing page states, above the fold, in this exact framing:

> **One image → AI depth → calibrated elevation → 3D world.**

Then the live demo proceeds strictly in the order **AI → Calibration → DSM → 3D → Validation** — never opening on settings, API configuration, or infrastructure. The Technical Inspector exists precisely so a technical judge can go deeper without the main flow ever slowing down to explain itself.

---

## 42. UI Requirements

Design system unchanged from the prior PRD in spirit — Watermelon UI components, Anime.js for state-communicating micro-interactions, dark restrained scientific palette, minimal neon, technical typography (Section 19/20 of the prior PRD apply as-is). The one addition this revision enforces: **no technical information may be hidden more than one click deep.** Depth result, calibration method used, DEM source, DSM, accuracy metrics, confidence label, and 3D result must each be reachable directly from the main results/flythrough screens, not buried in a settings page.

---

## 43. Technical Inspector

A collapsible panel, present on the DSM Results and 3D Flythrough screens, showing exactly:
```
Model: Depth Anything V2 (Small/Base) — device: cuda|cpu
Input resolution: WxH (processing resolution, if downsampled)
Inference time: Xms
DEM source: SRTM 30m | Copernicus DEM 30m | none (scene-statistics fallback)
DEM resolution: Xm
CRS: EPSG:XXXX
Calibration method: dem_affine | gcp | scene_statistics
Calibration residual (RMSE at sample points): X m
Valid calibration samples used: N
Validation RMSE / MAE / Correlation: (if a reference is available)
Total processing time: Xs
```
Every one of these values is read directly from the stored artifacts of Sections 29/30 — never separately estimated or re-derived for display purposes, so the Inspector and the underlying data can never drift out of sync.

---

## 44. Do Not Fabricate Metrics

Absolute rule: any value not actually computed for the current session must never render as if it were. Precomputed/Demo Mode values are always labeled **"Demo / Precomputed"** in the same visual location every real-computed value would use; live-computed values are labeled **"Computed from current reconstruction."** No numeric field anywhere in the product is permitted to exist without one of these two labels attached, including in the landing page's illustrative accuracy section (explicitly marked as illustrative/typical there, not live).

---

## 45. Confidence System

Confidence is never an arbitrary invented percentage. It is derived from measurable inputs:

- **Depth quality proxy:** inference completed without clipping/NaN correction triggered.
- **Calibration sample count:** number of valid correspondence points used (Section 13/14).
- **Calibration residual:** the fitted RMSE at sample points — lower residual, higher confidence.
- **DEM resolution:** coarser DEM (90m) caps confidence lower than finer DEM (30m).
- **Location match score:** ORB inlier ratio (Section 11), when location-assisted.
- **Reference-data coverage:** whether a validation reference was actually available for this scene.

If a fully scientifically defensible numeric confidence score cannot be implemented in time, the MVP is explicitly permitted to fall back to **categorical labels — High / Medium / Low —** derived from simple thresholds on the same measurable inputs above, each with a one-line explanation of why that label was assigned (e.g., "Medium — DEM-calibrated with 214 valid samples, but only SRTM 30m coverage available"). A fabricated single float confidence with no derivation is never acceptable.

---

## 46. Accuracy Targets

No arbitrary SIH accuracy target is invented in this PRD. Instead: the team establishes **baseline RMSE/MAE on the held-out validation set (Section 25)** during development and reports the **measured** performance achieved, alongside the baseline-vs-adapted comparison if fine-tuning (Section 17) is attempted. All accuracy claims presented to judges are these measured numbers, sourced from Section 24's validation pipeline, never a target or aspiration stated as if it were an achieved result.

---

## 47. Deployment

**Local:** `docker compose up` runs frontend + backend + model (weights pre-downloaded via `download_models.py`) + local SQLite + local file storage — the single recommended path for both development and the actual hackathon demo machine.

**Demo server (if a shared/cloud instance is used):** same containers, GPU-enabled instance recommended for responsiveness; identical environment variable configuration (Section 36).

**Offline Demo:** `DEMO_MODE=true` with the bundled `data/demo/` artifact set (Section 27) — requires no network access at all once the container image/model weights are already present locally, which must be verified and rehearsed at least once on the actual presentation machine before judging.

**Startup checks (must run automatically on boot and surface status in a `/health` endpoint):** model loading check (weights present and loadable), storage path writable check, database connectivity check, DEM provider reachability check (non-blocking — logged as degraded, not fatal, since SRTM/local cache fallback exists).

---

## 48. Project Structure

```
depthwizard/
├── frontend/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── stores/
│   ├── services/        # API client layer
│   └── three/            # mesh loading, camera controllers, measurement tools
├── backend/
│   ├── api/               # FastAPI route modules, one per resource
│   ├── models/            # Pydantic/SQLModel schemas
│   ├── services/
│   │   ├── depth/         # DepthEstimator implementations
│   │   ├── calibration/   # CalibrationEngine (affine fit, polarity check, sampling)
│   │   ├── dem/            # DEMProvider implementations + fallback chain
│   │   ├── imagery/        # ImageryProvider + ORB matcher
│   │   ├── validation/     # metrics computation
│   │   └── mesh/           # DSM→mesh, texture projection
│   ├── geospatial/         # CRS/reprojection helpers (Rasterio/PyProj wrappers)
│   ├── jobs/                # async pipeline orchestration, state machine
│   └── storage/             # artifact read/write, path management
├── data/
│   ├── demo/
│   └── cache/               # DEM/imagery tile cache
├── models/                  # local cached model weights (gitignored)
├── tests/
└── docker/
```

---

## 49. Development Order (Mandatory Sequence)

**Phase 1:** Depth model running end-to-end on one sample image (Section 16). **Phase 2:** DEM retrieval working (SRTM, cached) (Section 12). **Phase 3:** Relative→metric calibration implemented and unit-tested against a synthetic known-affine case (Section 13). **Phase 4:** Real DSM artifact generated and inspectable. **Phase 5:** Real 3D mesh generated from that DSM (Section 19). **Phase 6:** Texture correctly draped (Section 20). **Phase 7:** Validation pipeline computing real RMSE/MAE/correlation against a held-out reference (Section 24). **Phase 8:** Frontend built around this now-proven backend, not before. **Phase 9:** Location-assisted workflow added (Section 10). **Phase 10:** Image matching added (Section 11). **Phase 11:** Watermelon UI + Anime.js polish pass.

The team proves the hard technical pipeline (Phases 1–7) before investing meaningful time in UI (Phases 8–11) — this order is mandatory, not a suggestion.

---

## 50. Acceptance Criteria (Measurable)

- Given a valid GeoTIFF with embedded CRS and a footprint covered by SRTM, the system produces a calibrated DSM GeoTIFF with float32 elevation values in meters, with a calibration residual RMSE value present in `calibration_params.json`.
- Given a JPG/PNG with no location provided, the system produces an rDSM and a navigable 3D mesh, with the UI displaying the "Relative Only" badge and no meter-unit elevation values anywhere on screen.
- Given a JPG/PNG with a user-confirmed location match (ORB inlier ratio above threshold), the system proceeds through DEM retrieval and produces a metric DSM using the confirmed footprint.
- Given a reference DSM/DEM for the same footprint, `GET /projects/{id}/validation` returns RMSE, MAE, correlation, and a heatmap image computed strictly per the alignment procedure in Section 24 — verified by a unit test using a synthetic reference with a known injected error pattern.
- The 3D flythrough loads the `.glb` mesh with the correct texture applied, supports orbit and first-person camera modes, and reports a height measurement between two user-picked points accurate (on the synthetic test case) to within the mesh's own vertex resolution.
- `POST /projects/{id}/process` completes successfully with `location: null` and with the DEM provider forcibly disabled (integration test), producing a relative-only result rather than failing.
- `DEMO_MODE=true` completes the full pipeline for the bundled demo scene with zero outbound network calls (verified by running with network access blocked in a test container).
- No UI element displays a numeric elevation, confidence, or accuracy value without either a "Demo / Precomputed" or "Computed from current reconstruction" label attached.

---

## 51. Definition of Done

DepthWizard MVP is complete only when:

```
A real image
     ↓
is processed by a real depth model
     ↓
produces a real depth map
     ↓
is calibrated using real/reference geographic data when available
     ↓
produces a real rDSM/DSM artifact
     ↓
is visualized as a correctly aligned 3D mesh
     ↓
can be navigated interactively
     ↓
supports at least basic measurement
     ↓
can be quantitatively validated
     ↓
and the entire flow works reliably in Demo Mode.
```

---

## 52. SIH Milestone Mapping

| Milestone | Weight | Concrete deliverable |
|---|---|---|
| Elevation Extraction | Part of 50% accuracy | Depth Anything V2 inference → relative depth map → rDSM (Section 16/18) |
| Scale Calibration | Part of 50% accuracy | DEM-affine calibration engine with explicit correspondence sampling, polarity correction, and residual reporting (Section 13/14) |
| Visualization Layer | 50% rendering & UX | Mesh generation, texture projection, 3D flythrough, measurement tools (Section 19–22) |
| (Supporting) Location workflow | Strengthens calibration score | Optional, non-blocking, confirmed by the user (Section 10/11) |
| (Supporting) Validation | Strengthens accuracy credibility | Real RMSE/MAE/correlation against a genuinely held-out reference (Section 24/25) |

---

## 53. Evaluation Strategy

Baseline-first: establish Depth Anything V2's out-of-the-box RMSE/MAE/correlation on the held-out validation set before attempting any improvement. If fine-tuning (Section 17) is attempted, report both numbers side-by-side on the identical held-out scenes, never mixing test sets between the two. All reported numbers trace back to Section 24's alignment-then-metrics procedure with no shortcuts.

---

## 54. Technical Risks

1. **Global affine calibration against a coarse (30–90m) DEM cannot resolve building-scale height variation** — it constrains terrain-scale elevation reasonably but building-height estimates will carry meaningfully higher error; the UI/Inspector must never present one blended accuracy number covering both scales.
2. **Depth polarity/sign errors are easy to get backwards silently** — the explicit correlation-based polarity check (Section 13) exists specifically because a flipped sign would still "fit" numerically in a way that looks plausible until visually inspected in 3D.
3. **Texture/mesh misalignment reads as obviously wrong to a viewer even when the underlying numbers are fine** — disproportionate demo-credibility risk relative to its technical severity; budget real testing time on Section 20's alignment, not just the calibration math.
4. **ORB-based image matching is not robust across seasonal/lighting/resolution mismatches between the uploaded photo and satellite tiles** — the confidence threshold and the sanctioned fallback (manual pin only) exist specifically because this is expected to underperform on some real inputs.
5. **GDAL/Rasterio environment setup is a common source of last-minute local failures** — document both the system-package and conda install paths (Section 35) and rehearse a clean install on the actual presentation machine well before the demo, not the night before.

---

## 55. Hackathon Survival Strategy

- Follow the Development Order (Section 49) exactly — do not start on UI polish until Phases 1–7 produce a real, inspectable DSM and mesh from a real image.
- Lock in the Demo Mode dataset and rehearse the exact demo flow (Section 41) against it early, independent of whether live processing is fully polished — the live demo must never be the first time the full flow has run start-to-finish.
- If time forces cuts, cut in the exact order specified in Section 40 (P2 → P1 → never P0).
- Never let a missing/failed external API key become a blocking issue during judging — every external dependency in this PRD has a keyless or cached fallback specifically so this cannot happen (Sections 11/12/27/36).
- Keep the Technical Inspector (Section 43) building in parallel with the pipeline itself, not bolted on at the end — it is cheap to build once the underlying artifacts already exist, and it's the single feature most likely to matter to a technical ISRO judge specifically.

---

## One-Sentence Product Definition

**DepthWizard turns a single optical image into a calibrated, measurable, explorable 3D elevation model by combining monocular AI depth estimation (Depth Anything V2) with a DEM-affine scale calibration step and a real, validated accuracy comparison, rendered as a navigable textured 3D mesh.**

## 30-Second Judge Explanation

"You give us one image — a satellite crop or drone photo. Our AI model estimates relative depth from it. If we know roughly where it was taken, we pull open elevation data for that spot and use it to convert that relative depth into real elevation, in meters — and we show you exactly how good that conversion is, with real RMSE and MAE numbers against reference data, not just a nice-looking 3D model. Then you can fly through the result and measure it yourself."

## Top 5 Technical Risks

1. Coarse-DEM calibration cannot resolve building-scale height accurately (Section 54.1).
2. Depth polarity/sign handling errors are silent unless explicitly checked (Section 54.2).
3. Texture/mesh alignment errors are disproportionately visible/damaging in a live demo (Section 54.3).
4. ORB-based image matching is unreliable across real-world imagery mismatches (Section 54.4).
5. GDAL/geospatial environment setup is a common last-minute failure point (Section 54.5).

## What We Must Have Working (P0)

Upload (both modes) → real depth inference → real DEM-affine calibration with residual reporting → real DSM/rDSM → real textured mesh → 3D navigation with height measurement → real validation metrics against a held-out reference → full error handling → a genuinely network-independent Demo Mode.

## What We Can Sacrifice (P2, cut first)

Automatic global image geolocation beyond the bounded ORB matcher, semantic building segmentation, GCP editor UI, multi-image support, change detection, user accounts, collaboration features — none of these are required to prove the core SIH claim.
