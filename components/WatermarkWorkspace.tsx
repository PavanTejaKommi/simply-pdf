"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { downloadPdf } from "../lib/pdf";
import { loadPdf } from "../lib/pdfjs";
import {
  applyAdvancedWatermark,
  WatermarkOptions,
  WatermarkLayout,
  WatermarkAnchor,
  WatermarkFontFamily,
  WatermarkFontStyle,
  WatermarkRenderMode,
  WatermarkPageSelection,
  parsePageRange,
  shouldWatermarkPage,
} from "../lib/pdf-security";

const COLOR_PALETTE = [
  { label: "Crimson", hex: "#dc2626" },
  { label: "Scarlet", hex: "#ef4444" },
  { label: "Amber", hex: "#f59e0b" },
  { label: "Emerald", hex: "#059669" },
  { label: "Royal Blue", hex: "#2563eb" },
  { label: "Navy", hex: "#1e3a8a" },
  { label: "Violet", hex: "#7c3aed" },
  { label: "Charcoal", hex: "#334155" },
  { label: "Slate", hex: "#64748b" },
  { label: "Black", hex: "#0f172a" },
  { label: "Golden", hex: "#d97706" },
  { label: "White", hex: "#ffffff" },
];

const TEXT_PRESETS = [
  "CONFIDENTIAL",
  "DRAFT",
  "DO NOT COPY",
  "SAMPLE",
  "TOP SECRET",
  "APPROVED",
  "INTERNAL ONLY",
  "COPY",
  "URGENT",
  "FINAL",
];

const OPACITY_PRESETS = [
  { label: "Ghost 10%", val: 0.1 },
  { label: "Subtle 20%", val: 0.2 },
  { label: "Medium 35%", val: 0.35 },
  { label: "Bold 60%", val: 0.6 },
  { label: "Solid 100%", val: 1.0 },
];

const ROTATION_SNAPS = [-90, -45, 0, 45, 90];

