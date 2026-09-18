import cv2
import numpy as np
from PIL import Image
from app.preprocessing import preprocess_image
from app.inference import DepthEstimator

img_path = r"d:\projects\DepthWizard\UI\public\demo\bhopal.jpg"
image = Image.open(img_path).convert("RGB")
cleaned_img = preprocess_image(image)

estimator = DepthEstimator()

# Predict raw depth
result = estimator.pipe(cleaned_img)
depth_tensor = result["predicted_depth"]
raw_depth = depth_tensor.squeeze().cpu().numpy().astype(np.float32)

# Normalize raw depth 0-255
raw_norm = (raw_depth - raw_depth.min()) / (raw_depth.max() - raw_depth.min())
raw_u8 = (raw_norm * 255).astype(np.uint8)

Image.fromarray(raw_u8).save(r"d:\projects\DepthWizard\backend\debug_raw_depth.png")
print("Saved debug_raw_depth.png!")
