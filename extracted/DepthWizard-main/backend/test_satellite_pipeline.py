import time
import numpy as np
from PIL import Image
from app.preprocessing import preprocess_image
from app.inference import DepthEstimator

print("Testing Satellite Overhead Height Pipeline on bhopal.jpg...")
img_path = r"d:\projects\DepthWizard\UI\public\demo\bhopal.jpg"
image = Image.open(img_path).convert("RGB")
print(f"Loaded original image: {image.size}")

# Preprocess image (neutralize map labels & resize)
t0 = time.time()
cleaned_img = preprocess_image(image)
print(f"Preprocessing & text label removal completed in {time.time()-t0:.2f}s")

# Load model & estimate satellite height
estimator = DepthEstimator()
t1 = time.time()
height_map, width, height = estimator.predict(cleaned_img)
t2 = time.time()

print(f"Satellite Height Estimation completed in {t2-t1:.2f}s")
print(f"Output height map shape: ({height}, {width}), dtype: {height_map.dtype}")
print(f"Min height: {height_map.min():.4f}, Max height: {height_map.max():.4f}, Mean height: {height_map.mean():.4f}")

# Save visualization PNG
vis = (height_map * 255).astype(np.uint8)
vis_img = Image.fromarray(vis, mode="L")
vis_img.save(r"d:\projects\DepthWizard\backend\bhopal_satellite_height.png")
print("Saved satellite height visualization: d:\\projects\\DepthWizard\\backend\\bhopal_satellite_height.png")
