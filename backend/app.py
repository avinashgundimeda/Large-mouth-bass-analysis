"""
backend/app.py
==========================================================
LITOPENAEUS VANNAMEI ANALYSIS - Flask Backend (Production)
==========================================================
"""

import os
import uuid
import json
import datetime
import logging
import cv2
import numpy as np
from flask import Flask, request, jsonify, render_template, send_from_directory

# Import watershed logic from detection.py
from detection import process_image_bytes, COLOR_SETS

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s in %(module)s: %(message)s'
)
logger = logging.getLogger(__name__)

# Base directory is the backend/ directory where app.py resides
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Static folders are inside the backend/ folder
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")
ANNOTATED_DIR = os.path.join(BASE_DIR, "static", "uploads", "annotated")

# Configure custom environment variable path for persistent volumes on Render
VISITORS_FILE = os.environ.get(
    "VISITORS_FILE_PATH",
    os.path.join(os.path.dirname(BASE_DIR), "visitor_data.json")
)

# Ensure directories exist
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(ANNOTATED_DIR, exist_ok=True)

# Flask defaults to templates/ and static/ in the same directory as app.py, so we explicitly configure it to point to UI/templates
app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(BASE_DIR), "UI", "templates")
)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024  # 32MB cap

# ----------------------------------------------------------------
# Visitor metrics logging helpers
# ----------------------------------------------------------------
def get_client_ip():
    # Render routes requests through a load balancer, so check X-Forwarded-For first
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    return request.remote_addr

def track_visit():
    ip = get_client_ip()
    ua = request.headers.get('User-Agent', 'Unknown')
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    data = {"total_visits": 0, "unique_visits": 0, "visitors": []}
    
    # Read existing visitor logs if file exists
    if os.path.exists(VISITORS_FILE):
        try:
            with open(VISITORS_FILE, "r") as f:
                data = json.load(f)
        except Exception as exc:
            logger.error(f"Error reading visitor log file: {exc}")
            
    # Update stats
    data["total_visits"] = data.get("total_visits", 0) + 1
    
    visitors = data.get("visitors", [])
    found = False
    for v in visitors:
        if v["ip"] == ip:
            v["hits"] = v.get("hits", 0) + 1
            v["last_visit"] = now
            v["user_agent"] = ua
            found = True
            break
            
    if not found:
        visitors.append({
            "ip": ip,
            "hits": 1,
            "first_visit": now,
            "last_visit": now,
            "user_agent": ua
        })
        
    data["visitors"] = visitors
    data["unique_visits"] = len(visitors)
    
    # Write updated stats back safely
    try:
        # Ensure target folder exists (crucial for custom Render disk paths)
        os.makedirs(os.path.dirname(os.path.abspath(VISITORS_FILE)), exist_ok=True)
        with open(VISITORS_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as exc:
        logger.error(f"Failed to write visitor data to disk: {exc}")
        
    return data

# ----------------------------------------------------------------
# Web and API Routes
# ----------------------------------------------------------------
@app.route("/UI/static/<path:filename>")
def serve_ui_static(filename):
    return send_from_directory(
        os.path.join(os.path.dirname(BASE_DIR), "UI", "static"),
        filename
    )

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/visitors")
def visitors():
    # Logs visit count on visit page access
    track_visit()
    return render_template("visitors.html")

@app.route("/api/visitors", methods=["GET"])
def api_visitors():
    data = {"total_visits": 0, "unique_visits": 0, "visitors": []}
    if os.path.exists(VISITORS_FILE):
        try:
            with open(VISITORS_FILE, "r") as f:
                data = json.load(f)
        except Exception as exc:
            logger.error(f"Error returning visitor API data: {exc}")
    return jsonify(data)

@app.route("/api/analyze", methods=["POST"])
def analyze():
    files = request.files.getlist("images")
    if not files or all(f.filename == "" for f in files):
        return jsonify({"success": False, "error": "No files selected"}), 400

    batch_id = uuid.uuid4().hex[:10]
    all_lengths = []
    all_weights = []
    all_confidences = []
    images_meta = []

    for f in files:
        if not f:
            continue
        try:
            filename = f.filename
            file_bytes = f.read()

            # Save uploaded original copy
            ext = filename.rsplit(".", 1)[1].lower() if "." in filename else "png"
            unique_name = f"{uuid.uuid4().hex}.{ext}"
            original_path = os.path.join(UPLOAD_DIR, unique_name)
            
            with open(original_path, "wb") as out_file:
                out_file.write(file_bytes)

            # Process image bytes using watershed pipeline
            res = process_image_bytes(file_bytes, COLOR_SETS['all_brown_black_orange'])
            shrimp_count = res["shrimp_count"]
            detections = res["detections"]
            annotated_image = res["annotated_image"]

            # Save marked annotated image copy
            annotated_name = f"annotated_{unique_name}"
            annotated_path = os.path.join(ANNOTATED_DIR, annotated_name)
            cv2.imwrite(annotated_path, annotated_image)

            # Record stats
            for det in detections:
                all_lengths.append(det["length_mm"])
                all_weights.append(det["weight_g"])
                all_confidences.append(det["confidence"])

            images_meta.append({
                "original_name": filename,
                "original_url": f"/static/uploads/{unique_name}",
                "annotated_url": f"/static/uploads/annotated/{annotated_name}",
                "shrimp_count": shrimp_count,
                "detections": detections
            })
        except Exception as exc:
            logger.error(f"Failed to process image '{f.filename}': {exc}")
            images_meta.append({
                "original_name": f.filename,
                "error": str(exc),
                "detections": [],
                "shrimp_count": 0
            })

    total_detected = len(all_lengths)
    avg_length = round(float(np.mean(all_lengths)), 2) if total_detected else 0.0
    avg_weight = round(float(np.mean(all_weights)), 2) if total_detected else 0.0
    total_biomass = round(float(np.sum(all_weights)), 2) if total_detected else 0.0
    avg_confidence = round(float(np.mean(all_confidences)), 2) if total_detected else 0.0

    return jsonify({
        "success": True,
        "batch_id": batch_id,
        "statistics": {
            "total_detected": total_detected,
            "avg_length_mm": avg_length,
            "avg_weight_g": avg_weight,
            "total_biomass_g": total_biomass,
            "avg_confidence": avg_confidence,
        },
        "length_distribution": all_lengths,
        "weight_distribution": all_weights,
        "images": images_meta
    })

if __name__ == "__main__":
    logger.info("Starting Flask application locally...")
    app.run(debug=True, host="0.0.0.0", port=5000)