"""
Image preprocessing for depth inference.
"""

import numpy as np
import cv2
from PIL import Image


def remove_map_annotations(image: Image.Image) -> Image.Image:
    """
    Detects and neutralizes map text/labels (e.g. 'Upper Lake', 'Lower Lake', highway icons)
    so map text is not interpreted as physical 3D objects by the height estimator.
    The original RGB image remains untouched for 3D texture projection.
    """
    img_np = np.array(image.convert("RGB"))
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)

    # Detect high-contrast text features (sharp edge clusters)
    kernel_small = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    gradient = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, kernel_small)
    
    # Threshold sharp text edges
    _, text_mask = cv2.threshold(gradient, 65, 255, cv2.THRESH_BINARY)
    
    # Filter text mask using morphological dilation
    kernel_text = cv2.getStructuringElement(cv2.MORPH_RECT, (4, 4))
    text_mask_dilated = cv2.dilate(text_mask, kernel_text, iterations=1)

    # Inpaint text regions using Telea inpainting algorithm
    inpainted = cv2.inpaint(img_np, text_mask_dilated, inpaintRadius=3, flags=cv2.INPAINT_TELEA)

    return Image.fromarray(inpainted)


def preprocess_image(image: Image.Image, max_size: int = 518) -> Image.Image:
    """
    Prepare an image for satellite depth inference:
    - Neutralizes map text & annotations
    - Ensures RGB mode
    - Resizes preserving aspect ratio
    """
    if image.mode != "RGB":
        image = image.convert("RGB")

    # First neutralize map labels / text annotations
    cleaned_image = remove_map_annotations(image)

    w, h = cleaned_image.size
    if max(w, h) > max_size:
        if w > h:
            new_w = max_size
            new_h = int(h * max_size / w)
        else:
            new_h = max_size
            new_w = int(w * max_size / h)
        cleaned_image = cleaned_image.resize((new_w, new_h), Image.LANCZOS)

    return cleaned_image
