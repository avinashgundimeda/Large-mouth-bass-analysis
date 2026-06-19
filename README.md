# Large-mouth-bass-analysis

AI-powered web application for Pacific White Shrimp, length measurement, weight estimation, and biomass analytics — built with vanilla HTML/CSS/JS on the frontend and Flask + OpenCV + scikit-learn on the backend.

## Tech Stack
- **Frontend:** HTML5, CSS3, vanilla JavaScript (no frameworks), Chart.js, jsPDF
- **Backend:** Python Flask (REST API)
- **Computer Vision:** OpenCV (grayscale conversion, noise removal, edge detection, contour detection, length measurement)
- **Machine Learning:** scikit-learn `RandomForestRegressor` (length → weight regression)


## How It Works

1. **Upload** — drag & drop one or more shrimp images (`POST /upload`). Files are stored in `static/uploads/` and registered in the SQLite `images` table.
2. **Analyze** (`POST /analyze`) — for each image:
   - OpenCV resizes the image, converts to grayscale, removes noise (Gaussian + median blur), runs adaptive thresholding + Canny edge detection, and extracts contours.
   - Each plausible shrimp-shaped contour is measured with `cv2.minAreaRect` to get its pixel length, which is converted to millimeters using the calibration factor: `length_mm = pixel_length × calibration_factor`.
   - The trained RandomForestRegressor predicts weight from length: `weight_g = model.predict(length_mm)`.
   - A confidence score is derived from contour shape heuristics (elongation + solidity).
   - Results (length, weight, confidence, bounding box) are saved to the `detections` table, and an aggregated row is saved to `analysis_results`.
3. **Dashboard** — the frontend renders four live stat cards (Total Detected, Average Length, Average Weight, Total Biomass), two Chart.js histograms (length & weight distribution), and per-image detection cards with bounding-box overlays.
4. **Export** — results can be exported as CSV or as a formatted PDF report (client-side, via jsPDF).
