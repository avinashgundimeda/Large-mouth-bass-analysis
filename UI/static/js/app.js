/* ==========================================================================
   LITOPENAEUS VANNAMEI ANALYSIS - app.js
   Vanilla JS only. Handles: drag & drop upload, preview, calling the Flask
   API (/upload, /analyze, /results, /statistics), rendering stat cards,
   Chart.js histograms, detection result cards, dark/light theme, and
   CSV / PDF export.
   ========================================================================== */

(function () {
  "use strict";

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  const state = {
    selectedFiles: [],      // File objects staged for upload
    uploadedImages: [],     // [{id, filename, original_name, url}]
    lastAnalysis: null,     // full /analyze response
    lengthChart: null,
    weightChart: null,
  };

  async function analyzeImages(files) {
  const formData = new FormData();
  for (const file of files) formData.append('images', file);

  const res = await fetch('/api/analyze', { method: 'POST', body: formData });
  const data = await res.json();
  renderResults(data.results); // update stat cards, histograms, detection list
}

  // ------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const previewGrid = document.getElementById("previewGrid");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const resetBtn = document.getElementById("resetBtn");
  const fileCountLabel = document.getElementById("fileCountLabel");
  const calibrationInput = document.getElementById("calibrationInput");

  const progressWrap = document.getElementById("progressWrap");
  const progressFill = document.getElementById("progressFill");
  const progressStage = document.getElementById("progressStage");
  const progressPercent = document.getElementById("progressPercent");

  const statTotal = document.getElementById("statTotal");
  const statLength = document.getElementById("statLength");
  const statWeight = document.getElementById("statWeight");
  const statBiomass = document.getElementById("statBiomass");

  const resultsContainer = document.getElementById("resultsContainer");
  const resultsHint = document.getElementById("resultsHint");

  const exportCsvBtn = document.getElementById("exportCsvBtn");
  const exportPdfBtn = document.getElementById("exportPdfBtn");

  const themeLightBtn = document.getElementById("themeLight");
  const themeDarkBtn = document.getElementById("themeDark");

  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMsg");
  const toastTitle = document.getElementById("toastTitle");
  const toastCloseBtn = document.getElementById("toastCloseBtn");

  document.getElementById("footerYear").textContent = "© " + new Date().getFullYear();

  // ------------------------------------------------------------------
  // Toast helper
  // ------------------------------------------------------------------
  let toastTimer = null;
  function showToast(message, isError) {
    const errorIcon = toast.querySelector(".icon-error");
    const successIcon = toast.querySelector(".icon-success");

    toastMsg.textContent = message;
    toastTitle.textContent = isError ? "Analysis Failed" : "Success";
    toast.classList.toggle("error", !!isError);

    if (isError) {
      if (errorIcon) errorIcon.style.display = "block";
      if (successIcon) successIcon.style.display = "none";
    } else {
      if (errorIcon) errorIcon.style.display = "none";
      if (successIcon) successIcon.style.display = "block";
    }

    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 5000);
  }

  if (toastCloseBtn) {
    toastCloseBtn.addEventListener("click", () => {
      toast.classList.remove("show");
      clearTimeout(toastTimer);
    });
  }

  // ------------------------------------------------------------------
  // Theme handling
  // ------------------------------------------------------------------
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    themeLightBtn.classList.toggle("active", theme === "light");
    themeDarkBtn.classList.toggle("active", theme === "dark");
    localStorage.setItem("lva_theme", theme);
    // Re-render charts so colors adapt to theme
    if (state.lastAnalysis) renderCharts(state.lastAnalysis);
  }
  themeLightBtn.addEventListener("click", () => setTheme("light"));
  themeDarkBtn.addEventListener("click", () => setTheme("dark"));
  setTheme(localStorage.getItem("lva_theme") || "light");

  // ------------------------------------------------------------------
  // Drag & Drop / File selection
  // ------------------------------------------------------------------
  dropzone.addEventListener("click", () => fileInput.click());

  ["dragenter", "dragover"].forEach(evt =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach(evt =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith("image/"));
    addFiles(files);
  });
  fileInput.addEventListener("change", (e) => {
    addFiles(Array.from(e.target.files || []));
    fileInput.value = "";
  });

  function addFiles(files) {
    if (!files.length) return;
    state.selectedFiles = state.selectedFiles.concat(files);
    renderPreviews();
  }

  function renderPreviews() {
    previewGrid.innerHTML = "";
    state.selectedFiles.forEach((file, idx) => {
      const url = URL.createObjectURL(file);
      const item = document.createElement("div");
      item.className = "preview-item fade-in";
      item.innerHTML = `
        <img src="${url}" alt="${file.name}">
        <button class="remove-btn" data-idx="${idx}" title="Remove">✕</button>
        <div class="fname">${file.name}</div>
      `;
      previewGrid.appendChild(item);
    });

    previewGrid.querySelectorAll(".remove-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx, 10);
        state.selectedFiles.splice(idx, 1);
        renderPreviews();
      });
    });

    const n = state.selectedFiles.length;
    fileCountLabel.textContent = n ? `${n} file${n > 1 ? "s" : ""} staged` : "No files selected";
    analyzeBtn.disabled = n === 0;
  }

  // ------------------------------------------------------------------
  // Reset
  // ------------------------------------------------------------------
  resetBtn.addEventListener("click", () => {
    state.selectedFiles = [];
    state.uploadedImages = [];
    state.lastAnalysis = null;
    previewGrid.innerHTML = "";
    fileCountLabel.textContent = "No files selected";
    analyzeBtn.disabled = true;
    progressWrap.classList.remove("active");
    progressFill.style.width = "0%";
    resultsContainer.innerHTML = `
      <div class="results-empty">
        <div class="icon">🦐</div>
        Upload sample images and click "Analyze Samples" to see detections,<br>bounding boxes, measured length, predicted weight and confidence.
      </div>`;
    resultsHint.textContent = "no analysis run yet";
    updateStatCards({ total_detected: 0, avg_length_mm: 0, avg_weight_g: 0, total_biomass_g: 0 });
    destroyCharts();
    exportCsvBtn.disabled = true;
    exportPdfBtn.disabled = true;
    showToast("Workspace reset");
  });

  // ------------------------------------------------------------------
  // Upload + Analyze pipeline
  // ------------------------------------------------------------------
  analyzeBtn.addEventListener("click", runPipeline);

  async function runPipeline() {
    if (!state.selectedFiles.length) return;

    analyzeBtn.disabled = true;
    progressWrap.classList.add("active");
    setProgress(15, "Uploading & analyzing images…");

    try {
      const formData = new FormData();
      state.selectedFiles.forEach(f => formData.append("images", f));

      const analyzeResp = await fetch("/api/analyze", {
        method: "POST",
        body: formData
      });
      const analyzeData = await analyzeResp.json();
      if (!analyzeData.success) throw new Error(analyzeData.error || "Analysis failed");

      setProgress(85, "Rendering results…");
      state.lastAnalysis = analyzeData;

      updateStatCards(analyzeData.statistics);
      renderCharts(analyzeData);
      renderResults(analyzeData);

      exportCsvBtn.disabled = false;
      exportPdfBtn.disabled = false;
      resultsHint.textContent = `batch ${analyzeData.batch_id} · ${analyzeData.statistics.total_detected} spots detected`;

      setProgress(100, "Done");
      showToast(`Analysis complete — ${analyzeData.statistics.total_detected} spots detected`);
      setTimeout(() => progressWrap.classList.remove("active"), 1200);

    } catch (err) {
      console.error(err);
      showToast(err.message || "Something went wrong", true);
      progressWrap.classList.remove("active");
    } finally {
      analyzeBtn.disabled = false;
    }
  }

  function setProgress(pct, label) {
    progressFill.style.width = pct + "%";
    progressPercent.textContent = pct + "%";
    progressStage.textContent = label;
  }

  // ------------------------------------------------------------------
  // Stat cards
  // ------------------------------------------------------------------
  function updateStatCards(stats) {
    const isReset = !stats || (!stats.total_detected && !stats.avg_length_mm);
    statTotal.textContent = isReset ? "—" : (stats.total_detected ?? 0);
    statLength.innerHTML = isReset ? `— <span class="unit">mm</span>` : `${(stats.avg_length_mm ?? 0).toFixed(1)} <span class="unit">mm</span>`;
    statWeight.innerHTML = isReset ? `— <span class="unit">g</span>` : `${(stats.avg_weight_g ?? 0).toFixed(1)} <span class="unit">g</span>`;
    statBiomass.innerHTML = isReset ? `— <span class="unit">g</span>` : `${(stats.total_biomass_g ?? 0).toFixed(1)} <span class="unit">g</span>`;
  }

  // ------------------------------------------------------------------
  // Charts
  // ------------------------------------------------------------------
  function buildHistogramBins(values, binCount) {
    if (!values.length) return { labels: [], data: [] };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const binSize = range / binCount;
    const bins = new Array(binCount).fill(0);

    values.forEach(v => {
      let idx = Math.floor((v - min) / binSize);
      if (idx >= binCount) idx = binCount - 1;
      if (idx < 0) idx = 0;
      bins[idx]++;
    });

    const labels = bins.map((_, i) => {
      const lo = (min + i * binSize).toFixed(1);
      const hi = (min + (i + 1) * binSize).toFixed(1);
      return `${lo}–${hi}`;
    });

    return { labels, data: bins };
  }

  function themeColors() {
    return {
      grid: "rgba(226, 232, 240, 0.6)",
      text: "#64748b",
      teal: "#df9a00", // brand orange-gold
      coral: "#f59e0b", // brand gold-amber
    };
  }

  function destroyCharts() {
    if (state.lengthChart) { state.lengthChart.destroy(); state.lengthChart = null; }
    if (state.weightChart) { state.weightChart.destroy(); state.weightChart = null; }
    document.getElementById("lengthChartEmpty").style.display = "flex";
    document.getElementById("weightChartEmpty").style.display = "flex";
  }

  function renderCharts(analyzeData) {
    destroyCharts();
    const lengths = analyzeData.length_distribution || [];
    const weights = analyzeData.weight_distribution || [];
    if (!lengths.length) return;

    document.getElementById("lengthChartEmpty").style.display = "none";
    document.getElementById("weightChartEmpty").style.display = "none";

    const colors = themeColors();
    const lengthBins = buildHistogramBins(lengths, Math.min(10, Math.max(4, Math.ceil(Math.sqrt(lengths.length)))));
    const weightBins = buildHistogramBins(weights, Math.min(10, Math.max(4, Math.ceil(Math.sqrt(weights.length)))));

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0e2a2e",
          titleFont: { family: "JetBrains Mono" },
          bodyFont: { family: "JetBrains Mono" },
        }
      },
      scales: {
        x: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { family: "JetBrains Mono", size: 10 } } },
        y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { color: colors.text, font: { family: "JetBrains Mono", size: 10 }, precision: 0 } }
      }
    };

    state.lengthChart = new Chart(document.getElementById("lengthChart"), {
      type: "bar",
      data: {
        labels: lengthBins.labels,
        datasets: [{
          label: "Shrimp count",
          data: lengthBins.data,
          backgroundColor: colors.teal,
          borderRadius: 4,
          barPercentage: 0.85,
        }]
      },
      options: commonOptions
    });

    state.weightChart = new Chart(document.getElementById("weightChart"), {
      type: "bar",
      data: {
        labels: weightBins.labels,
        datasets: [{
          label: "Shrimp count",
          data: weightBins.data,
          backgroundColor: colors.coral,
          borderRadius: 4,
          barPercentage: 0.85,
        }]
      },
      options: commonOptions
    });
  }

  // ------------------------------------------------------------------
  // Results rendering
  // ------------------------------------------------------------------
  function renderResults(analyzeData) {
    resultsContainer.innerHTML = "";
    const images = analyzeData.images || [];

    if (!images.length) {
      resultsContainer.innerHTML = `<div class="results-empty">No detections returned for this batch.</div>`;
      return;
    }

    images.forEach((img, imgIdx) => {
      const card = document.createElement("div");
      card.className = "result-card fade-in";

      const detRows = (img.detections || []).map(det => {
        const confClass = det.confidence >= 0.75 ? "high" : "med";
        return `
          <div class="detection-row">
            <div class="idx">${det.shrimp_index}</div>
            <div><span class="metric-label">Length</span><span class="metric-value">${det.length_mm.toFixed(1)} mm</span></div>
            <div><span class="metric-label">Weight</span><span class="metric-value">${det.weight_g.toFixed(2)} g</span></div>
            <div><span class="metric-label">Confidence</span>
              <span class="confidence-pill ${confClass}">${Math.round(det.confidence * 100)}%</span>
            </div>
          </div>`;
      }).join("") || `<div style="font-family:var(--font-mono);font-size:12px;color:var(--ink-faint);padding:10px 0;">No shrimp detected in this image — try adjusting lighting/contrast or the calibration factor.</div>`;

      card.innerHTML = `
        <div class="result-card-head">
          <span class="name">${img.original_name || "image_" + (imgIdx + 1)}</span>
          <span class="count">${img.shrimp_count ?? 0} detected</span>
        </div>
        <div class="result-card-body">
          <div class="result-image">
            <img src="${img.annotated_url || img.original_url}" data-original="${img.original_url}" data-annotated="${img.annotated_url}" alt="detection result">
            <div class="tab-toggle">
              <button class="tab-annotated active" data-mode="annotated">Annotated</button>
              <button class="tab-original" data-mode="original">Original</button>
            </div>
          </div>
          <div class="detections-list">${detRows}</div>
        </div>
      `;

      resultsContainer.appendChild(card);

      const imgEl = card.querySelector(".result-image img");
      card.querySelectorAll(".tab-toggle button").forEach(btn => {
        btn.addEventListener("click", () => {
          card.querySelectorAll(".tab-toggle button").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          imgEl.src = btn.dataset.mode === "annotated" ? imgEl.dataset.annotated : imgEl.dataset.original;
        });
      });
    });
  }

  // ------------------------------------------------------------------
  // CSV Export
  // ------------------------------------------------------------------
  exportCsvBtn.addEventListener("click", () => {
    if (!state.lastAnalysis) return;
    const rows = [["Image", "Shrimp #", "Length (mm)", "Weight (g)", "Confidence (%)"]];

    (state.lastAnalysis.images || []).forEach(img => {
      (img.detections || []).forEach(det => {
        rows.push([
          img.original_name,
          det.shrimp_index,
          det.length_mm.toFixed(2),
          det.weight_g.toFixed(2),
          Math.round(det.confidence * 100)
        ]);
      });
    });

    const stats = state.lastAnalysis.statistics;
    rows.push([]);
    rows.push(["Summary"]);
    rows.push(["Total Detected", stats.total_detected]);
    rows.push(["Average Length (mm)", stats.avg_length_mm]);
    rows.push(["Average Weight (g)", stats.avg_weight_g]);
    rows.push(["Total Biomass (g)", stats.total_biomass_g]);

    const csvContent = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `lva_analysis_${state.lastAnalysis.batch_id}.csv`;
    link.click();
    showToast("CSV exported");
  });

  // ------------------------------------------------------------------
  // PDF Export
  // ------------------------------------------------------------------
  exportPdfBtn.addEventListener("click", () => {
    if (!state.lastAnalysis) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const stats = state.lastAnalysis.statistics;
    const margin = 40;
    let y = 50;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Litopenaeus Vannamei Analysis Report", margin, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Batch ID: ${state.lastAnalysis.batch_id}   |   Generated: ${new Date().toLocaleString()}`, margin, y);
    y += 30;

    doc.setTextColor(0);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Summary Statistics", margin, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const summaryLines = [
      `Total Shrimp Detected: ${stats.total_detected}`,
      `Average Length: ${stats.avg_length_mm.toFixed(2)} mm`,
      `Average Weight: ${stats.avg_weight_g.toFixed(2)} g`,
      `Total Biomass: ${stats.total_biomass_g.toFixed(2)} g`,
      `Average Confidence: ${Math.round((stats.avg_confidence || 0) * 100)}%`,
    ];
    summaryLines.forEach(line => { doc.text(line, margin, y); y += 16; });
    y += 12;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Per-Shrimp Detections", margin, y);
    y += 18;

    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.text("Image", margin, y);
    doc.text("#", margin + 180, y);
    doc.text("Length (mm)", margin + 220, y);
    doc.text("Weight (g)", margin + 320, y);
    doc.text("Confidence", margin + 410, y);
    y += 8;
    doc.setLineWidth(0.5);
    doc.line(margin, y, 555, y);
    y += 12;
    doc.setFont("helvetica", "normal");

    (state.lastAnalysis.images || []).forEach(img => {
      (img.detections || []).forEach(det => {
        if (y > 770) { doc.addPage(); y = 50; }
        const name = (img.original_name || "").length > 28 ? img.original_name.slice(0, 25) + "…" : img.original_name;
        doc.text(String(name), margin, y);
        doc.text(String(det.shrimp_index), margin + 180, y);
        doc.text(det.length_mm.toFixed(2), margin + 220, y);
        doc.text(det.weight_g.toFixed(2), margin + 320, y);
        doc.text(`${Math.round(det.confidence * 100)}%`, margin + 410, y);
        y += 14;
      });
    });

    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text("Generated by Litopenaeus Vannamei Analysis Platform — OpenCV / scikit-learn / Flask", margin, 820);

    doc.save(`lva_analysis_${state.lastAnalysis.batch_id}.pdf`);
    showToast("PDF report exported");
  });

})();
