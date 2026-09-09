"use client";

import { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";

export function TextConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState<string>("");
  const [fontFamily, setFontFamily] = useState<"monospace" | "sans" | "serif">("monospace");
  const [fontSize, setFontSize] = useState<number>(11);
  const [lineSpacing, setLineSpacing] = useState<number>(1.5);
  const [showLineNumbers, setShowLineNumbers] = useState<boolean>(true);
  const [showPageNumbers, setShowPageNumbers] = useState<boolean>(true);
  const [marginPt, setMarginPt] = useState<number>(40);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const previewDeskRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file) {
      setContent("");
      setMessage("");
      setError("");
      return;
    }

    const readText = async () => {
      setBusy(true);
      setProgressText("Reading text document…");
      setError("");
      setMessage("");

      try {
        const text = await file.text();
        setContent(text);
        const lines = text.split("\n").length;
        setMessage(`Loaded text document: ${lines.toLocaleString()} lines (${(file.size / 1024).toFixed(1)} KB).`);
      } catch (err) {
        console.error("Text read error:", err);
        setError("Failed to read text file.");
      } finally {
        setBusy(false);
        setProgressText("");
      }
    };

    void readText();
  }, [file]);

  const lines = content ? content.split("\n") : [];

  const handleConvert = async () => {
    if (!content || !file) return;

    setBusy(true);
    setError("");
    setMessage("");
    setProgressText("Generating paginated text PDF…");

    try {
      await new Promise((r) => setTimeout(r, 20));

      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Font configuration
      let pdfFont = "courier";
      if (fontFamily === "sans") pdfFont = "helvetica";
      if (fontFamily === "serif") pdfFont = "times";

      pdf.setFont(pdfFont, "normal");
      pdf.setFontSize(fontSize);

      const usableWidth = pageWidth - marginPt * 2;
      const lineNumColWidth = showLineNumbers ? 42 : 0;
      const textColWidth = usableWidth - lineNumColWidth;
      const lineHeight = fontSize * lineSpacing;

      const topMargin = marginPt + 24;
      const bottomMargin = pageHeight - marginPt - 20;

      let y = topMargin;
      let currentPage = 1;
      const totalEstimatedPages: number[] = [];

      // Split lines to wrapped lines
      const wrappedLines: Array<{ lineNum: number | null; text: string }> = [];
      lines.forEach((line, idx) => {
        const wrapped = pdf.splitTextToSize(line || " ", textColWidth);
        wrapped.forEach((wLine: string, wIdx: number) => {
          wrappedLines.push({
            lineNum: wIdx === 0 ? idx + 1 : null,
            text: wLine,
          });
        });
      });

      const drawHeaderFooter = (page: number) => {
        pdf.setFont(pdfFont, "normal");
        pdf.setFontSize(9);
        pdf.setTextColor(130, 130, 130);

        // Header
        pdf.text(file.name, marginPt, marginPt);
        pdf.text("SimplyPDF", pageWidth - marginPt - 48, marginPt);
        pdf.setDrawColor(220, 220, 220);
        pdf.line(marginPt, marginPt + 6, pageWidth - marginPt, marginPt + 6);

        // Footer
        if (showPageNumbers) {
          pdf.line(marginPt, pageHeight - marginPt + 2, pageWidth - marginPt, pageHeight - marginPt + 2);
          pdf.text(`Page ${page}`, pageWidth / 2 - 15, pageHeight - marginPt + 14);
        }

        pdf.setTextColor(0, 0, 0);
        pdf.setFontSize(fontSize);
      };

      drawHeaderFooter(currentPage);

      for (let i = 0; i < wrappedLines.length; i += 1) {
        if (y + lineHeight > bottomMargin) {
          pdf.addPage();
          currentPage += 1;
          drawHeaderFooter(currentPage);
          y = topMargin;
        }

        const item = wrappedLines[i];

        if (showLineNumbers && item.lineNum !== null) {
          pdf.setFont(pdfFont, "normal");
          pdf.setTextColor(150, 150, 150);
          pdf.text(String(item.lineNum).padStart(4, " "), marginPt, y);
          pdf.setTextColor(0, 0, 0);
        }

        const textX = marginPt + lineNumColWidth;
        pdf.text(item.text, textX, y);
        y += lineHeight;
      }

      const outName = `${file.name.replace(/\.[^.]+$/, "")}.pdf`;
      pdf.save(outName);
      setMessage(`✓ Downloaded "${outName}" (${currentPage} pages) with custom typography!`);
    } catch (err) {
      console.error("Text PDF conversion error:", err);
      setError("Failed to generate PDF from text document.");
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
            accept=".txt,.log,.csv,.json,.sql,.js,.py,.env,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <span className="upload-icon">T</span>
          <strong>Drop text or code file here</strong>
          <span className="upload-hint">or click to browse · .txt, .log, .json, .py, .sql, .csv supported</span>
        </label>
      )}

      {file && (
        <div className="loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{file.name}</strong>
              <span className="page-count">
                {(file.size / 1024).toFixed(1)} KB · {lines.length} lines
              </span>
            </div>
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                setFile(null);
                setContent("");
                setMessage("");
                setError("");
              }}
              disabled={busy}
            >
              Choose another file
            </button>
          </div>

          <div className="word-fidelity-banner">
            <span className="fidelity-badge">✦ Typography Engine</span>
            <span>Customize fonts, line numbers, line heights, and margins with smart multi-page pagination.</span>
          </div>

          {/* Typography options toolbar */}
          <div className="advanced-toolbar" style={{ marginTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Font:
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as any)}
                disabled={busy}
              >
                <option value="monospace">Monospace (Courier / Code)</option>
                <option value="sans">Clean Sans-Serif (Modern)</option>
                <option value="serif">Classic Serif (Book)</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Size:
              <select
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                disabled={busy}
              >
                <option value={9.5}>Small (9.5pt)</option>
                <option value={11}>Medium (11pt)</option>
                <option value={13}>Large (13pt)</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Spacing:
              <select
                value={lineSpacing}
                onChange={(e) => setLineSpacing(Number(e.target.value))}
                disabled={busy}
              >
                <option value={1.3}>Compact (1.3x)</option>
                <option value={1.5}>Normal (1.5x)</option>
                <option value={1.8}>Relaxed (1.8x)</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showLineNumbers}
                onChange={(e) => setShowLineNumbers(e.target.checked)}
                disabled={busy}
              />
              Line numbers
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showPageNumbers}
                onChange={(e) => setShowPageNumbers(e.target.checked)}
                disabled={busy}
              />
              Page numbers
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
              disabled={busy || !content}
            >
              {busy ? "Generating PDF…" : "Convert & download PDF ↓"}
            </button>

            <button
              type="button"
              className="download-button secondary print-button"
              onClick={() => window.print()}
              disabled={busy || !content}
              title="Print or save as vector PDF using browser print dialog"
            >
              Save as PDF (Vector Print) 🖨
            </button>
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          {/* Text preview desk */}
          {content && (
            <div className="docx-preview-section">
              <div className="docx-preview-header">
                <span className="docx-preview-title">Document Preview (Formatted Text)</span>
                <span className="docx-preview-hint">Rendered with selected typography settings</span>
              </div>

              <div className="docx-desk-wrapper">
                <div
                  ref={previewDeskRef}
                  className={`text-page-preview font-${fontFamily}`}
                  style={{
                    fontSize: `${fontSize}pt`,
                    lineHeight: lineSpacing,
                    padding: `${marginPt}px`,
                  }}
                >
                  <div className="text-doc-header-line">
                    <span>{file.name}</span>
                    <span>SimplyPDF</span>
                  </div>

                  <div className="text-doc-body">
                    {lines.slice(0, 500).map((line, idx) => (
                      <div key={idx} className="text-doc-line-row">
                        {showLineNumbers && (
                          <span className="text-doc-linenum">{(idx + 1).toString().padStart(4, " ")}</span>
                        )}
                        <span className="text-doc-line-content">{line || " "}</span>
                      </div>
                    ))}
                  </div>

                  {lines.length > 500 && (
                    <p className="excel-truncation-note">
                      (Showing first 500 lines in preview. All {lines.length} lines are included in the generated PDF.)
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
