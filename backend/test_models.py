import os
import time
import torch
import numpy as np
from PIL import Image
from transformers import pipeline

img_path = r"d:\projects\DepthWizard\UI\public\demo\bhopal.jpg"
image = Image.open(img_path).convert("RGB")
w, h = image.size
print(f"Loaded {img_path} ({w}x{h})")

# Test 1: Baseline Depth Anything V2
try:
    print("\n--- 1. Testing Baseline Depth Anything V2 ---")
    pipe_base = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device="cpu")
    t0 = time.time()
    res_base = pipe_base(image)
    t1 = time.time()
    depth_base = res_base["predicted_depth"].squeeze().cpu().numpy()
    print(f"Baseline done in {t1-t0:.2f}s, min={depth_base.min():.2f}, max={depth_base.max():.2f}")
    
    # Save baseline image
    d_norm = (depth_base - depth_base.min()) / (depth_base.max() - depth_base.min() + 1e-6)
    Image.fromarray((d_norm * 255).astype(np.uint8)).save(r"d:\projects\DepthWizard\backend\depth_baseline.png")
except Exception as e:
    print("Baseline error:", e)

# Test 2: Aerial/Remote Sensing depth models on HuggingFace
models_to_test = [
    "nathan-l/OccuFly-DepthAnythingV2-Small",
    "nathan-l/OccuFly-Small",
    "LiheYoung/depth-anything-small-hf",
]

for m in models_to_test:
    try:
        print(f"\n--- Testing HuggingFace Model: {m} ---")
        pipe_aerial = pipeline("depth-estimation", model=m, device="cpu")
        t0 = time.time()
        res_aerial = pipe_aerial(image)
        t1 = time.time()
        depth_aerial = res_aerial["predicted_depth"].squeeze().cpu().numpy()
        print(f"Model {m} done in {t1-t0:.2f}s, min={depth_aerial.min():.2f}, max={depth_aerial.max():.2f}")
        
        name_clean = m.replace("/", "_")
        d_norm = (depth_aerial - depth_aerial.min()) / (depth_aerial.max() - depth_aerial.min() + 1e-6)
        Image.fromarray((d_norm * 255).astype(np.uint8)).save(fr"d:\projects\DepthWizard\backend\depth_{name_clean}.png")
    except Exception as e:
        print(f"Model {m} not available or failed: {e}")
