import cv2
import numpy as np
from PIL import Image
from app.preprocessing import preprocess_image
from app.inference import DepthEstimator

img_path = r"d:\projects\DepthWizard\UI\public\demo\bhopal.jpg"
image = Image.open(img_path).convert("RGB")
cleaned_img = preprocess_image(image)

h, w = 518, 518
img_np = np.array(cleaned_img.resize((w, h), Image.LANCZOS).convert("RGB"))
gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
hsv = cv2.cvtColor(img_np, cv2.COLOR_RGB2HSV)

r, g, b = img_np[:, :, 0].astype(np.float32), img_np[:, :, 1].astype(np.float32), img_np[:, :, 2].astype(np.float32)
exg = 2.0 * g - r - b
hue, sat, val = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

# In OpenCV HSV: Red is around 0-10 or 170-180, Green is around 35-85!
is_green_hue = (hue >= 30) & (hue <= 90) & (sat > 25)
is_green_exg = (exg > 5)

veg_mask = (is_green_hue | is_green_exg).astype(np.uint8)

print(f"Total pixels: {h*w}, Green pixels: {np.sum(veg_mask > 0)}")

Image.fromarray((veg_mask * 255).astype(np.uint8)).save(r"d:\projects\DepthWizard\backend\debug_veg_mask.png")
print("Saved debug_veg_mask.png")
