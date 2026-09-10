"use client";

import { useEffect, useRef, useState } from "react";
import { convertElementsToPdf } from "./shared";

type PageSize = "a4" | "letter" | "full";
type Orientation = "portrait" | "landscape";
type InputTab = "upload" | "paste";

const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice Summary</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1e293b;
      line-height: 1.5;
      padding: 32px;
      margin: 0;
      background: #ffffff;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .brand {
      font-size: 24px;
      font-weight: 800;
      color: #0284c7;
      letter-spacing: -0.5px;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      background: #e0f2fe;
      color: #0369a1;
      font-size: 13px;
      font-weight: 700;
      border-radius: 9999px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .meta-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
    }
    .meta-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 4px;
    }
    .meta-val {
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 16px;
      margin-bottom: 24px;
    }
    th, td {
      border: 1px solid #e2e8f0;
      padding: 12px 16px;
      text-align: left;
    }
    th {
      background: #f1f5f9;
      font-size: 13px;
      font-weight: 700;
      color: #334155;
      text-transform: uppercase;
    }
    tr:nth-child(even) {
      background: #f8fafc;
    }
    .total-row {
      font-weight: 700;
      background: #f1f5f9 !important;
    }
    .footer-note {
      font-size: 13px;
      color: #64748b;
      text-align: center;
      margin-top: 32px;
      border-top: 1px solid #e2e8f0;
      padding-top: 16px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">Acme Cloud Solutions</div>
    <span class="badge">PAID IN FULL</span>
  </div>

  <div class="meta-grid">
    <div class="meta-card">
      <div class="meta-label">Billed To</div>
      <div class="meta-val">Globex Corporation</div>
      <div style="font-size: 13px; color: #475569;">100 Enterprise Way, Suite 400<br>San Francisco, CA 94105</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Invoice Details</div>
      <div class="meta-val">Invoice #INV-2026-089</div>
      <div style="font-size: 13px; color: #475569;">Date: September 10, 2026<br>Payment Method: Corporate Credit Card</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th style="width: 80px; text-align: center;">Qty</th>
        <th style="width: 120px; text-align: right;">Rate</th>
        <th style="width: 120px; text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Dedicated GPU Inference Cluster (Month 9)</td>
        <td style="text-align: center;">1</td>
        <td style="text-align: right;">$2,400.00</td>
        <td style="text-align: right;">$2,400.00</td>
      </tr>
      <tr>
        <td>High-Speed Local PDF Conversion Engine Setup</td>
        <td style="text-align: center;">1</td>
        <td style="text-align: right;">$1,150.00</td>
        <td style="text-align: right;">$1,150.00</td>
      </tr>
      <tr>
        <td>24/7 Priority SLA & Support Tier</td>
        <td style="text-align: center;">1</td>
        <td style="text-align: right;">$450.00</td>
        <td style="text-align: right;">$450.00</td>
      </tr>
      <tr class="total-row">
        <td colspan="3" style="text-align: right;">Total Amount:</td>
        <td style="text-align: right; color: #0284c7; font-size: 16px;">$4,000.00</td>
      </tr>
    </tbody>
  </table>

  <div class="footer-note">
    Thank you for your business! All documents are rendered locally with 100% privacy and zero tracking.
  </div>
</body>
</html>`;

export function HtmlConverter() {
  const [tab, setTab] = useState<InputTab>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [iframeHeight, setIframeHeight] = useState<number>(600);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // When a file is selected or dropped
  useEffect(() => {
    if (!file) return;

    const readFile = async () => {
      setBusy(true);
      setProgressText("Reading HTML file…");
      setError("");
      setMessage("");

      try {
        const text = await file.text();
        setHtmlContent(text);
        setMessage(`Loaded HTML document: ${(file.size / 1024).toFixed(1)} KB.`);
      } catch (err) {
        console.error("HTML read error:", err);
        setError("Failed to read HTML file.");
      } finally {
        setBusy(false);
        setProgressText("");
      }
    };

    void readFile();
  }, [file]);

  // Sync HTML content into the isolated iframe
  useEffect(() => {
    if (!htmlContent) return;

    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    const printAndNormalizeCss = `
      <style id="simplypdf-injected-styles">
        @page {
          size: ${pageSize} ${orientation};
          margin: 10mm;
        }
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        html, body {
          background-color: #ffffff !important;
          min-height: 100%;
          margin: 0;
          box-sizing: border-box;
        }
      </style>
    `;

    let finalHtml = htmlContent;
    if (finalHtml.includes("</head>")) {
      finalHtml = finalHtml.replace("</head>", `${printAndNormalizeCss}</head>`);
    } else if (finalHtml.includes("<body")) {
      finalHtml = `${printAndNormalizeCss}${finalHtml}`;
    } else {
      finalHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">${printAndNormalizeCss}</head><body>${finalHtml}</body></html>`;
    }

    try {
      doc.open();
      doc.write(finalHtml);
      doc.close();

      const updateHeight = () => {
        try {
          const body = doc.body;
          const html = doc.documentElement;
          const measured = Math.max(
            body ? body.scrollHeight : 0,
            body ? body.offsetHeight : 0,
            html ? html.clientHeight : 0,
            html ? html.scrollHeight : 0,
            html ? html.offsetHeight : 0,
            500
          );
          setIframeHeight(measured + 40);
        } catch {
          // ignore cross-origin or measuring issues
        }
      };

      // Measure after parsing and once images/fonts settle
      setTimeout(updateHeight, 60);
      setTimeout(updateHeight, 400);
      iframe.onload = updateHeight;
    } catch (e) {
      console.error("Iframe write error:", e);
    }
  }, [htmlContent, pageSize, orientation]);

  const handleConvert = async () => {
    const iframe = iframeRef.current;
    if (!htmlContent || !iframe) return;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    const targetElement = doc?.body;
    if (!targetElement) {
      setError("Preview document is not ready yet. Please try again in a moment.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      setProgressText("Preparing HTML layout and rendering graphics…");

      // Wait for any embedded images inside the iframe to load
      const images = Array.from(targetElement.querySelectorAll("img"));
      if (images.length > 0) {
        await Promise.all(
          images.map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve) => {
              img.onload = () => resolve(null);
              img.onerror = () => resolve(null);
              setTimeout(resolve, 2500);
            });
          })
        );
      }

      // Compute nominal page height based on selected page format
      const widthPx = targetElement.offsetWidth || 800;
      const ratio = pageSize === "letter" ? 11 / 8.5 : 297 / 210;
      const nominalPageHeight = orientation === "landscape"
        ? Math.round(widthPx / ratio)
        : Math.round(widthPx * ratio);

      const fileName = file?.name || "document.html";

      await convertElementsToPdf([targetElement], {
        fileName,
        nominalPageHeightPx: nominalPageHeight,
        orientation,
        onProgress: setProgressText,
      });

      setMessage("✓ High-DPI PDF generated and downloaded preserving all styles and tables!");
    } catch (err) {
      console.error("HTML to PDF conversion error:", err);
      setError("An error occurred while generating the PDF. You can also use the 'Save as PDF (Vector Print)' button below.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  const handlePrint = () => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) {
      setError("Unable to launch print dialog for the preview document.");
      return;
    }

    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (err) {
      console.error("Iframe print error:", err);
      setError("Browser blocked the isolated print dialog. Try the 'Convert & download PDF' button.");
    }
  };

  const handleReset = () => {
    setFile(null);
    setHtmlContent("");
    setMessage("");
    setError("");
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write("");
        doc.close();
      }
    }
  };

  const handleLoadSample = () => {
    setTab("paste");
    setFile(null);
    setHtmlContent(SAMPLE_HTML);
    setMessage("Loaded sample responsive invoice template.");
  };

  return (
    <div className="converter-card">
      {!htmlContent && (
        <>
          <div className="html-tab-switch">
            <button
              type="button"
              className={`html-tab-btn ${tab === "upload" ? "active" : ""}`}
              onClick={() => setTab("upload")}
            >
              Upload HTML File
            </button>
            <button
              type="button"
              className={`html-tab-btn ${tab === "paste" ? "active" : ""}`}
              onClick={() => setTab("paste")}
            >
              Paste HTML Code
            </button>
            <button
              type="button"
              className="html-tab-btn"
              onClick={handleLoadSample}
              style={{ marginLeft: "auto", borderStyle: "dashed" }}
            >
              Load Sample Template ✦
            </button>
          </div>

          {tab === "upload" && (
            <label
              className="upload-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                setFile(e.dataTransfer.files[0] || null);
              }}
            >
              <input
                type="file"
                accept=".html,.htm,text/html"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <span className="upload-icon">&lt;&gt;</span>
              <strong>Drop HTML document here</strong>
              <span className="upload-hint">or click to browse · .html, .htm with complete styles, tables, and web fonts</span>
            </label>
          )}

          {tab === "paste" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <textarea
                className="html-paste-textarea"
                placeholder="<!DOCTYPE html>&#10;<html>&#10;  <head><style>body { font-family: sans-serif; }</style></head>&#10;  <body>&#10;    <h1>Hello World</h1>&#10;  </body>&#10;</html>"
                onChange={(e) => setHtmlContent(e.target.value)}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Paste standard HTML markup including inline &lt;style&gt; blocks.</span>
                <button
                  type="button"
                  className="download-button"
                  style={{ width: "auto", padding: "8px 20px", fontSize: 13 }}
                  disabled={!htmlContent.trim()}
                >
                  Preview Document →
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {htmlContent && (
        <div className="loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{file ? file.name : "Pasted HTML Document"}</strong>
              <span className="page-count">
                {file ? `${(file.size / 1024).toFixed(1)} KB` : `${(htmlContent.length / 1024).toFixed(1)} KB`}
              </span>
            </div>
            <button
              type="button"
              className="reset-button"
              onClick={handleReset}
              disabled={busy}
            >
              Choose another document
            </button>
          </div>

          <div className="word-fidelity-banner">
            <span className="fidelity-badge">✦ Isolated Web Engine</span>
            <span>Renders full CSS3, web fonts, tables, margins, and layouts in an isolated sandbox for perfect conversion fidelity.</span>
          </div>

          {/* Controls: Page size, Orientation */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", margin: "16px 0", background: "var(--surface)", padding: "12px 16px", borderRadius: 8, border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Page Size:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as PageSize)}
                disabled={busy}
                style={{
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <option value="a4">A4 (Standard)</option>
                <option value="letter">US Letter</option>
                <option value="full">Full Width (Fluid)</option>
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Orientation:</span>
              <div style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
                <button
                  type="button"
                  onClick={() => setOrientation("portrait")}
                  disabled={busy}
                  style={{
                    background: orientation === "portrait" ? "var(--accent)" : "var(--bg)",
                    color: orientation === "portrait" ? "#ffffff" : "var(--muted)",
                    border: "none",
                    padding: "4px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Portrait
                </button>
                <button
                  type="button"
                  onClick={() => setOrientation("landscape")}
                  disabled={busy}
                  style={{
                    background: orientation === "landscape" ? "var(--accent)" : "var(--bg)",
                    color: orientation === "landscape" ? "#ffffff" : "var(--muted)",
                    border: "none",
                    padding: "4px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Landscape
                </button>
              </div>
            </div>

            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
              Tip: Use <strong>Vector Print</strong> for selectable vector text!
            </span>
          </div>

          {progressText && (
            <div className="conversion-progress-box" role="status">
              <div className="spinner-dot" />
              <span>{progressText}</span>
            </div>
          )}

          <div className="convert-actions">
            <button
              type="button"
              className="download-button"
              onClick={handleConvert}
              disabled={busy || !htmlContent}
            >
              {busy ? "Generating PDF…" : "Convert & download PDF ↓"}
            </button>

            <button
              type="button"
              className="download-button secondary print-button"
              onClick={handlePrint}
              disabled={busy || !htmlContent}
              title="Print directly or save as vector PDF with selectable text"
            >
              Save as PDF (Vector Print) 🖨
            </button>
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          {/* HTML Preview Section */}
          <div className="docx-preview-section">
            <div className="docx-preview-header">
              <span className="docx-preview-title">Document Preview (Rendered HTML)</span>
              <span className="docx-preview-hint">
                Isolated sandbox · {pageSize.toUpperCase()} · {orientation}
              </span>
            </div>

            <div className="docx-desk-wrapper">
              <div className={`html-preview-frame-container size-${pageSize} ${orientation}`}>
                <iframe
                  ref={iframeRef}
                  className="html-document-iframe"
                  title="HTML Document Preview"
                  style={{ height: `${iframeHeight}px`, minHeight: "500px" }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
