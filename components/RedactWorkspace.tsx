"use client";

import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { downloadPdf } from "../lib/pdf";
import { loadPdf } from "../lib/pdfjs";
import {
  applyAdvancedRedactPdf,
  RedactionItem,
} from "../lib/pdf-security";

const SENSITIVE_PATTERNS = [
  {
    id: "email",
    label: "Email Addresses",
    icon: "📧",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
    id: "phone",
    label: "Phone Numbers",
    icon: "📞",
    regex: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  },
  {
    id: "ssn",
    label: "SSN / ID Numbers",
    icon: "💳",
    regex: /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/g,
  },
  {
    id: "currency",
    label: "Dollar Amounts",
    icon: "💲",
    regex: /\$\s?\d+(?:,\d{3})*(?:\.\d{2})?/g,
  },
];

export function RedactWorkspace() {
  const [activeTab, setActiveTab] = useState<"visual" | "search">("visual");
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoomScale, setZoomScale] = useState<number>(1.25);

  // Redaction Items Queue
  const [redactions, setRedactions] = useState<RedactionItem[]>([]);
  const [redactColor, setRedactColor] = useState<"black" | "white" | "gray">("black");
  const [redactLabel, setRedactLabel] = useState<string>("[REDACTED]");
  const [applyLabel, setApplyLabel] = useState<boolean>(true);

  // Search & Auto-Redact State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [caseSensitive, setCaseSensitive] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Interactive Drawing State
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Canvas Refs & Render State
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const [pageViewport, setPageViewport] = useState<any | null>(null);

  // Processing & Feedback State
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Load PDF Document
  useEffect(() => {
    if (!file) {
      setPdfDoc(null);
      setTotalPages(0);
      setCurrentPage(1);
      setRedactions([]);
      setMessage("");
      setError("");
      return;
    }

    let isMounted = true;
    const loadDocument = async () => {
      setIsProcessing(true);
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
        setError("Could not read PDF document. Please check the file.");
      } finally {
        if (isMounted) setIsProcessing(false);
      }
    };

    void loadDocument();

    return () => {
      isMounted = false;
    };
  }, [file]);

  // Render Current PDF Page onto Canvas (ONLY when doc, page, or zoomScale changes)
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !overlayRef.current) return;

    let isMounted = true;
    const renderPage = async () => {
      try {
        // Cancel any pending render task to prevent canvas collision/clearing
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            // Ignore cancellation
          }
          renderTaskRef.current = null;
        }

        const page = await pdfDoc.getPage(currentPage);
        if (!isMounted) return;

        const viewport = page.getViewport({ scale: zoomScale });
        setPageViewport(viewport);
        const canvas = canvasRef.current;
        const overlay = overlayRef.current;
        if (!canvas || !overlay) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        overlay.width = viewport.width;
        overlay.height = viewport.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (!isMounted) return;
        renderTaskRef.current = null;

        // Repaint overlays once canvas is stable
        drawOverlays();
      } catch (err: any) {
        if (err?.name === "RenderingCancelledException") {
          return;
        }
        console.error("Page render error:", err);
      }
    };

    void renderPage();

    return () => {
      isMounted = false;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // Ignore
        }
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, currentPage, zoomScale]);

  // Draw Existing Redactions and Active Drag Box on Overlay Canvas (isolated from PDF canvas)
  const drawOverlays = () => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    const cWidth = overlay.width;
    const cHeight = overlay.height;
    const scale = zoomScale;

    ctx.clearRect(0, 0, cWidth, cHeight);

    // Draw saved redactions for current page
    const pageIndex = currentPage - 1;
    const pageItems = redactions.filter((r) => r.pageIndex === pageIndex);

    for (const item of pageItems) {
      let clientX, clientY, clientW, clientH;
      
      if (pageViewport) {
        const [x1, y1, x2, y2] = pageViewport.convertToViewportRectangle([item.x, item.y, item.x + item.width, item.y + item.height]);
        clientX = Math.min(x1, x2);
        clientY = Math.min(y1, y2);
        clientW = Math.abs(x2 - x1);
        clientH = Math.abs(y2 - y1);
      } else {
        // Fallback
        clientX = item.x * scale;
        clientY = cHeight - (item.y + item.height) * scale;
        clientW = item.width * scale;
        clientH = item.height * scale;
      }

      ctx.fillStyle =
        item.color === "white"
          ? "rgba(255, 255, 255, 0.95)"
          : item.color === "gray"
          ? "rgba(80, 80, 80, 0.95)"
          : "rgba(0, 0, 0, 0.95)";
      ctx.fillRect(clientX, clientY, clientW, clientH);

      ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(clientX, clientY, clientW, clientH);

      if (item.label && clientW > 30 && clientH > 10) {
        ctx.fillStyle = item.color === "white" ? "#000000" : "#ffffff";
        ctx.font = `bold ${Math.max(9, Math.min(13, clientH * 0.5))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.label, clientX + clientW / 2, clientY + clientH / 2);
      }
    }

    // Draw active drawing box
    if (currentBox && currentBox.width > 0 && currentBox.height > 0) {
      ctx.fillStyle =
        redactColor === "white"
          ? "rgba(255, 255, 255, 0.7)"
          : redactColor === "gray"
          ? "rgba(80, 80, 80, 0.7)"
          : "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(currentBox.x, currentBox.y, currentBox.width, currentBox.height);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(currentBox.x, currentBox.y, currentBox.width, currentBox.height);
      ctx.setLineDash([]);
    }
  };

  // Re-draw overlays whenever redactions, currentBox, or styling changes
  useEffect(() => {
    drawOverlays();
  }, [redactions, currentBox, currentPage, zoomScale, redactColor, redactLabel, applyLabel, pageViewport]);

  // Pointer Down: Start Drawing Box
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (overlay.width / rect.width);
    const y = (e.clientY - rect.top) * (overlay.height / rect.height);

    setIsDrawing(true);
    setDrawStart({ x, y });
    setCurrentBox({ x, y, width: 0, height: 0 });
  };

  // Pointer Move: Update Drawing Box
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !drawStart || !overlayRef.current) return;
    const overlay = overlayRef.current;
    const rect = overlay.getBoundingClientRect();
    const currentX = (e.clientX - rect.left) * (overlay.width / rect.width);
    const currentY = (e.clientY - rect.top) * (overlay.height / rect.height);

    const x = Math.min(drawStart.x, currentX);
    const y = Math.min(drawStart.y, currentY);
    const width = Math.abs(currentX - drawStart.x);
    const height = Math.abs(currentY - drawStart.y);

    setCurrentBox({ x, y, width, height });
  };

  // Pointer Up: Commit Redaction
  const handlePointerUp = () => {
    if (!isDrawing || !currentBox || !overlayRef.current) {
      setIsDrawing(false);
      setDrawStart(null);
      setCurrentBox(null);
      return;
    }

    const overlay = overlayRef.current;
    const scale = zoomScale;

    // Minimum size check (5px)
    if (currentBox.width >= 5 && currentBox.height >= 5) {
      // Convert canvas pixels to PDF points
      let pdfX, pdfY, pdfW, pdfH;
      if (pageViewport) {
        const pt1 = pageViewport.convertToPdfPoint(currentBox.x, currentBox.y);
        const pt2 = pageViewport.convertToPdfPoint(currentBox.x + currentBox.width, currentBox.y + currentBox.height);
        pdfX = Math.min(pt1[0], pt2[0]);
        pdfY = Math.min(pt1[1], pt2[1]);
        pdfW = Math.abs(pt2[0] - pt1[0]);
        pdfH = Math.abs(pt2[1] - pt1[1]);
      } else {
        pdfX = currentBox.x / scale;
        pdfY = (overlay.height - (currentBox.y + currentBox.height)) / scale;
        pdfW = currentBox.width / scale;
        pdfH = currentBox.height / scale;
      }

      const newItem: RedactionItem = {
        id: `redact-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        pageIndex: currentPage - 1,
        x: Math.round(pdfX),
        y: Math.round(pdfY),
        width: Math.round(pdfW),
        height: Math.round(pdfH),
        color: redactColor,
        label: applyLabel ? redactLabel : undefined,
        reason: "Manual Area Selection",
      };

      setRedactions((prev) => [...prev, newItem]);
    }

    setIsDrawing(false);
    setDrawStart(null);
    setCurrentBox(null);
  };

  // Search Text & Auto-Redact Pattern or Keyword
  const executeSearch = async (patternRegex?: RegExp, patternName?: string) => {
    if (!pdfDoc) return;
    setIsSearching(true);
    setError("");
    setMessage("");

    try {
      const addedItems: RedactionItem[] = [];
      const queryRegex =
        patternRegex ||
        (searchQuery.trim()
          ? new RegExp(
              searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              caseSensitive ? "g" : "gi"
            )
          : null);

      if (!queryRegex) {
        setError("Please enter a search query or choose a sensitive pattern.");
        return;
      }

      for (let pNum = 1; pNum <= totalPages; pNum++) {
        const page = await pdfDoc.getPage(pNum);
        const textContent = await page.getTextContent();

        for (const item of textContent.items) {
          if (!("str" in item) || !item.str) continue;
          const text = item.str;

          queryRegex.lastIndex = 0;
          let match;
          while ((match = queryRegex.exec(text)) !== null) {
            const tx = item.transform ? item.transform[4] : 0;
            const ty = item.transform ? item.transform[5] : 0;
            const itemWidth = item.width || 40;
            const itemHeight = item.height || 14;

            // Approximate the x-coordinate and width of the matched word
            const charWidth = itemWidth / Math.max(1, text.length);
            const matchX = tx + (match.index * charWidth);
            const matchWidth = match[0].length * charWidth;

            addedItems.push({
              id: `auto-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              pageIndex: pNum - 1,
              x: Math.max(0, Math.round(matchX - 2)),
              y: Math.max(0, Math.round(ty - 2)),
              width: Math.round(matchWidth + 4),
              height: Math.round(Math.max(12, itemHeight) + 4),
              color: redactColor,
              label: applyLabel ? redactLabel : undefined,
              reason: patternName || `Matched "${searchQuery}"`,
            });

            if (!queryRegex.global) break;
          }
        }
      }

      if (addedItems.length === 0) {
        setMessage("No occurrences found matching your search query.");
      } else {
        setRedactions((prev) => [...prev, ...addedItems]);
        setMessage(`Found and queued ${addedItems.length} redaction area${addedItems.length === 1 ? "" : "s"}.`);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to search text within the document.");
    } finally {
      setIsSearching(false);
    }
  };

  // Apply Permanent Redactions & Download
  const handleApplyRedactions = async () => {
    if (!file) return;
    if (redactions.length === 0) {
      setError("Please draw at least one redaction area or use Search & Auto-Redact.");
      return;
    }

    setIsProcessing(true);
    setError("");
    setMessage("");

    try {
      const buffer = await file.arrayBuffer();
      const outputBytes = await applyAdvancedRedactPdf(buffer, redactions);

      const baseName = file.name.replace(/\.pdf$/i, "");
      downloadPdf(outputBytes, `${baseName}-redacted.pdf`);

      setMessage(
        `Success! Applied ${redactions.length} permanent redaction${
          redactions.length === 1 ? "" : "s"
        }. Your scrubbed PDF was downloaded directly to your computer.`
      );
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to redact PDF. Please check the document.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPdfDoc(null);
    setPageViewport(null);
    setTotalPages(0);
    setCurrentPage(1);
    setRedactions([]);
    setSearchQuery("");
    setMessage("");
    setError("");
  };

  const currentPageRedactionsCount = redactions.filter(
    (r) => r.pageIndex === currentPage - 1
  ).length;

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
            <p className="eyebrow">PDF Security &amp; Protection</p>
            <h1>PDF Redaction Studio</h1>
            <p className="description">
              Permanently black out sensitive text, confidential numbers, and images with true irreversible redaction. 100% client-side privacy.
            </p>
          </div>

          <div className="password-studio-container">
            {/* Mode Navigation Tabs */}
            <div className="pwd-tabs-nav" role="tablist">
              <button
                type="button"
                className={`pwd-tab-btn ${activeTab === "visual" ? "active" : ""}`}
                onClick={() => {
                  setActiveTab("visual");
                  setMessage("");
                  setError("");
                }}
              >
                <span className="tab-icon">✎</span> Visual Area Redact
              </button>
              <button
                type="button"
                className={`pwd-tab-btn ${activeTab === "search" ? "active" : ""}`}
                onClick={() => {
                  setActiveTab("search");
                  setMessage("");
                  setError("");
                }}
              >
                <span className="tab-icon">🔍</span> Search &amp; Auto-Redact
              </button>
            </div>

            {/* Upload Zone */}
            {!file ? (
              <label
                className="upload-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f && (f.type.includes("pdf") || f.name.toLowerCase().endsWith(".pdf"))) {
                    setFile(f);
                  }
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
                <span className="upload-icon">■</span>
                <strong>Drop PDF to redact sensitive content</strong>
                <span className="upload-hint">
                  or click to browse · processed locally in your browser
                </span>
              </label>
            ) : (
              <div className="pwd-workspace-card">
                {/* File Details Banner */}
                <div className="pwd-file-banner">
                  <div className="file-info-group">
                    <span className="file-type-badge badge-pdf">PDF</span>
                    <div>
                      <strong>{file.name}</strong>
                      <span className="file-subtext">
                        {(file.size / 1024 / 1024).toFixed(2)} MB · {totalPages} Page
                        {totalPages === 1 ? "" : "s"}
                        {redactions.length > 0 && ` · ${redactions.length} Redaction(s) Queued`}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="reset-button"
                    onClick={handleReset}
                    disabled={isProcessing}
                  >
                    Choose another file
                  </button>
                </div>

                <div className="pwd-form-body">
                  {/* Style & Label Options */}
                  <div className="pwd-section">
                    <h3>Redaction Style &amp; Appearance</h3>
                    <div className="pwd-grid-2">
                      <div className="pwd-field-group">
                        <label className="pwd-label">Fill Color</label>
                        <select
                          className="pwd-select"
                          value={redactColor}
                          onChange={(e) => setRedactColor(e.target.value as any)}
                        >
                          <option value="black">Solid Black (Standard / Recommended)</option>
                          <option value="white">Solid White (Clean Blankout)</option>
                          <option value="gray">Dark Charcoal Gray</option>
                        </select>
                      </div>

                      <div className="pwd-field-group">
                        <label className="pwd-label">Overlay Label</label>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="text"
                            className="pwd-text-input"
                            value={redactLabel}
                            onChange={(e) => setRedactLabel(e.target.value)}
                            placeholder="e.g. [REDACTED]"
                            disabled={!applyLabel}
                          />
                          <label className="pwd-checkbox-label" style={{ whiteSpace: "nowrap" }}>
                            <input
                              type="checkbox"
                              checked={applyLabel}
                              onChange={(e) => setApplyLabel(e.target.checked)}
                            />
                            <span>Print Label</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* SEARCH & AUTO-REDACT TAB CONTENT */}
                  {activeTab === "search" && (
                    <div className="pwd-section">
                      <h3>Search &amp; Auto-Detect Sensitive Data</h3>
                      <p className="pwd-section-desc">
                        Scan the entire document to automatically find and queue redactions for sensitive patterns or exact keywords.
                      </p>

                      {/* Pattern Preset Buttons */}
                      <div className="perm-profile-grid">
                        {SENSITIVE_PATTERNS.map((pattern) => (
                          <button
                            key={pattern.id}
                            type="button"
                            className="perm-chip"
                            disabled={isSearching}
                            onClick={() => executeSearch(pattern.regex, pattern.label)}
                          >
                            <strong>
                              {pattern.icon} {pattern.label}
                            </strong>
                            <span>Scan document &amp; redact</span>
                          </button>
                        ))}
                      </div>

                      {/* Custom Keyword Search */}
                      <div style={{ marginTop: 14 }}>
                        <label className="pwd-label">Custom Keyword / Name / Phrase</label>
                        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                          <input
                            type="text"
                            className="pwd-text-input"
                            placeholder="Enter text to search (e.g. Confidential, John Doe, Account #)"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") executeSearch();
                            }}
                          />
                          <button
                            type="button"
                            className="download-button"
                            style={{ whiteSpace: "nowrap", padding: "10px 18px" }}
                            onClick={() => executeSearch()}
                            disabled={isSearching || !searchQuery.trim()}
                          >
                            {isSearching ? "Searching…" : "Search & Redact"}
                          </button>
                        </div>
                        <label className="pwd-checkbox-label" style={{ marginTop: 8 }}>
                          <input
                            type="checkbox"
                            checked={caseSensitive}
                            onChange={(e) => setCaseSensitive(e.target.checked)}
                          />
                          <span>Match exact case</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* VISUAL PAGE CANVAS VIEWER */}
                  <div className="pwd-section">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <h3>Visual Canvas (Page {currentPage} of {totalPages})</h3>
                        <p className="pwd-section-desc" style={{ margin: 0 }}>
                          Click and drag your mouse directly on the page to draw a redaction box.
                        </p>
                      </div>

                      {/* Page Navigation & Zoom Toolbar */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          type="button"
                          className="reset-button"
                          disabled={currentPage <= 1}
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        >
                          ‹ Previous
                        </button>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                          {currentPage} / {totalPages}
                        </span>
                        <button
                          type="button"
                          className="reset-button"
                          disabled={currentPage >= totalPages}
                          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Next ›
                        </button>
                        <select
                          className="pwd-select"
                          style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
                          value={zoomScale}
                          onChange={(e) => setZoomScale(Number(e.target.value))}
                        >
                          <option value="0.75">75% Zoom</option>
                          <option value="1.0">100% Zoom</option>
                          <option value="1.25">125% Zoom</option>
                          <option value="1.5">150% Zoom</option>
                        </select>
                      </div>
                    </div>

                    {/* Interactive Canvas Container */}
                    <div
                      style={{
                        position: "relative",
                        background: "var(--bg)",
                        border: "1px solid var(--line)",
                        borderRadius: 10,
                        padding: 16,
                        display: "flex",
                        justifyContent: "center",
                        overflow: "auto",
                        maxHeight: 620,
                        marginTop: 10,
                      }}
                    >
                      <div
                        style={{
                          position: "relative",
                          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                          cursor: "crosshair",
                          lineHeight: 0,
                        }}
                      >
                        <canvas ref={canvasRef} style={{ display: "block" }} />
                        <canvas
                          ref={overlayRef}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: "100%",
                            touchAction: "none",
                          }}
                          onPointerDown={(e) => {
                            try {
                              (e.target as HTMLElement).setPointerCapture(e.pointerId);
                            } catch {
                              // Ignore
                            }
                            handlePointerDown(e);
                          }}
                          onPointerMove={handlePointerMove}
                          onPointerUp={(e) => {
                            try {
                              (e.target as HTMLElement).releasePointerCapture(e.pointerId);
                            } catch {
                              // Ignore
                            }
                            handlePointerUp();
                          }}
                          onPointerCancel={handlePointerUp}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Queued Redactions Summary */}
                  {redactions.length > 0 && (
                    <div className="pwd-section">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h3>Queued Redactions ({redactions.length})</h3>
                        <button
                          type="button"
                          className="reset-button"
                          onClick={() => setRedactions([])}
                          style={{ color: "var(--coral)" }}
                        >
                          Clear all redactions
                        </button>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          maxHeight: 160,
                          overflowY: "auto",
                          padding: 10,
                          background: "var(--bg)",
                          borderRadius: 8,
                          border: "1px solid var(--line)",
                        }}
                      >
                        {redactions.map((item, idx) => (
                          <div
                            key={item.id}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 11,
                              padding: "4px 8px",
                              borderRadius: 6,
                              background: "var(--surface)",
                              border: "1px solid var(--line)",
                            }}
                          >
                            <strong>#{idx + 1}</strong>
                            <span>Page {item.pageIndex + 1}</span>
                            <span style={{ color: "var(--muted)" }}>({item.width}×{item.height}pt)</span>
                            {item.reason && (
                              <span style={{ color: "var(--accent)" }}>[{item.reason}]</span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setRedactions((prev) => prev.filter((r) => r.id !== item.id))
                              }
                              style={{
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                color: "var(--coral)",
                                fontWeight: "bold",
                                padding: "0 2px",
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Execution Button */}
                  <div className="pwd-action-box">
                    <button
                      type="button"
                      className="download-button"
                      onClick={handleApplyRedactions}
                      disabled={isProcessing || redactions.length === 0}
                    >
                      {isProcessing
                        ? "Applying Permanent Redactions..."
                        : `Apply ${redactions.length} Permanent Redaction${
                            redactions.length === 1 ? "" : "s"
                          } & Download PDF ↓`}
                    </button>
                  </div>
                </div>

                {/* Status Messages */}
                {message && (
                  <div className="pwd-notice-banner success" style={{ margin: "0 24px 24px" }}>
                    <span className="notice-icon">✓</span>
                    <div>
                      <strong>Success</strong>
                      <p>{message}</p>
                    </div>
                  </div>
                )}
                {error && (
                  <div className="pwd-notice-banner warning" style={{ margin: "0 24px 24px" }}>
                    <span className="notice-icon">⚠️</span>
                    <div>
                      <strong>Notice</strong>
                      <p>{error}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <footer className="footer">
          <span>✦ Built for privacy</span>
          <span>Everything happens locally in your browser</span>
        </footer>
      </main>
    </div>
  );
}
