"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { downloadPdf } from "../lib/pdf";
import { loadPdf } from "../lib/pdfjs";
import { flattenFormsPdf } from "../lib/pdf-security";
import { PDFDocument } from "pdf-lib";

type FlattenMode = "forms" | "rasterize";

export function FlattenWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<FlattenMode>("forms");
  const [dpiScale, setDpiScale] = useState<number>(2.0); // 2.0 is roughly 144 DPI (assuming base 72 DPI)
  
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const handleApply = async () => {
    if (!file) return;
    setBusy(true);
    setMessage("");
    setError("");

    try {
      const buffer = await file.arrayBuffer();
      let outBytes: Uint8Array;

      if (mode === "forms") {
        outBytes = await flattenFormsPdf(buffer);
      } else {
        outBytes = await rasterizePdf(file, dpiScale);
      }

      const baseName = file.name.replace(/\.pdf$/i, "");
      const suffix = mode === "forms" ? "flattened-forms" : "rasterized";
      downloadPdf(outBytes, `${baseName}-${suffix}.pdf`);

      setMessage("Success! Your flattened file was downloaded directly.");
    } catch (err: any) {
      console.error(err);
      setError("Failed to flatten PDF. Check that the file is not password protected.");
    } finally {
      setBusy(false);
    }
  };

  const rasterizePdf = async (pdfFile: File, scale: number): Promise<Uint8Array> => {
    const doc = await loadPdf(pdfFile);
    const pdfDoc = await PDFDocument.create();

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      
      if (ctx) {
        // Draw white background
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Render PDF page to canvas
        await page.render({ canvasContext: ctx, viewport }).promise;
        
        // Export to JPEG
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
        if (blob) {
          const imageBytes = await blob.arrayBuffer();
          const image = await pdfDoc.embedJpg(imageBytes);
          
          // PDF uses 72 DPI coordinate system natively. 
          // We scale the image back to the original physical dimensions of the page.
          const physicalWidth = viewport.width / scale;
          const physicalHeight = viewport.height / scale;
          
          const pdfPage = pdfDoc.addPage([physicalWidth, physicalHeight]);
          pdfPage.drawImage(image, {
            x: 0,
            y: 0,
            width: physicalWidth,
            height: physicalHeight,
          });
        }
      }
    }

    return pdfDoc.save({ useObjectStreams: true });
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
            <p className="eyebrow">Optimize &amp; Extract</p>
            <h1>Flatten PDF</h1>
            <p className="description">
              Burn interactive forms into static text, or permanently rasterize the entire document into an uneditable image layer.
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
            <div className="watermark-studio-container" style={{ maxWidth: 700, margin: "0 auto" }}>
              <div className="watermark-file-banner" style={{ marginBottom: 24 }}>
                <div className="file-info-group">
                  <span className="file-type-badge">PDF</span>
                  <div>
                    <strong>{file.name}</strong>
                    <span className="file-subtext">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
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

              <div className="wm-form-group" style={{ backgroundColor: "var(--surface)", padding: 24, borderRadius: 12, border: "1px solid var(--border)" }}>
                <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>Choose Flattening Mode</h3>
                
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <label style={{ display: "flex", gap: 12, cursor: "pointer", alignItems: "flex-start" }}>
                    <input 
                      type="radio" 
                      name="flattenMode" 
                      checked={mode === "forms"} 
                      onChange={() => setMode("forms")}
                      style={{ marginTop: 4 }}
                    />
                    <div>
                      <strong style={{ display: "block", color: "var(--text)" }}>Forms &amp; Annotations Only (Vector Preserved)</strong>
                      <span style={{ color: "var(--text-muted)", fontSize: 13, display: "block", marginTop: 4 }}>
                        Burns interactive form fields and annotations into the page permanently. The document remains fully searchable, text can be highlighted and copied, and file size remains small.
                      </span>
                    </div>
                  </label>

                  <label style={{ display: "flex", gap: 12, cursor: "pointer", alignItems: "flex-start" }}>
                    <input 
                      type="radio" 
                      name="flattenMode" 
                      checked={mode === "rasterize"} 
                      onChange={() => setMode("rasterize")}
                      style={{ marginTop: 4 }}
                    />
                    <div>
                      <strong style={{ display: "block", color: "var(--text)" }}>Total Image Rasterization (Absolute Security)</strong>
                      <span style={{ color: "var(--text-muted)", fontSize: 13, display: "block", marginTop: 4 }}>
                        Converts every page into a high-resolution image and creates a new PDF. Guarantees hidden layers, metadata, scripts, and fonts are completely destroyed. Text will no longer be selectable.
                      </span>
                    </div>
                  </label>
                </div>

                {mode === "rasterize" && (
                  <div style={{ marginTop: 24, padding: 16, backgroundColor: "rgba(0,0,0,0.03)", borderRadius: 8 }}>
                    <div className="wm-label-row">
                      <label className="wm-label" style={{ marginBottom: 0 }}>Rasterization Quality (DPI Scale)</label>
                      <span className="wm-val-badge">{Math.round(dpiScale * 72)} DPI</span>
                    </div>
                    <input 
                      type="range" 
                      className="wm-slider" 
                      min="1.0" 
                      max="4.0" 
                      step="0.5" 
                      value={dpiScale} 
                      onChange={(e) => setDpiScale(Number(e.target.value))} 
                      style={{ marginTop: 12 }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                      <span>Draft (72 DPI)</span>
                      <span>High (300 DPI)</span>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 12, marginBottom: 0 }}>
                      <strong>Note:</strong> Higher DPI results in sharper text but significantly larger file sizes and longer processing times.
                    </p>
                  </div>
                )}
              </div>

              {error && <div className="wm-error-callout" style={{ marginTop: 16 }}>{error}</div>}
              {message && <div className="wm-success-callout" style={{ marginTop: 16 }}>{message}</div>}

              <button
                type="button"
                className="download-button"
                onClick={() => void handleApply()}
                disabled={busy}
                style={{ width: "100%", marginTop: 24, padding: "14px 20px", fontSize: 15 }}
              >
                {busy ? "Processing... (This may take a while for rasterization)" : "Flatten PDF ↓"}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
