"use client";

import { useEffect, useRef, useState } from "react";
import { convertElementsToPdf } from "./shared";

export function HtmlConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const htmlMountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file) {
      setHtmlContent("");
      setMessage("");
      setError("");
      if (htmlMountRef.current) htmlMountRef.current.innerHTML = "";
      return;
    }

    const loadHtml = async () => {
      setBusy(true);
      setProgressText("Parsing and mounting HTML document…");
      setError("");
      setMessage("");

      try {
        const text = await file.text();
        setHtmlContent(text);

        // Mount directly inside preview
        if (htmlMountRef.current) {
          htmlMountRef.current.innerHTML = text;
        }

        setMessage(`Loaded HTML document: ${(file.size / 1024).toFixed(1)} KB with preserved inline styles and structure.`);
      } catch (err) {
        console.error("HTML read error:", err);
        setError("Failed to load HTML file.");
      } finally {
        setBusy(false);
        setProgressText("");
      }
    };

    void loadHtml();
  }, [file]);

  const handleConvert = async () => {
    if (!file || !htmlMountRef.current) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const container = htmlMountRef.current;
      await convertElementsToPdf([container], {
        fileName: file.name,
        onProgress: setProgressText,
      });

      setMessage(`✓ Downloaded PDF preserving your HTML layout, tables, fonts, and styles!`);
    } catch (err) {
      console.error("HTML to PDF conversion error:", err);
      setError("An error occurred while generating the PDF from HTML.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  return (
    <div className="converter-card">
      {!file && (
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
          <span className="upload-hint">or click to browse · .html, .htm with complete styles & tables</span>
        </label>
      )}

      {file && (
        <div className="loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{file.name}</strong>
              <span className="page-count">{(file.size / 1024).toFixed(1)} KB</span>
            </div>
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                setFile(null);
                setHtmlContent("");
                setMessage("");
                setError("");
                if (htmlMountRef.current) htmlMountRef.current.innerHTML = "";
              }}
              disabled={busy}
            >
              Choose another file
            </button>
          </div>

          <div className="word-fidelity-banner">
            <span className="fidelity-badge">✦ Web Render Engine</span>
            <span>Renders complete DOM layouts, CSS styles, tables, colors, and embedded assets into high-DPI PDF.</span>
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
              onClick={() => window.print()}
              disabled={busy || !htmlContent}
              title="Print or save as vector PDF using browser print dialog"
            >
              Save as PDF (Vector Print) 🖨
            </button>
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          {/* HTML Preview Desk */}
          {htmlContent && (
            <div className="docx-preview-section">
              <div className="docx-preview-header">
                <span className="docx-preview-title">Document Preview (Rendered HTML)</span>
                <span className="docx-preview-hint">Rendered with active document styles</span>
              </div>

              <div ref={previewWrapperRef} className="docx-desk-wrapper">
                <div
                  ref={htmlMountRef}
                  className="html-document-preview"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
