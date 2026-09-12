"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { downloadPdf } from "../lib/pdf";
import { loadPdf } from "../lib/pdfjs";
import {
  applyAdvancedHeadersFooters,
  HeadersFootersOptions,
  WatermarkFontFamily,
  WatermarkFontStyle,
  WatermarkPageSelection,
  parsePageRange,
  shouldWatermarkPage,
} from "../lib/pdf-security";

const COLOR_PALETTE = [
  { label: "Black", hex: "#000000" },
  { label: "Charcoal", hex: "#334155" },
  { label: "Slate", hex: "#64748b" },
  { label: "Crimson", hex: "#dc2626" },
  { label: "Royal Blue", hex: "#2563eb" },
  { label: "Emerald", hex: "#059669" },
];

export function HeadersFootersWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [previewZoom, setPreviewZoom] = useState<number>(1.0);

  // Content
  const [topLeft, setTopLeft] = useState<string>("");
  const [topCenter, setTopCenter] = useState<string>("");
  const [topRight, setTopRight] = useState<string>("");
  const [bottomLeft, setBottomLeft] = useState<string>("");
  const [bottomCenter, setBottomCenter] = useState<string>("Page {page} of {total}");
  const [bottomRight, setBottomRight] = useState<string>("");

  // Header Styling
  const [headerFontFamily, setHeaderFontFamily] = useState<WatermarkFontFamily>("Helvetica");
  const [headerFontStyle, setHeaderFontStyle] = useState<WatermarkFontStyle>("regular");
  const [headerFontSize, setHeaderFontSize] = useState<number>(12);
  const [headerColorHex, setHeaderColorHex] = useState<string>("#334155");

  // Footer Styling
  const [footerFontFamily, setFooterFontFamily] = useState<WatermarkFontFamily>("Helvetica");
  const [footerFontStyle, setFooterFontStyle] = useState<WatermarkFontStyle>("regular");
  const [footerFontSize, setFooterFontSize] = useState<number>(12);
  const [footerColorHex, setFooterColorHex] = useState<string>("#334155");

  // Margins
  const [marginTop, setMarginTop] = useState<number>(36);
  const [marginBottom, setMarginBottom] = useState<number>(36);
  const [marginX, setMarginX] = useState<number>(36);

  // Page Selection
  const [pageSelection, setPageSelection] = useState<WatermarkPageSelection>("all");
  const [customPageRange, setCustomPageRange] = useState<string>("");

  // UI State
  const [activeTab, setActiveTab] = useState<"header" | "footer">("header");

  // Processing state
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Canvas refs
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any | null>(null);

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
          drawOverlay();
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

  const drawOverlay = useCallback(() => {
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
    
    const pageObj = pdfDoc?.getPage(currentPage);
    if (!pageObj) return;
    
    const scaleFactor = 1.5 * previewZoom;
    const marginXScaled = marginX * scaleFactor;

    ctx.save();
    
    const drawZone = (textRaw: string, align: "left" | "center" | "right", isTop: boolean) => {
      if (!textRaw) return;
      const text = textRaw
        .replace(/{page}/g, String(currentPage))
        .replace(/{total}/g, String(totalPages));
      if (!text) return;

      const familyStr = (isTop ? headerFontFamily : footerFontFamily) === "TimesRoman" ? "'Times New Roman', serif" : (isTop ? headerFontFamily : footerFontFamily) === "Courier" ? "'Courier New', monospace" : "system-ui, -apple-system, sans-serif";
      const styleStr = (isTop ? headerFontStyle : footerFontStyle) === "italic" ? "italic" : "normal";
      const weightStr = (isTop ? headerFontStyle : footerFontStyle) === "bold" ? "bold" : "normal";
      const scaledSize = (isTop ? headerFontSize : footerFontSize) * scaleFactor;
      
      ctx.font = `${styleStr} ${weightStr} ${scaledSize}px ${familyStr}`;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = isTop ? headerColorHex : footerColorHex;

      const textWidth = ctx.measureText(text).width;
      let x = marginXScaled;
      if (align === "center") x = (w - textWidth) / 2;
      else if (align === "right") x = w - marginXScaled - textWidth;

      let y = isTop ? (marginTop * scaleFactor) + scaledSize : h - (marginBottom * scaleFactor);

      ctx.fillText(text, x, y);
    };

    drawZone(topLeft, "left", true);
    drawZone(topCenter, "center", true);
    drawZone(topRight, "right", true);
    drawZone(bottomLeft, "left", false);
    drawZone(bottomCenter, "center", false);
    drawZone(bottomRight, "right", false);

    ctx.restore();
  }, [
    currentPage,
    totalPages,
    pageSelection,
    customPageRange,
    topLeft,
    topCenter,
    topRight,
    bottomLeft,
    bottomCenter,
    bottomRight,
    headerFontFamily,
    headerFontStyle,
    headerFontSize,
    headerColorHex,
    footerFontFamily,
    footerFontStyle,
    footerFontSize,
    footerColorHex,
    marginTop,
    marginBottom,
    marginX,
    pdfDoc,
    previewZoom
  ]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  const handleApply = async () => {
    if (!file) return;
    setBusy(true);
    setMessage("");
    setError("");

    try {
      const buffer = await file.arrayBuffer();
      const options: HeadersFootersOptions = {
        topLeft,
        topCenter,
        topRight,
        bottomLeft,
        bottomCenter,
        bottomRight,
        headerFontFamily,
        headerFontStyle,
        headerFontSize,
        headerColorHex,
        footerFontFamily,
        footerFontStyle,
        footerFontSize,
        footerColorHex,
        marginTop,
        marginBottom,
        marginX,
        pageSelection,
        customPageRange,
      };

      const outBytes = await applyAdvancedHeadersFooters(buffer, options);

      const baseName = file.name.replace(/\.pdf$/i, "");
      downloadPdf(outBytes, `${baseName}-headers.pdf`);

      let appliedCount = totalPages;
      if (pageSelection === "first" || pageSelection === "last") appliedCount = 1;
      else if (pageSelection === "odd") appliedCount = Math.ceil(totalPages / 2);
      else if (pageSelection === "even") appliedCount = Math.floor(totalPages / 2);
      else if (pageSelection === "custom" && customPageRange) {
        appliedCount = parsePageRange(customPageRange, totalPages).size;
      }

      setMessage(
        `Success! Applied across ${appliedCount} page${
          appliedCount === 1 ? "" : "s"
        }. Your file was downloaded directly.`
      );
    } catch (err: any) {
      console.error(err);
      setError("Failed to apply headers and footers. Check that the PDF is not password protected.");
    } finally {
      setBusy(false);
    }
  };

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
            <p className="eyebrow">Edit &amp; Modify PDF</p>
            <h1>Headers &amp; Footers</h1>
            <p className="description">
              Apply consistent text across your document. Easily add page numbers, titles, or dates.
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
                  onClick={() => setFile(null)}
                >
                  Choose another file
                </button>
              </div>

              <div className="watermark-workspace-grid">
                <div className="watermark-controls-panel">
                  
                  {/* Mode Tabs: Header vs Footer */}
                  <div className="wm-tabs-nav" role="tablist">
                    <button
                      type="button"
                      className={`wm-tab-btn ${activeTab === "header" ? "active" : ""}`}
                      onClick={() => setActiveTab("header")}
                    >
                      <span className="tab-icon">▔</span> Header
                    </button>
                    <button
                      type="button"
                      className={`wm-tab-btn ${activeTab === "footer" ? "active" : ""}`}
                      onClick={() => setActiveTab("footer")}
                    >
                      <span className="tab-icon">_</span> Footer
                    </button>
                  </div>

                  {activeTab === "header" && (
                    <>
                      <div className="wm-form-group">
                        <label className="wm-label">Header Content</label>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          <input className="wm-text-input" placeholder="Top Left (e.g., Company Name)" value={topLeft} onChange={(e) => setTopLeft(e.target.value)} />
                          <input className="wm-text-input" placeholder="Top Center" value={topCenter} onChange={(e) => setTopCenter(e.target.value)} />
                          <input className="wm-text-input" placeholder="Top Right (e.g., Date)" value={topRight} onChange={(e) => setTopRight(e.target.value)} />
                        </div>
                      </div>

                      <div className="wm-form-grid-2">
                        <div className="wm-form-group">
                          <label className="wm-label">Font Family</label>
                          <select className="wm-select" value={headerFontFamily} onChange={(e) => setHeaderFontFamily(e.target.value as WatermarkFontFamily)}>
                            <option value="Helvetica">Helvetica</option>
                            <option value="TimesRoman">Times New Roman</option>
                            <option value="Courier">Courier</option>
                          </select>
                        </div>
                        <div className="wm-form-group">
                          <label className="wm-label">Font Style</label>
                          <select className="wm-select" value={headerFontStyle} onChange={(e) => setHeaderFontStyle(e.target.value as WatermarkFontStyle)}>
                            <option value="regular">Regular</option>
                            <option value="bold">Bold</option>
                            <option value="italic">Italic</option>
                          </select>
                        </div>
                      </div>

                      <div className="wm-form-grid-2">
                        <div className="wm-form-group">
                          <div className="wm-label-row">
                            <label className="wm-label">Font Size</label>
                            <span className="wm-val-badge">{headerFontSize} pt</span>
                          </div>
                          <input type="range" className="wm-slider" min="6" max="72" value={headerFontSize} onChange={(e) => setHeaderFontSize(Number(e.target.value))} />
                        </div>
                        <div className="wm-form-group">
                          <label className="wm-label">Color</label>
                          <div className="wm-color-swatches" style={{ marginTop: 8 }}>
                            {COLOR_PALETTE.map((c) => (
                              <button key={c.hex} type="button" className={`wm-swatch ${headerColorHex === c.hex ? "active" : ""}`} style={{ backgroundColor: c.hex }} onClick={() => setHeaderColorHex(c.hex)} title={c.label} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {activeTab === "footer" && (
                    <>
                      <div className="wm-form-group">
                        <label className="wm-label">Footer Content</label>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          <input className="wm-text-input" placeholder="Bottom Left" value={bottomLeft} onChange={(e) => setBottomLeft(e.target.value)} />
                          <input className="wm-text-input" placeholder="Bottom Center (e.g., Page {page} of {total})" value={bottomCenter} onChange={(e) => setBottomCenter(e.target.value)} />
                          <input className="wm-text-input" placeholder="Bottom Right" value={bottomRight} onChange={(e) => setBottomRight(e.target.value)} />
                        </div>
                        <span className="wm-label-hint" style={{ marginTop: 8, display: "block" }}>Use <strong>{"{page}"}</strong> and <strong>{"{total}"}</strong> for numbering.</span>
                      </div>

                      <div className="wm-form-grid-2">
                        <div className="wm-form-group">
                          <label className="wm-label">Font Family</label>
                          <select className="wm-select" value={footerFontFamily} onChange={(e) => setFooterFontFamily(e.target.value as WatermarkFontFamily)}>
                            <option value="Helvetica">Helvetica</option>
                            <option value="TimesRoman">Times New Roman</option>
                            <option value="Courier">Courier</option>
                          </select>
                        </div>
                        <div className="wm-form-group">
                          <label className="wm-label">Font Style</label>
                          <select className="wm-select" value={footerFontStyle} onChange={(e) => setFooterFontStyle(e.target.value as WatermarkFontStyle)}>
                            <option value="regular">Regular</option>
                            <option value="bold">Bold</option>
                            <option value="italic">Italic</option>
                          </select>
                        </div>
                      </div>

                      <div className="wm-form-grid-2">
                        <div className="wm-form-group">
                          <div className="wm-label-row">
                            <label className="wm-label">Font Size</label>
                            <span className="wm-val-badge">{footerFontSize} pt</span>
                          </div>
                          <input type="range" className="wm-slider" min="6" max="72" value={footerFontSize} onChange={(e) => setFooterFontSize(Number(e.target.value))} />
                        </div>
                        <div className="wm-form-group">
                          <label className="wm-label">Color</label>
                          <div className="wm-color-swatches" style={{ marginTop: 8 }}>
                            {COLOR_PALETTE.map((c) => (
                              <button key={c.hex} type="button" className={`wm-swatch ${footerColorHex === c.hex ? "active" : ""}`} style={{ backgroundColor: c.hex }} onClick={() => setFooterColorHex(c.hex)} title={c.label} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

                  <div className="wm-form-group">
                    <div className="wm-label-row">
                      <label className="wm-label">Margins (Top/Bottom &amp; Sides)</label>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <input type="number" className="wm-text-input" min="0" value={marginTop} onChange={(e) => { setMarginTop(Number(e.target.value)); setMarginBottom(Number(e.target.value)); }} style={{ flex: 1 }} />
                      <input type="number" className="wm-text-input" min="0" value={marginX} onChange={(e) => setMarginX(Number(e.target.value))} style={{ flex: 1 }} />
                    </div>
                  </div>

                  <div className="wm-form-group">
                    <label className="wm-label">Pages to Apply</label>
                    <select
                      className="wm-select"
                      value={pageSelection}
                      onChange={(e) => setPageSelection(e.target.value as WatermarkPageSelection)}
                    >
                      <option value="all">All Pages</option>
                      <option value="first">First Page Only</option>
                      <option value="last">Last Page Only</option>
                      <option value="odd">Odd Pages Only</option>
                      <option value="even">Even Pages Only</option>
                      <option value="custom">Custom Range...</option>
                    </select>

                    {pageSelection === "custom" && (
                      <input
                        type="text"
                        className="wm-text-input"
                        style={{ marginTop: 8 }}
                        placeholder="e.g. 1-5, 8, 11-13"
                        value={customPageRange}
                        onChange={(e) => setCustomPageRange(e.target.value)}
                      />
                    )}
                  </div>

                  {error && <div className="wm-error-callout">{error}</div>}
                  {message && <div className="wm-success-callout">{message}</div>}

                  <button
                    type="button"
                    className="download-button"
                    onClick={() => void handleApply()}
                    disabled={busy}
                    style={{ width: "100%", marginTop: 16 }}
                  >
                    {busy ? "Processing..." : "Apply Headers & Footers ↓"}
                  </button>
                </div>

                {/* RIGHT: Live Preview Canvas */}
                <div className="watermark-preview-panel">
                  <div className="wm-preview-toolbar">
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <button
                        type="button"
                        className="reset-button"
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      >
                        ‹ Prev
                      </button>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        type="button"
                        className="reset-button"
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      >
                        Next ›
                      </button>
                    </div>

                    <select
                      className="wm-select"
                      style={{ width: "auto", padding: "4px 8px" }}
                      value={previewZoom}
                      onChange={(e) => setPreviewZoom(Number(e.target.value))}
                    >
                      <option value="0.5">50% Zoom</option>
                      <option value="0.75">75% Zoom</option>
                      <option value="1.0">100% Zoom</option>
                      <option value="1.25">125% Zoom</option>
                    </select>
                  </div>

                  <div className="wm-canvas-scroll-container">
                    <div className="wm-canvas-wrapper">
                      <canvas ref={baseCanvasRef} style={{ display: "block", width: "100%" }} />
                      <canvas
                        ref={overlayCanvasRef}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          pointerEvents: "none",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
