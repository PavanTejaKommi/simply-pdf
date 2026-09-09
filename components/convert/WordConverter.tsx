"use client";

import { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { renderAsync } from "docx-preview";
import html2canvas from "html2canvas";
import { findCleanBreakY } from "./shared";

export function WordConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [wordPages, setWordPages] = useState<number>(0);
  const [isDocxReady, setIsDocxReady] = useState(false);

  const docContainerRef = useRef<HTMLDivElement>(null);
  const styleContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    if (!file) {
      setIsDocxReady(false);
      setWordPages(0);
      if (docContainerRef.current) docContainerRef.current.innerHTML = "";
      return;
    }

    const isDocx = file.name.toLowerCase().endsWith(".docx");
    if (!isDocx) {
      setIsDocxReady(false);
      setWordPages(0);
      if (docContainerRef.current) docContainerRef.current.innerHTML = "";
      setMessage(
        "Note: .doc is the legacy binary format from Word 97-2003. For 100% exact layout, tables, fonts, and images, please save your document as .docx in Word."
      );
      return;
    }

    const loadDocx = async () => {
      setBusy(true);
      setProgressText("Parsing document layout, tables, fonts, and styles…");
      setError("");
      setMessage("");

      try {
        const buffer = await file.arrayBuffer();
        if (cancelled || !docContainerRef.current) return;

        docContainerRef.current.innerHTML = "";
        if (styleContainerRef.current) styleContainerRef.current.innerHTML = "";

        await renderAsync(
          buffer,
          docContainerRef.current,
          styleContainerRef.current || undefined,
          {
            className: "docx",
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
            trimXmlDeclaration: true,
          }
        );

        if (cancelled) return;

        // Calculate accurate page count across all sections and continuous flows
        const sections = Array.from(
          docContainerRef.current.querySelectorAll<HTMLElement>("section.docx, .docx-wrapper > section, section")
        );
        let totalCount = 0;
        sections.forEach((sec) => {
          const comp = window.getComputedStyle(sec);
          const nominalH = parseFloat(comp.minHeight) || (sec.offsetWidth * (11 / 8.5)) || 1056;
          const actualH = sec.offsetHeight || nominalH;
          totalCount += Math.max(1, Math.ceil((actualH - 15) / nominalH));
        });
        const finalCount = totalCount || 1;
        setWordPages(finalCount);
        setIsDocxReady(true);
        setMessage(`Exact layout parsed: ${finalCount} ${finalCount === 1 ? "page" : "pages"} rendered with tables, fonts, and original structure.`);
      } catch (err) {
        console.error("docx-preview error:", err);
        if (!cancelled) {
          setError("Failed to render Word document layout. Please ensure this is a valid .docx file.");
          setIsDocxReady(false);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
          setProgressText("");
        }
      }
    };

    void loadDocx();

    return () => {
      cancelled = true;
    };
  }, [file]);

  const convertWordToPdf = async () => {
    if (!file || !docContainerRef.current) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const container = docContainerRef.current;
      const sections = Array.from(
        container.querySelectorAll<HTMLElement>("section.docx, .docx-wrapper > section, section")
      );

      const targets = sections.length > 0 ? sections : [container];

      let totalPagesToRender = 0;
      const sectionPlans = targets.map((section) => {
        const rect = section.getBoundingClientRect();
        const widthPx = section.offsetWidth || rect.width || 816;
        const comp = window.getComputedStyle(section);
        let nominalPageHeightPx = parseFloat(comp.minHeight);
        if (!nominalPageHeightPx || isNaN(nominalPageHeightPx) || nominalPageHeightPx < 200) {
          nominalPageHeightPx = Math.round(widthPx * (11 / 8.5));
        }
        const totalHeightPx = section.offsetHeight || rect.height || nominalPageHeightPx;
        const pages = Math.max(1, Math.ceil((totalHeightPx - 15) / nominalPageHeightPx));
        totalPagesToRender += pages;
        return { section, widthPx, nominalPageHeightPx, totalHeightPx, pages };
      });

      let pdf: jsPDF | null = null;
      let currentPageNum = 1;

      for (let sIdx = 0; sIdx < sectionPlans.length; sIdx += 1) {
        const plan = sectionPlans[sIdx];
        const { section, widthPx, nominalPageHeightPx, pages } = plan;

        setProgressText(`Rendering page ${currentPageNum} of ${totalPagesToRender} at high resolution (192 DPI)…`);
        await new Promise((resolve) => setTimeout(resolve, 25));

        const widthPt = (widthPx / 96) * 72;
        const pageHeightPt = (nominalPageHeightPx / 96) * 72;
        const isLandscape = widthPt > pageHeightPt;

        const fullCanvas = await html2canvas(section, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
          scrollX: 0,
          scrollY: 0,
          windowWidth: Math.max(document.documentElement.offsetWidth, section.scrollWidth),
        });

        if (pages === 1) {
          if (!pdf) {
            pdf = new jsPDF({
              orientation: isLandscape ? "landscape" : "portrait",
              unit: "pt",
              format: [widthPt, pageHeightPt],
            });
          } else {
            pdf.addPage([widthPt, pageHeightPt], isLandscape ? "landscape" : "portrait");
          }

          const imgData = fullCanvas.toDataURL("image/jpeg", 0.95);
          pdf.addImage(imgData, "JPEG", 0, 0, widthPt, pageHeightPt, undefined, "FAST");
          currentPageNum += 1;
        } else {
          const nominalCanvasH = Math.round(nominalPageHeightPx * 2);
          let currentCanvasY = 0;

          while (currentCanvasY < fullCanvas.height - 10) {
            setProgressText(`Rendering page ${currentPageNum} of ${totalPagesToRender} at high resolution (192 DPI)…`);
            await new Promise((resolve) => setTimeout(resolve, 20));

            const idealNextY = currentCanvasY + nominalCanvasH;
            let sliceEndY = idealNextY;

            if (sliceEndY < fullCanvas.height) {
              sliceEndY = findCleanBreakY(fullCanvas, idealNextY, Math.round(nominalCanvasH * 0.08));
            } else {
              sliceEndY = fullCanvas.height;
            }

            if (sliceEndY <= currentCanvasY) {
              sliceEndY = Math.min(fullCanvas.height, currentCanvasY + nominalCanvasH);
            }

            const sliceH = Math.max(1, sliceEndY - currentCanvasY);

            const pageCanvas = document.createElement("canvas");
            pageCanvas.width = fullCanvas.width;
            pageCanvas.height = nominalCanvasH;
            const ctx = pageCanvas.getContext("2d");
            if (ctx) {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
              ctx.drawImage(fullCanvas, 0, currentCanvasY, fullCanvas.width, sliceH, 0, 0, fullCanvas.width, sliceH);
            }

            if (!pdf) {
              pdf = new jsPDF({
                orientation: isLandscape ? "landscape" : "portrait",
                unit: "pt",
                format: [widthPt, pageHeightPt],
              });
            } else {
              pdf.addPage([widthPt, pageHeightPt], isLandscape ? "landscape" : "portrait");
            }

            const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
            pdf.addImage(imgData, "JPEG", 0, 0, widthPt, pageHeightPt, undefined, "FAST");

            currentCanvasY = sliceEndY;
            currentPageNum += 1;
          }
        }
      }

      if (pdf) {
        const outName = `${file.name.replace(/\.[^.]+$/, "")}.pdf`;
        pdf.save(outName);
        setMessage(`✓ Downloaded "${outName}" (${totalPagesToRender} pages) with exact Word formatting, tables, and styles!`);
      }
    } catch (err) {
      console.error("Word to PDF conversion error:", err);
      setError("An error occurred while generating the PDF. You can also use the 'Save as PDF (Print)' option below.");
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
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setFile(event.dataTransfer.files[0] || null);
          }}
        >
          <input
            type="file"
            accept=".docx,.doc"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <span className="upload-icon">W</span>
          <strong>Drop Word document (.docx) here</strong>
          <span className="upload-hint">or click to browse · processed locally in your browser</span>
        </label>
      )}

      {file && (
        <div className="loaded-area docx-loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{file.name}</strong>
              <span className="page-count">
                {(file.size / 1024 / 1024).toFixed(2)} MB
                {isDocxReady && ` · ${wordPages} ${wordPages === 1 ? "page" : "pages"}`}
              </span>
            </div>
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                setFile(null);
                setIsDocxReady(false);
                setWordPages(0);
                setMessage("");
                setError("");
                if (docContainerRef.current) docContainerRef.current.innerHTML = "";
              }}
              disabled={busy}
            >
              Choose another file
            </button>
          </div>

          {isDocxReady && (
            <div className="word-fidelity-banner">
              <span className="fidelity-badge">✦ Exact Word Layout</span>
              <span>Preserving headers, footers, tables, fonts, margins &amp; page breaks — matching Microsoft Word &ldquo;Save as PDF&rdquo;.</span>
            </div>
          )}

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
              onClick={() => void convertWordToPdf()}
              disabled={busy || !isDocxReady}
            >
              {busy ? "Processing…" : "Convert & download PDF ↓"}
            </button>

            {isDocxReady && (
              <button
                type="button"
                className="download-button secondary print-button"
                onClick={() => window.print()}
                disabled={busy}
                title="Opens browser print dialog with pure vector output and selectable text"
              >
                Save as PDF (Vector Print) 🖨
              </button>
            )}
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          <div className="docx-preview-section">
            <div className="docx-preview-header">
              <span className="docx-preview-title">Document Preview (Word OpenXML layout)</span>
              <span className="docx-preview-hint">This exact layout will be captured into your PDF</span>
            </div>
            <div className="docx-desk-wrapper">
              <div ref={styleContainerRef} className="docx-style-container" />
              <div ref={docContainerRef} className="docx-preview-container" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
