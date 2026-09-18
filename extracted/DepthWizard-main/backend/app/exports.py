"""
Export utilities for depth data.
"""

import io
import base64
import numpy as np


def depth_to_npy_base64(depth_array: np.ndarray) -> str:
    """Convert a depth array to base64-encoded NPY format."""
    buf = io.BytesIO()
    np.save(buf, depth_array.astype(np.float32))
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def depth_to_ply_base64(depth_array: np.ndarray, rgb_image=None) -> str:
    """
    Convert a depth array to a PLY point cloud (base64-encoded).
    Each pixel becomes a 3D point.
    """
    h, w = depth_array.shape

    # Normalize depth to 0-1
    d_min, d_max = depth_array.min(), depth_array.max()
    d_range = d_max - d_min
    if d_range > 0:
        normalized = (depth_array - d_min) / d_range
    else:
        normalized = np.zeros_like(depth_array)

    # Generate point cloud
    points = []
    for y in range(0, h, 2):  # Skip every other pixel for size
        for x in range(0, w, 2):
            px = (x / (w - 1) - 0.5) * 10.0
            py = (0.5 - y / (h - 1)) * 10.0
            pz = normalized[y, x] * 2.0

            if rgb_image is not None:
                r, g, b = rgb_image[y, x, :3]
            else:
                v = int(normalized[y, x] * 255)
                r, g, b = v, v, v

            points.append(f"{px:.4f} {py:.4f} {pz:.4f} {r} {g} {b}")

    header = f"""ply
format ascii 1.0
element vertex {len(points)}
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
"""
    ply_content = header + "\n".join(points) + "\n"
    return base64.b64encode(ply_content.encode("utf-8")).decode("utf-8")
