import cv2
import numpy as np

# --- Calibration ---
PIXELS_PER_MM = 9.44
MORPH_KERNEL = np.ones((3, 3), np.uint8)
MIN_CONTOUR_AREA = 25

# --- Length -> Weight regression (g = a * length_mm ** b) ---
WEIGHT_A = 0.00007079
WEIGHT_B = 2.92

def estimate_weight_from_length(length_mm):
    return WEIGHT_A * (length_mm ** WEIGHT_B)

# --- Named sets of HSV ranges. Each set is a list of (lower, upper) tuples;
#     all ranges in a set are OR-combined into one mask before detection. ---
COLOR_SETS = {
    'green_marks': [
        (np.array([30, 20, 20]), np.array([90, 255, 255])),
    ],
    'dark_black_brown': [
        (np.array([0, 0, 0]), np.array([180, 255, 30])),      # dark black
        (np.array([10, 100, 20]), np.array([20, 255, 200])),  # brown
    ],
    'light_brown': [
        (np.array([10, 50, 50]), np.array([30, 255, 255])),
    ],
    'brown_orange_combo': [
        (np.array([0, 100, 20]), np.array([20, 255, 100])),   # dark brown
        (np.array([10, 50, 50]), np.array([30, 255, 255])),   # light brown
        (np.array([0, 100, 100]), np.array([15, 255, 255])),  # orange
    ],
    'black_orange_combo': [
        (np.array([0, 0, 0]), np.array([180, 255, 60])),      # light black
        (np.array([0, 0, 0]), np.array([180, 255, 30])),      # dark black
        (np.array([0, 50, 150]), np.array([20, 255, 255])),   # light orange
        (np.array([0, 100, 100]), np.array([15, 255, 255])),  # dark orange
    ],
    'all_brown_black_orange': [
        (np.array([10, 50, 50]), np.array([30, 255, 255])),   # light brown
        (np.array([0, 100, 20]), np.array([20, 255, 100])),   # dark brown
        (np.array([0, 0, 0]), np.array([180, 255, 60])),      # light black
        (np.array([0, 0, 0]), np.array([180, 255, 30])),      # dark black
        (np.array([0, 50, 150]), np.array([20, 255, 255])),   # light orange
        (np.array([0, 100, 100]), np.array([15, 255, 255])),  # dark orange
    ],
}

def build_combined_mask(hsv_image, color_ranges):
    """OR-combine masks for every (lower, upper) HSV range in color_ranges."""
    combined = None
    for lower, upper in color_ranges:
        mask = cv2.inRange(hsv_image, lower, upper)
        combined = mask if combined is None else cv2.bitwise_or(combined, mask)
    return combined

def process_image_bytes(image_bytes, color_ranges=None):
    """
    Runs the full detect -> separate (watershed) -> measure -> weight pipeline
    over image bytes. Returns a dictionary matching what Flask /analyze expects.
    """
    if color_ranges is None:
        color_ranges = COLOR_SETS['all_brown_black_orange']
    elif isinstance(color_ranges, str) and color_ranges in COLOR_SETS:
        color_ranges = COLOR_SETS[color_ranges]

    # Decode image
    arr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image from bytes")

    output_image = image.copy()
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = build_combined_mask(hsv, color_ranges)

    # Morphological cleanup
    processed_mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, MORPH_KERNEL, iterations=2)
    processed_mask = cv2.morphologyEx(processed_mask, cv2.MORPH_CLOSE, MORPH_KERNEL, iterations=2)

    # Watershed to separate touching blobs
    sure_bg = cv2.dilate(processed_mask, MORPH_KERNEL, iterations=3)
    dist_transform = cv2.distanceTransform(processed_mask, cv2.DIST_L2, 5)
    
    max_val = dist_transform.max()
    if max_val > 0:
        _, sure_fg = cv2.threshold(dist_transform, 0.3 * max_val, 255, 0)
    else:
        sure_fg = np.zeros_like(dist_transform, dtype=np.uint8)
        
    sure_fg = np.uint8(sure_fg)
    unknown = cv2.subtract(sure_bg, sure_fg)

    _, markers = cv2.connectedComponents(sure_fg)
    markers = markers + 1
    markers[unknown == 255] = 0
    markers = cv2.watershed(image, markers)
    output_image[markers == -1] = [0, 0, 255]

    spot_count = 0
    dims_list = []
    
    for marker_id in np.unique(markers):
        if marker_id in (0, 1):
            continue
        marker_mask = np.zeros_like(processed_mask, dtype=np.uint8)
        marker_mask[markers == marker_id] = 255
        contours, _ = cv2.findContours(marker_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        cnt = contours[0]
        area = cv2.contourArea(cnt)
        if area <= MIN_CONTOUR_AREA:
            continue

        spot_count += 1
        x, y, w, h = cv2.boundingRect(cnt)
        cv2.rectangle(output_image, (x, y), (x + w, y + h), (255, 0, 0), 2)

        length_mm = max(w, h) / PIXELS_PER_MM
        width_mm = w / PIXELS_PER_MM
        weight_g = estimate_weight_from_length(length_mm)

        dims_list.append({
            "shrimp_index": spot_count,
            "length_mm": round(length_mm, 2),
            "width_mm": round(width_mm, 2),
            "weight_g": round(weight_g, 5),
            "confidence": 0.95,
            "bbox": {"x": int(x), "y": int(y), "w": int(w), "h": int(h)}
        })

    return {
        "shrimp_count": spot_count,
        "detections": dims_list,
        "annotated_image": output_image
    }