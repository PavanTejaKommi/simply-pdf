"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { convertElementsToPdf } from "./shared";

interface SlideData {
  index: number;
  title: string;
  bullets: string[];
  rawTexts: string[];
}

export function PowerPointConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [activeSlideIdx, setActiveSlideIdx] = useState<number>(0);
  const [themeMode, setThemeMode] = useState<"modern-dark" | "clean-light" | "corporate-blue">("modern-dark");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "4:3">("16:9");
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const slidesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file) {
      setSlides([]);
      setActiveSlideIdx(0);
      setMessage("");
      setError("");
      return;
    }

    const parsePptx = async () => {
      setBusy(true);
      setProgressText("Parsing presentation slides, shapes, and typography…");
      setError("");
      setMessage("");

      try {
        const buffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);

        // Find all slide XML files
        const slideKeys = Object.keys(zip.files)
          .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
          .sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
            const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
            return numA - numB;
          });

        if (!slideKeys.length) {
          setError("No slides found in this presentation. Please ensure it is a valid .pptx file.");
          return;
        }

        const parsedSlides: SlideData[] = [];

        for (let i = 0; i < slideKeys.length; i += 1) {
          const xmlText = await zip.file(slideKeys[i])?.async("string");
          if (!xmlText) continue;

          const doc = new DOMParser().parseFromString(xmlText, "application/xml");
          const shapes = Array.from(doc.querySelectorAll("p\\:sp, sp"));
          let title = "";
          const bullets: string[] = [];
          const rawTexts: string[] = [];

          for (const sp of shapes) {
            const ph = sp.querySelector("p\\:nvSpPr p\\:nvPr p\\:ph, ph");
            const phType = ph?.getAttribute("type");
            const textNodes = Array.from(sp.querySelectorAll("a\\:t, t"))
              .map((n) => n.textContent?.trim())
              .filter(Boolean) as string[];

            const joined = textNodes.join(" ");
            if (!joined) continue;

            if ((phType === "title" || phType === "ctrTitle" || !title) && joined.length < 120) {
              if (!title) {
                title = joined;
                continue;
              }
            }

            // Paragraphs inside body
            const paragraphs = Array.from(sp.querySelectorAll("a\\:p, p"));
            for (const p of paragraphs) {
              const pText = Array.from(p.querySelectorAll("a\\:t, t"))
                .map((n) => n.textContent?.trim())
                .filter(Boolean)
                .join(" ");
              if (pText && pText !== title) {
                bullets.push(pText);
              }
            }

            rawTexts.push(joined);
          }

          parsedSlides.push({
            index: i + 1,
            title: title || `Slide ${i + 1}`,
            bullets: bullets.length > 0 ? bullets : rawTexts.filter((t) => t !== title),
            rawTexts,
          });
        }

        setSlides(parsedSlides);
        setActiveSlideIdx(0);
        setMessage(`Extracted ${parsedSlides.length} presentation slides ready for high-resolution PDF generation.`);
      } catch (err) {
        console.error("PowerPoint parse error:", err);
        setError("Failed to parse PowerPoint presentation. Please ensure it is an uncorrupted .pptx file.");
      } finally {
        setBusy(false);
        setProgressText("");
      }
    };

    void parsePptx();
  }, [file]);

  const handleConvert = async () => {
    if (!file || !slidesContainerRef.current) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const container = slidesContainerRef.current;
      const slideElements = Array.from(container.querySelectorAll<HTMLElement>(".ppt-slide-card"));
      const elementsToRender = slideElements.length > 0 ? slideElements : [container];

      await convertElementsToPdf(elementsToRender, {
        fileName: file.name,
        orientation: "landscape",
        nominalPageHeightPx: aspectRatio === "16:9" ? 473.6 : 595,
        onProgress: setProgressText,
      });

      setMessage(`✓ Downloaded "${file.name.replace(/\.[^.]+$/, "")}.pdf" (${slideElements.length} slides) in widescreen presentation format!`);
    } catch (err) {
      console.error("PowerPoint conversion error:", err);
      setError("An error occurred while generating the PDF slides.");
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
            accept=".pptx,.ppt"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <span className="upload-icon">▤</span>
          <strong>Drop PowerPoint presentation here</strong>
          <span className="upload-hint">or click to browse · .pptx processed locally in widescreen</span>
        </label>
      )}

      {file && (
        <div className="loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{file.name}</strong>
              <span className="page-count">
                {(file.size / 1024 / 1024).toFixed(2)} MB · {slides.length} {slides.length === 1 ? "slide" : "slides"}
              </span>
            </div>
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                setFile(null);
                setSlides([]);
                setMessage("");
                setError("");
              }}
              disabled={busy}
            >
              Choose another file
            </button>
          </div>

          <div className="word-fidelity-banner">
            <span className="fidelity-badge">✦ Presentation Engine</span>
            <span>Converting each slide into an individual landscape presentation page with headers & bullet lists.</span>
          </div>

          {/* Controls */}
          <div className="advanced-toolbar" style={{ marginTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              Theme:
              <select
                value={themeMode}
                onChange={(e) => setThemeMode(e.target.value as any)}
                disabled={busy}
              >
                <option value="modern-dark">Modern Dark (Sleek Indigo)</option>
                <option value="clean-light">Clean Light (Executive Minimalist)</option>
                <option value="corporate-blue">Corporate Navy & Gold</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              Ratio:
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as any)}
                disabled={busy}
              >
                <option value="16:9">16:9 Widescreen (Modern)</option>
                <option value="4:3">4:3 Standard</option>
              </select>
            </label>

            {slides.length > 1 && (
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
                Jump to slide:
                <select
                  style={{ marginLeft: 6 }}
                  value={activeSlideIdx}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    setActiveSlideIdx(idx);
                    const el = document.getElementById(`slide-card-${idx}`);
                    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }}
                  disabled={busy}
                >
                  {slides.map((s, idx) => (
                    <option key={idx} value={idx}>
                      Slide {s.index}: {s.title.slice(0, 25)}...
                    </option>
                  ))}
                </select>
              </span>
            )}
          </div>

          {progressText && (
            <div className="conversion-progress-box" role="status">
              <div className="spinner-dot" />
              <span>{progressText}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="convert-actions">
            <button
              type="button"
              className="download-button"
              onClick={handleConvert}
              disabled={busy || slides.length === 0}
            >
              {busy ? "Generating Slides PDF…" : "Convert & download PDF ↓"}
            </button>

            <button
              type="button"
              className="download-button secondary print-button"
              onClick={() => window.print()}
              disabled={busy || slides.length === 0}
              title="Print or save as vector PDF using browser print dialog"
            >
              Save as PDF (Vector Print) 🖨
            </button>
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          {/* Slide Deck Preview Area */}
          {slides.length > 0 && (
            <div className="docx-preview-section">
              <div className="docx-preview-header">
                <span className="docx-preview-title">Presentation Slide Deck ({slides.length} slides)</span>
                <span className="docx-preview-hint">Each slide will be exported as an exact landscape PDF page</span>
              </div>

              <div className="docx-desk-wrapper">
                <div ref={slidesContainerRef} className="ppt-deck-container">
                  {slides.map((slide, sIdx) => (
                    <div
                      key={slide.index}
                      id={`slide-card-${sIdx}`}
                      className={`ppt-slide-card theme-${themeMode} ratio-${aspectRatio.replace(":", "-")}`}
                    >
                      <div className="ppt-slide-header">
                        <span className="ppt-slide-badge">Slide {slide.index} of {slides.length}</span>
                        <span className="ppt-slide-branding">SimplyPDF Deck</span>
                      </div>

                      <div className="ppt-slide-body">
                        <h2 className="ppt-slide-title">{slide.title}</h2>
                        {slide.bullets.length > 0 ? (
                          <ul className="ppt-bullet-list">
                            {slide.bullets.map((b, bIdx) => (
                              <li key={bIdx} className="ppt-bullet-item">
                                {b}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="ppt-empty-slide-note">(Visual slide content or graphics)</p>
                        )}
                      </div>

                      <div className="ppt-slide-footer">
                        <span>{file.name}</span>
                        <span>Page {slide.index}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
