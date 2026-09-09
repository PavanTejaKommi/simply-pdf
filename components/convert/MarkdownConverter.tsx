"use client";

import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import { convertElementsToPdf } from "./shared";

export function MarkdownConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState<string>("");
  const [renderedHtml, setRenderedHtml] = useState<string>("");
  const [theme, setTheme] = useState<"github" | "academic" | "minimal">("github");
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const mdMountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file) {
      setRawText("");
      setRenderedHtml("");
      setMessage("");
      setError("");
      return;
    }

    const loadMarkdown = async () => {
      setBusy(true);
      setProgressText("Parsing GitHub-flavored markdown, tables & code blocks…");
      setError("");
      setMessage("");

      try {
        const text = await file.text();
        setRawText(text);

        // Parse markdown with GFM tables and linebreaks enabled
        const parsed = await Promise.resolve(marked.parse(text, { gfm: true, breaks: true }));
        setRenderedHtml(parsed as string);

        const lines = text.split("\n").length;
        setMessage(`Rendered markdown document: ${lines.toLocaleString()} lines with styled headers, code & tables.`);
      } catch (err) {
        console.error("Markdown parse error:", err);
        setError("Failed to parse markdown document.");
      } finally {
        setBusy(false);
        setProgressText("");
      }
    };

    void loadMarkdown();
  }, [file]);

  const handleConvert = async () => {
    if (!file || !mdMountRef.current) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const container = mdMountRef.current;
      await convertElementsToPdf([container], {
        fileName: file.name,
        onProgress: setProgressText,
      });

      setMessage(`✓ Downloaded PDF with formatted markdown typography, tables, and code!`);
    } catch (err) {
      console.error("Markdown PDF conversion error:", err);
      setError("An error occurred while generating the PDF.");
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
            accept=".md,.markdown,text/markdown"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <span className="upload-icon">M</span>
          <strong>Drop Markdown note or documentation here</strong>
          <span className="upload-hint">or click to browse · .md, .markdown with tables, code, and math</span>
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
                setRawText("");
                setRenderedHtml("");
                setMessage("");
                setError("");
              }}
              disabled={busy}
            >
              Choose another file
            </button>
          </div>

          <div className="word-fidelity-banner">
            <span className="fidelity-badge">✦ Markdown Engine</span>
            <span>Renders GitHub-flavored markdown with styled headings, code syntax blocks, tables, and quotes.</span>
          </div>

          <div className="advanced-toolbar" style={{ marginTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Style Theme:
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as any)}
                disabled={busy}
              >
                <option value="github">GitHub Documentation (Modern)</option>
                <option value="academic">Academic Paper (Serif & Centered)</option>
                <option value="minimal">Minimal Clean (Sans-Serif)</option>
              </select>
            </label>
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
              disabled={busy || !renderedHtml}
            >
              {busy ? "Generating PDF…" : "Convert & download PDF ↓"}
            </button>

            <button
              type="button"
              className="download-button secondary print-button"
              onClick={() => window.print()}
              disabled={busy || !renderedHtml}
              title="Print or save as vector PDF using browser print dialog"
            >
              Save as PDF (Vector Print) 🖨
            </button>
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          {/* Markdown Preview Desk */}
          {renderedHtml && (
            <div className="docx-preview-section">
              <div className="docx-preview-header">
                <span className="docx-preview-title">Document Preview (Rendered Markdown)</span>
                <span className="docx-preview-hint">Rendered with {theme} document styling</span>
              </div>

              <div className="docx-desk-wrapper">
                <div
                  ref={mdMountRef}
                  className={`markdown-page-preview theme-${theme}`}
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