export function WatermarkWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [previewZoom, setPreviewZoom] = useState<number>(1.0);

  // Type: Text vs Image
  const [watermarkType, setWatermarkType] = useState<"text" | "image">("text");

  // Text Settings
  const [text, setText] = useState<string>("CONFIDENTIAL");
  const [colorHex, setColorHex] = useState<string>("#ef4444");
  const [fontSize, setFontSize] = useState<number>(48);
  const [fontFamily, setFontFamily] = useState<WatermarkFontFamily>("Helvetica");
  const [fontStyle, setFontStyle] = useState<WatermarkFontStyle>("bold");
  const [renderMode, setRenderMode] = useState<WatermarkRenderMode>("fill");
  const [strokeWidth, setStrokeWidth] = useState<number>(1.5);

  // Image Settings
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageBytes, setImageBytes] = useState<Uint8Array | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageScalePct, setImageScalePct] = useState<number>(40);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);

  // Layout & Rotation
  const [layout, setLayout] = useState<WatermarkLayout>("diagonal");
  const [anchor, setAnchor] = useState<WatermarkAnchor>("center");
  const [rotationDeg, setRotationDeg] = useState<number>(45);
  const [opacity, setOpacity] = useState<number>(0.25);
  const [customOffsetX, setCustomOffsetX] = useState<number>(50);
  const [customOffsetY, setCustomOffsetY] = useState<number>(50);

  // Page Selection
  const [pageSelection, setPageSelection] = useState<WatermarkPageSelection>("all");
  const [customPageRange, setCustomPageRange] = useState<string>("");

  // Processing state
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Canvas refs
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any | null>(null);

  // Handle PDF file load
  useEffect(() => {
    if (!file) {
      setPdfDoc(null);
      setTotalPages(0);
      setCurrentPage(1);
      setMessage("");
      setError("");
      return;
    }

    let isMounted = true;
    const loadDoc = async () => {
      setBusy(true);
      setError("");
      try {
        const doc = await loadPdf(file);
        if (!isMounted) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
      } catch (err: any) {
        if (!isMounted) return;
        console.error(err);
        setError("Could not load PDF document. Please check the file and try again.");
      } finally {
        if (isMounted) setBusy(false);
      }
    };

    void loadDoc();

    return () => {
      isMounted = false;
    };
  }, [file]);

  // Handle Image watermark file load
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageFile(f);
    const buf = await f.arrayBuffer();
    setImageBytes(new Uint8Array(buf));
    const url = URL.createObjectURL(f);
    setImagePreviewUrl(url);

    const img = new Image();
    img.src = url;
    img.onload = () => {
      loadedImageRef.current = img;
      drawWatermarkOverlay();
    };
  };

  // When layout preset changes, set sensible default rotation
  const handleSelectLayout = (newLayout: WatermarkLayout) => {
    setLayout(newLayout);
    if (newLayout === "diagonal") setRotationDeg(45);
    else if (newLayout === "tiled") setRotationDeg(35);
    else if (newLayout === "center" || newLayout === "header" || newLayout === "footer") {
      setRotationDeg(0);
    }
  };

  // Render base PDF page when page or doc changes
  useEffect(() => {
    if (!pdfDoc || !baseCanvasRef.current || !overlayCanvasRef.current) return;

    let cancel = false;

    const renderPage = async () => {
      try {
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {}
        }

        const page = await pdfDoc.getPage(currentPage);
        if (cancel) return;

        // Base scale for crisp rendering
        const viewport = page.getViewport({ scale: 1.5 * previewZoom });
        const canvas = baseCanvasRef.current;
        const overlay = overlayCanvasRef.current;
        if (!canvas || !overlay) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        overlay.width = viewport.width;
        overlay.height = viewport.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const renderContext = {
          canvasContext: ctx,
          viewport,
        };

        const task = page.render(renderContext);
        renderTaskRef.current = task;
        await task.promise;

        if (!cancel) {
          drawWatermarkOverlay();
        }
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.warn("PDF page render error:", err);
        }
      }
    };

    void renderPage();

    return () => {
      cancel = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }
    };
  }, [pdfDoc, currentPage, previewZoom]);

  // Redraw watermark overlay whenever settings change
  const drawWatermarkOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const isCurrentPageTargeted = shouldWatermarkPage(
      currentPage - 1,
      totalPages,
      pageSelection,
      customPageRange
    );

    if (!isCurrentPageTargeted) return;

    const w = overlay.width;
    const h = overlay.height;
    const scaleFactor = w / 595.28; // standard A4 pt reference

    const angleRad = (-rotationDeg * Math.PI) / 180; // Negative for canvas screen coordinates

    // Compute Centers
    const centers: { cx: number; cy: number }[] = [];

    if (layout === "diagonal" || layout === "center") {
      centers.push({ cx: w / 2, cy: h / 2 });
    } else if (layout === "header") {
      centers.push({ cx: w / 2, cy: 36 * scaleFactor });
    } else if (layout === "footer") {
      centers.push({ cx: w / 2, cy: h - 36 * scaleFactor });
    } else if (layout === "custom") {
      centers.push({ cx: (customOffsetX / 100) * w, cy: (customOffsetY / 100) * h });
    } else if (layout === "anchor") {
      const padX = 48 * scaleFactor;
      const padY = 48 * scaleFactor;
      let cx = w / 2;
      let cy = h / 2;
      if (anchor.includes("left")) cx = padX + 80 * scaleFactor;
      else if (anchor.includes("right")) cx = w - padX - 80 * scaleFactor;

      if (anchor.startsWith("top")) cy = padY + 40 * scaleFactor;
      else if (anchor.startsWith("bottom")) cy = h - padY - 40 * scaleFactor;
      centers.push({ cx, cy });
    } else if (layout === "tiled") {
      const colFractions = [1 / 6, 3 / 6, 5 / 6];
      const rowFractions = [1 / 6, 3 / 6, 5 / 6];
      for (const ry of rowFractions) {
        for (const rx of colFractions) {
          centers.push({ cx: w * rx, cy: h * ry });
        }
      }
    }

    ctx.save();
    ctx.globalAlpha = opacity;

    if (watermarkType === "text") {
      const scaledSize = fontSize * scaleFactor;
      const weightStr = fontStyle === "bold" ? "bold" : "normal";
      const styleStr = fontStyle === "italic" ? "italic" : "normal";
      const familyStr =
        fontFamily === "TimesRoman"
          ? "'Times New Roman', serif"
          : fontFamily === "Courier"
          ? "'Courier New', monospace"
          : "system-ui, -apple-system, sans-serif";

      ctx.font = `${styleStr} ${weightStr} ${scaledSize}px ${familyStr}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const lines = (text || "CONFIDENTIAL").split("\n").filter((l) => l.length > 0);
      const N = lines.length || 1;
      const lineHeight = scaledSize * 1.25;

      for (const { cx, cy } of centers) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);

        for (let i = 0; i < N; i++) {
          const lineY = (i - (N - 1) / 2) * lineHeight;

          if (renderMode === "stroke") {
            ctx.strokeStyle = colorHex;
            ctx.lineWidth = strokeWidth * scaleFactor;
            ctx.strokeText(lines[i] || "CONFIDENTIAL", 0, lineY);
          } else if (renderMode === "both") {
            ctx.strokeStyle = colorHex;
            ctx.lineWidth = strokeWidth * scaleFactor;
            ctx.strokeText(lines[i] || "CONFIDENTIAL", 0, lineY);
            ctx.fillStyle = colorHex;
            ctx.fillText(lines[i] || "CONFIDENTIAL", 0, lineY);
          } else {
            ctx.fillStyle = colorHex;
            ctx.fillText(lines[i] || "CONFIDENTIAL", 0, lineY);
          }
        }
        ctx.restore();
      }
    } else if (watermarkType === "image" && loadedImageRef.current) {
      const img = loadedImageRef.current;
      const targetW = w * (imageScalePct / 100);
      const aspect = img.naturalHeight / (img.naturalWidth || 1);
      const targetH = targetW * aspect;

      for (const { cx, cy } of centers) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
        ctx.restore();
      }
    }

    ctx.restore();
  }, [
    currentPage,
    totalPages,
    pageSelection,
    customPageRange,
    rotationDeg,
    layout,
    customOffsetX,
    customOffsetY,
    anchor,
    opacity,
    watermarkType,
    fontSize,
    fontStyle,
    fontFamily,
    text,
    renderMode,
    colorHex,
    strokeWidth,
    imageScalePct,
  ]);

  // Re-draw overlay whenever any watermark parameter changes
  useEffect(() => {
    drawWatermarkOverlay();
  }, [drawWatermarkOverlay]);

  // Execute and download watermarked PDF
  const handleApplyWatermark = async () => {
    if (!file) return;
    setBusy(true);
    setMessage("");
    setError("");

    try {
      const buffer = await file.arrayBuffer();
      const options: WatermarkOptions = {
        type: watermarkType,
        text,
        colorHex,
        fontSize,
        fontFamily,
        fontStyle,
        renderMode,
        strokeWidth,
        imageBytes: imageBytes || undefined,
        imageScalePct,
        layout,
        anchor,
        rotationDeg,
        opacity,
        customOffsetX,
        customOffsetY,
        pageSelection,
        customPageRange,
      };

      const watermarkedBytes = await applyAdvancedWatermark(buffer, options);

      const baseName = file.name.replace(/\.pdf$/i, "");
      downloadPdf(watermarkedBytes, `${baseName}-watermarked.pdf`);

      let appliedCount = totalPages;
      if (pageSelection === "first" || pageSelection === "last") appliedCount = 1;
      else if (pageSelection === "odd") appliedCount = Math.ceil(totalPages / 2);
      else if (pageSelection === "even") appliedCount = Math.floor(totalPages / 2);
      else if (pageSelection === "custom" && customPageRange) {
        appliedCount = parsePageRange(customPageRange, totalPages).size;
      }

      setMessage(
        `Success! Watermark applied across ${appliedCount} page${
          appliedCount === 1 ? "" : "s"
        }. Your file was downloaded directly.`
      );
    } catch (err: any) {
      console.error(err);
      setError("Failed to apply watermark. Check that the PDF is not password protected.");
    } finally {
      setBusy(false);
    }
  };

  const isCurrentPageWatermarked = shouldWatermarkPage(
    currentPage - 1,
    totalPages,
    pageSelection,
    customPageRange
  );

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="workspace">
        <header className="topbar">
          <span className="local-pill">
            <span className="status-dot" /> 100% local processing
          </span>
          <div className="topbar-right">
            <span className="topbar-help">No uploads. No tracking.</span>
            <ThemeToggle />
          </div>
        </header>

        <section className="content">
          <div className="intro">
            <p className="eyebrow">Secure &amp; Protect PDF</p>
            <h1>PDF Watermark Studio</h1>
            <p className="description">
              Overlay customized text or image watermarks with complete control over colors,
              opacity, rotation, multi-page presets, and anti-tamper grids. 100% in-browser
              privacy.
            </p>
          </div>

          {!file ? (
            <label
              className="upload-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f && f.type.includes("pdf")) setFile(f);
              }}
            >
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                }}
              />
              <span className="upload-icon">↑</span>
              <strong>Drop your PDF here</strong>
              <span className="upload-hint">or click to browse · processed locally</span>
            </label>
          ) : (
            <div className="watermark-studio-container">
              {/* File details bar */}
              <div className="watermark-file-banner">
                <div className="file-info-group">
                  <span className="file-type-badge">PDF</span>
                  <div>
                    <strong>{file.name}</strong>
                    <span className="file-subtext">
                      {(file.size / 1024 / 1024).toFixed(2)} MB · {totalPages} Page
                      {totalPages === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="reset-button"
                  onClick={() => {
                    setFile(null);
                    setImageFile(null);
                    setImageBytes(null);
                  }}
                >
                  Choose another file
                </button>
              </div>

              <div className="watermark-workspace-grid">
                {/* LEFT: Controls Panel */}
                <div className="watermark-controls-panel">
                  {/* Mode Tabs: Text vs Image */}
                  <div className="wm-tabs-nav" role="tablist">
                    <button
                      type="button"
                      className={`wm-tab-btn ${watermarkType === "text" ? "active" : ""}`}
                      onClick={() => setWatermarkType("text")}
                    >
                      <span className="tab-icon">✎</span> Text Watermark
                    </button>
                    <button
                      type="button"
                      className={`wm-tab-btn ${watermarkType === "image" ? "active" : ""}`}
                      onClick={() => setWatermarkType("image")}
                    >
                      <span className="tab-icon">🖼</span> Image / Stamp
                    </button>
                  </div>

                  {watermarkType === "text" ? (
                    <>
                      {/* Text Input */}
                      <div className="wm-form-group">
                        <label className="wm-label" htmlFor="wm-text-input">
                          Watermark Text
                          <span className="wm-label-hint">Supports multi-line text</span>
                        </label>
                        <textarea
                          id="wm-text-input"
                          className="wm-textarea"
                          rows={2}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          placeholder="e.g. CONFIDENTIAL or DO NOT COPY"
                        />

                        {/* Quick Text Chips */}
                        <div className="wm-chips-row">
                          {TEXT_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              className={`wm-chip ${text === preset ? "selected" : ""}`}
                              onClick={() => setText(preset)}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Color Picker & Swatches */}
                      <div className="wm-form-group">
                        <div className="wm-label-row">
                          <label className="wm-label">Watermark Color</label>
                          <div className="wm-hex-input-wrap">
                            <input
                              type="color"
                              className="wm-color-picker"
                              value={colorHex}
                              onChange={(e) => setColorHex(e.target.value)}
                              aria-label="Color Picker"
                            />
                            <input
                              type="text"
                              className="wm-hex-text"
                              value={colorHex}
                              onChange={(e) => setColorHex(e.target.value)}
                              maxLength={7}
                            />
                          </div>
                        </div>

                        <div className="wm-color-swatches">
                          {COLOR_PALETTE.map((c) => (
                            <button
                              key={c.hex}
                              type="button"
                              className={`wm-swatch ${colorHex.toLowerCase() === c.hex ? "active" : ""}`}
                              style={{ backgroundColor: c.hex }}
                              title={`${c.label} (${c.hex})`}
                              onClick={() => setColorHex(c.hex)}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Font & Style Controls */}
                      <div className="wm-form-grid-2">
                        <div className="wm-form-group">
                          <label className="wm-label" htmlFor="wm-font-family">
                            Font Family
                          </label>
                          <select
                            id="wm-font-family"
                            className="wm-select"
                            value={fontFamily}
                            onChange={(e) => setFontFamily(e.target.value as WatermarkFontFamily)}
                          >
                            <option value="Helvetica">Helvetica (Modern Clean)</option>
                            <option value="TimesRoman">Times New Roman (Formal)</option>
                            <option value="Courier">Courier (Monospace / Audit)</option>
                          </select>
                        </div>

                        <div className="wm-form-group">
                          <label className="wm-label" htmlFor="wm-font-style">
                            Font Style
                          </label>
                          <select
                            id="wm-font-style"
                            className="wm-select"
                            value={fontStyle}
                            onChange={(e) => setFontStyle(e.target.value as WatermarkFontStyle)}
                          >
                            <option value="bold">Bold</option>
                            <option value="regular">Regular</option>
                            <option value="italic">Italic</option>
                          </select>
                        </div>
                      </div>

                      {/* Font Size & Render Style */}
                      <div className="wm-form-grid-2">
                        <div className="wm-form-group">
                          <div className="wm-label-row">
                            <label className="wm-label">Font Size</label>
                            <span className="wm-val-badge">{fontSize} pt</span>
                          </div>
                          <input
                            type="range"
                            className="wm-slider"
                            min="14"
                            max="110"
                            value={fontSize}
                            onChange={(e) => setFontSize(Number(e.target.value))}
                          />
                        </div>

                        <div className="wm-form-group">
                          <label className="wm-label" htmlFor="wm-render-mode">
                            Fill Style
                          </label>
                          <select
                            id="wm-render-mode"
                            className="wm-select"
                            value={renderMode}
                            onChange={(e) => setRenderMode(e.target.value as WatermarkRenderMode)}
                          >
                            <option value="fill">Solid Fill</option>
                            <option value="stroke">Outline / Hollow Stroke</option>
                            <option value="both">Fill + Outline</option>
                          </select>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Image / Stamp Watermark Mode */
                    <div className="wm-form-group">
                      <label className="wm-label">Upload Image or Stamp</label>
                      <label className="wm-image-dropzone">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          onChange={handleImageUpload}
                        />
                        {imagePreviewUrl ? (
                          <div className="wm-image-preview-slot">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={imagePreviewUrl} alt="Watermark Stamp" />
                            <span>{imageFile?.name}</span>
                          </div>
                        ) : (
                          <div className="wm-image-placeholder">
                            <span className="upload-icon">🖼</span>
                            <strong>Click to upload PNG stamp or company logo</strong>
                            <span>Supports transparency (alpha channel)</span>
                          </div>
                        )}
                      </label>

                      {imagePreviewUrl && (
                        <div style={{ marginTop: 14 }}>
                          <div className="wm-label-row">
                            <label className="wm-label">Image Scale</label>
                            <span className="wm-val-badge">{imageScalePct}% width</span>
                          </div>
                          <input
                            type="range"
                            className="wm-slider"
                            min="10"
                            max="120"
                            value={imageScalePct}
                            onChange={(e) => setImageScalePct(Number(e.target.value))}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Opacity Control (Always Available) */}
                  <div className="wm-form-group">
                    <div className="wm-label-row">
                      <label className="wm-label">Watermark Opacity</label>
                      <span className="wm-val-badge">{Math.round(opacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      className="wm-slider"
                      min="0.05"
                      max="1.0"
                      step="0.01"
                      value={opacity}
                      onChange={(e) => setOpacity(Number(e.target.value))}
                    />

                    {/* Quick Opacity Presets */}
                    <div className="wm-chips-row">
                      {OPACITY_PRESETS.map((preset) => (
                        <button
                          key={preset.val}
                          type="button"
                          className={`wm-chip ${
                            Math.abs(opacity - preset.val) < 0.03 ? "selected" : ""
                          }`}
                          onClick={() => setOpacity(preset.val)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Layout & Placement Scenarios */}
                  <div className="wm-form-group">
                    <label className="wm-label">Position &amp; Layout</label>
                    <div className="wm-layout-grid">
                      <button
                        type="button"
                        className={`wm-layout-btn ${layout === "diagonal" ? "active" : ""}`}
                        onClick={() => handleSelectLayout("diagonal")}
                      >
                        <span className="layout-icon">↗</span>
                        <div className="layout-text">
                          <strong>Full Diagonal</strong>
                          <span>45° Centered</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`wm-layout-btn ${layout === "tiled" ? "active" : ""}`}
                        onClick={() => handleSelectLayout("tiled")}
                      >
                        <span className="layout-icon">▦</span>
                        <div className="layout-text">
                          <strong>Repeating Grid</strong>
                          <span>3x3 Anti-tamper</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`wm-layout-btn ${layout === "center" ? "active" : ""}`}
                        onClick={() => handleSelectLayout("center")}
                      >
                        <span className="layout-icon">―</span>
                        <div className="layout-text">
                          <strong>Horizontal</strong>
                          <span>0° Centered</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`wm-layout-btn ${layout === "header" ? "active" : ""}`}
                        onClick={() => handleSelectLayout("header")}
                      >
                        <span className="layout-icon">▔</span>
                        <div className="layout-text">
                          <strong>Top Header</strong>
                          <span>Classification Bar</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`wm-layout-btn ${layout === "footer" ? "active" : ""}`}
                        onClick={() => handleSelectLayout("footer")}
                      >
                        <span className="layout-icon"> </span>
                        <div className="layout-text">
                          <strong>Bottom Footer</strong>
                          <span>Disclaimer Bar</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`wm-layout-btn ${layout === "anchor" ? "active" : ""}`}
                        onClick={() => handleSelectLayout("anchor")}
                      >
                        <span className="layout-icon">⊞</span>
                        <div className="layout-text">
                          <strong>9-Point Grid</strong>
                          <span>Pinpoint Anchor</span>
                        </div>
                      </button>
                    </div>

                    {/* 9-Point Anchor Selector */}
                    {layout === "anchor" && (
                      <div className="wm-anchor-box">
                        <span className="wm-anchor-sub">Select exact anchor point:</span>
                        <div className="wm-anchor-grid-3x3">
                          {[
                            "top-left",
                            "top-center",
                            "top-right",
                            "center-left",
                            "center",
                            "center-right",
                            "bottom-left",
                            "bottom-center",
                            "bottom-right",
                          ].map((pt) => (
                            <button
                              key={pt}
                              type="button"
                              className={`wm-anchor-cell ${anchor === pt ? "selected" : ""}`}
                              onClick={() => setAnchor(pt as WatermarkAnchor)}
                              title={pt}
                            >
                              •
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Custom Coordinates Sliders */}
                    {layout === "custom" && (
                      <div className="wm-custom-coords-box">
                        <div className="wm-form-grid-2">
                          <div>
                            <div className="wm-label-row">
                              <label className="wm-label">Horizontal X</label>
                              <span className="wm-val-badge">{customOffsetX}%</span>
                            </div>
                            <input
                              type="range"
                              className="wm-slider"
                              min="5"
                              max="95"
                              value={customOffsetX}
                              onChange={(e) => setCustomOffsetX(Number(e.target.value))}
                            />
                          </div>
                          <div>
                            <div className="wm-label-row">
                              <label className="wm-label">Vertical Y</label>
                              <span className="wm-val-badge">{customOffsetY}%</span>
                            </div>
                            <input
                              type="range"
                              className="wm-slider"
                              min="5"
                              max="95"
                              value={customOffsetY}
                              onChange={(e) => setCustomOffsetY(Number(e.target.value))}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Rotation Slider & Snaps */}
                  <div className="wm-form-group">
                    <div className="wm-label-row">
                      <label className="wm-label">Rotation Angle</label>
                      <span className="wm-val-badge">{rotationDeg}°</span>
                    </div>
                    <input
                      type="range"
                      className="wm-slider"
                      min="-180"
                      max="180"
                      value={rotationDeg}
                      onChange={(e) => setRotationDeg(Number(e.target.value))}
                    />
                    <div className="wm-chips-row">
                      {ROTATION_SNAPS.map((snap) => (
                        <button
                          key={snap}
                          type="button"
                          className={`wm-chip ${rotationDeg === snap ? "selected" : ""}`}
                          onClick={() => setRotationDeg(snap)}
                        >
                          {snap > 0 ? `+${snap}°` : `${snap}°`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Page Range Filtering */}
                  <div className="wm-form-group">
                    <label className="wm-label">Target Pages</label>
                    <div className="wm-page-radios">
                      {[
                        { id: "all", label: `All Pages (${totalPages})` },
                        { id: "first", label: "First Page Only (Cover)" },
                        { id: "last", label: "Last Page Only" },
                        { id: "odd", label: "Odd Pages (1, 3, 5...)" },
                        { id: "even", label: "Even Pages (2, 4, 6...)" },
                        { id: "custom", label: "Custom Range" },
                      ].map((item) => (
                        <label key={item.id} className="wm-radio-label">
                          <input
                            type="radio"
                            name="pageSelection"
                            value={item.id}
                            checked={pageSelection === item.id}
                            onChange={() => setPageSelection(item.id as WatermarkPageSelection)}
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>

                    {pageSelection === "custom" && (
                      <div style={{ marginTop: 10 }}>
                        <input
                          type="text"
                          className="wm-text-input"
                          placeholder="e.g. 1-3, 5, 8-10"
                          value={customPageRange}
                          onChange={(e) => setCustomPageRange(e.target.value)}
                        />
                        <span className="wm-label-hint">
                          Comma-separated page numbers or ranges. Total pages: {totalPages}.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Download Action */}
                  <div className="wm-action-box">
                    <button
                      type="button"
                      className="download-button"
                      onClick={handleApplyWatermark}
                      disabled={busy}
                    >
                      {busy ? "Applying Watermark…" : "Apply Watermark & Download PDF ↓"}
                    </button>
                  </div>

                  {message && (
                    <p className="success-message" role="status">
                      {message}
                    </p>
                  )}
                  {error && (
                    <p className="error-message" role="status">
                      {error}
                    </p>
                  )}
                </div>

                {/* RIGHT: Live Interactive Preview */}
                <div className="watermark-preview-panel">
                  <div className="wm-preview-header">
                    <div className="wm-preview-title-group">
                      <strong>Live PDF Preview</strong>
                      <span
                        className={`wm-target-badge ${
                          isCurrentPageWatermarked ? "badge-active" : "badge-skipped"
                        }`}
                      >
                        {isCurrentPageWatermarked
                          ? `✓ Watermarked on Page ${currentPage}`
                          : `⊘ Skipped on Page ${currentPage}`}
                      </span>
                    </div>

                    <div className="wm-preview-controls">
                      <div className="wm-page-nav">
                        <button
                          type="button"
                          className="wm-nav-btn"
                          disabled={currentPage <= 1}
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          aria-label="Previous Page"
                        >
                          ‹
                        </button>
                        <span className="wm-page-counter">
                          Page {currentPage} / {totalPages}
                        </span>
                        <button
                          type="button"
                          className="wm-nav-btn"
                          disabled={currentPage >= totalPages}
                          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                          aria-label="Next Page"
                        >
                          ›
                        </button>
                      </div>

                      <div className="wm-zoom-group">
                        <button
                          type="button"
                          className={`wm-zoom-btn ${previewZoom === 0.85 ? "active" : ""}`}
                          onClick={() => setPreviewZoom(0.85)}
                        >
                          75%
                        </button>
                        <button
                          type="button"
                          className={`wm-zoom-btn ${previewZoom === 1.0 ? "active" : ""}`}
                          onClick={() => setPreviewZoom(1.0)}
                        >
                          100%
                        </button>
                        <button
                          type="button"
                          className={`wm-zoom-btn ${previewZoom === 1.25 ? "active" : ""}`}
                          onClick={() => setPreviewZoom(1.25)}
                        >
                          125%
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Canvas Container */}
                  <div className="wm-canvas-stage">
                    <div className="wm-canvas-sheet">
                      <canvas ref={baseCanvasRef} className="wm-base-canvas" />
                      <canvas ref={overlayCanvasRef} className="wm-overlay-canvas" />
                    </div>
                  </div>

                  <div className="wm-preview-footer">
                    <span>
                      ✦ Real-time preview matches final high-resolution exported PDF output
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <footer className="footer">
          <span>✦ Built for privacy</span>
          <span>Everything happens locally in your browser</span>
        </footer>
      </main>
    </div>
  );
}
