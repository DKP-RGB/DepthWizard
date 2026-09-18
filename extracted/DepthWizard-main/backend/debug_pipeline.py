import cv2
import numpy as np
from PIL import Image
from app.preprocessing import preprocess_image
from app.inference import DepthEstimator

img_path = r"d:\projects\DepthWizard\UI\public\demo\bhopal.jpg"
image = Image.open(img_path).convert("RGB")
cleaned_img = preprocess_image(image)

estimator = DepthEstimator()
raw_depth, width, height = estimator.predict(cleaned_img)

img_np = np.array(cleaned_img.resize((width, height), Image.LANCZOS).convert("RGB"))
hsv = cv2.cvtColor(img_np, cv2.COLOR_RGB2HSV)
r, g, b = img_np[:, :, 0].astype(np.float32), img_np[:, :, 1].astype(np.float32), img_np[:, :, 2].astype(np.float32)

exg = 2.0 * g - r - b
hue, sat, val = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

print(f"ExG min: {exg.min():.1f}, max: {exg.max():.1f}, mean: {exg.mean():.1f}")
print(f"Hue min: {hue.min()}, max: {hue.max()}, mean: {hue.mean():.1f}")
print(f"Sat min: {sat.min()}, max: {sat.max()}, mean: {sat.mean():.1f}")

# Save ExG visualization
exg_vis = np.clip((exg - exg.min()) / (exg.max() - exg.min()) * 255, 0, 255).astype(np.uint8)
Image.fromarray(exg_vis).save(r"d:\projects\DepthWizard\backend\debug_exg.png")

# Save Green Hue visualization
veg1 = ((hue >= 25) & (hue <= 95) & (sat > 20)).astype(np.uint8) * 255
Image.fromarray(veg1).save(r"d:\projects\DepthWizard\backend\debug_veg.png")

print("Saved debug images debug_exg.png and debug_veg.png")
