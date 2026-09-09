"use client";

import { useState } from "react";
import { jsPDF } from "jspdf";

interface ImageItem {
  id: string;
  file: File;
  dataUrl: string;
  width: number;
  height: number;
  rotation: number;
}

export function ImagesConverter() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [pageSize, setPageSize] = useState<"a4" | "letter" | "fit">("a4");
  const [orientation, setOrientation] = useState<"portrait" | "landscape" | "auto">("auto");
  const [margin, setMargin] = useState<number>(20);
  const [imagesPerPage, setImagesPerPage] = useState<1 | 2 | 4>(1);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const processFiles = async (files: FileList | File[]) => {
    setError("");
    setMessage("");
    setBusy(true);
    setProgressText("Loading and optimizing images…");

    const newItems: ImageItem[] = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (!file.type.startsWith("image/")) continue;

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("Failed to read image"));
          reader.readAsDataURL(file);
        });

        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("Image decode failed"));
          image.src = dataUrl;
        });

        newItems.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          file,
          dataUrl,
          width: img.naturalWidth || img.width || 800,
          height: img.naturalHeight || img.height || 600,
          rotation: 0,
        });
      } catch (err) {
        console.error("Error reading image:", err);
      }
    }

    setImages((prev) => [...prev, ...newItems]);
    setBusy(false);
    setProgressText("");
    if (newItems.length > 0) {
      setMessage(`Added ${newItems.length} image(s). You can reorder, rotate, or adjust page layout below.`);
    }
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= images.length) return;
    const copy = [...images];
    const temp = copy[index];
    copy[index] = copy[newIdx];
    copy[newIdx] = temp;
    setImages(copy);
  };

  const rotateImage = (index: number) => {
    const copy = [...images];
    copy[index].rotation = (copy[index].rotation + 90) % 360;
    setImages(copy);
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const generateRotatedDataUrl = async (item: ImageItem): Promise<{ dataUrl: string; width: number; height: number }> => {
    if (item.rotation === 0) {
      return { dataUrl: item.dataUrl, width: item.width, height: item.height };
    }

    const canvas = document.createElement("canvas");
    const is90or270 = item.rotation === 90 || item.rotation === 270;
    canvas.width = is90or270 ? item.height : item.width;
    canvas.height = is90or270 ? item.width : item.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return { dataUrl: item.dataUrl, width: item.width, height: item.height };

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((item.rotation * Math.PI) / 180);
    const img = new Image();
    img.src = item.dataUrl;
    await new Promise((r) => { img.onload = r; });
    ctx.drawImage(img, -item.width / 2, -item.height / 2);

    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.95),
      width: canvas.width,
      height: canvas.height,
    };
  };

  const handleConvert = async () => {
    if (!images.length) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      let pdf: jsPDF | null = null;
      const chunks: ImageItem[][] = [];

      for (let i = 0; i < images.length; i += imagesPerPage) {
        chunks.push(images.slice(i, i + imagesPerPage));
      }

      for (let pageIdx = 0; pageIdx < chunks.length; pageIdx += 1) {
        setProgressText(`Processing page ${pageIdx + 1} of ${chunks.length}…`);
        await new Promise((r) => setTimeout(r, 15));

        const pageImages = chunks[pageIdx];
        const rotatedItems = await Promise.all(pageImages.map(generateRotatedDataUrl));

        let pageW = 595.28; // A4 pt
        let pageH = 841.89;

        if (pageSize === "letter") {
          pageW = 612;
          pageH = 792;
        } else if (pageSize === "fit" && rotatedItems.length === 1) {
          pageW = (rotatedItems[0].width / 96) * 72 + margin * 2;
          pageH = (rotatedItems[0].height / 96) * 72 + margin * 2;
        }

        let isLandscape = false;
        if (orientation === "landscape") {
          isLandscape = true;
          const temp = pageW;
          pageW = pageH;
          pageH = temp;
        } else if (orientation === "auto") {
          if (rotatedItems.length === 1) {
            isLandscape = rotatedItems[0].width > rotatedItems[0].height;
            if (isLandscape && pageW < pageH) {
              const temp = pageW;
              pageW = pageH;
              pageH = temp;
            }
          }
        }

        if (!pdf) {
          pdf = new jsPDF({
            orientation: isLandscape ? "landscape" : "portrait",
            unit: "pt",
            format: [pageW, pageH],
          });
        } else {
          pdf.addPage([pageW, pageH], isLandscape ? "landscape" : "portrait");
        }

        // Draw images on this page
        if (rotatedItems.length === 1) {
          const item = rotatedItems[0];
          const availW = pageW - margin * 2;
          const availH = pageH - margin * 2;
          const scale = Math.min(availW / item.width, availH / item.height);
          const drawW = item.width * scale;
          const drawH = item.height * scale;
          const x = margin + (availW - drawW) / 2;
          const y = margin + (availH - drawH) / 2;
          pdf.addImage(item.dataUrl, "JPEG", x, y, drawW, drawH, undefined, "FAST");
        } else if (rotatedItems.length === 2) {
          const availW = pageW - margin * 2;
          const availH = (pageH - margin * 3) / 2;
          rotatedItems.forEach((item, idx) => {
            const scale = Math.min(availW / item.width, availH / item.height);
            const drawW = item.width * scale;
            const drawH = item.height * scale;
            const x = margin + (availW - drawW) / 2;
            const y = margin + idx * (availH + margin) + (availH - drawH) / 2;
            pdf?.addImage(item.dataUrl, "JPEG", x, y, drawW, drawH, undefined, "FAST");
          });
        } else if (rotatedItems.length >= 3) {
          const availW = (pageW - margin * 3) / 2;
          const availH = (pageH - margin * 3) / 2;
          rotatedItems.forEach((item, idx) => {
            const col = idx % 2;
            const row = Math.floor(idx / 2);
            const scale = Math.min(availW / item.width, availH / item.height);
            const drawW = item.width * scale;
            const drawH = item.height * scale;
            const x = margin + col * (availW + margin) + (availW - drawW) / 2;
            const y = margin + row * (availH + margin) + (availH - drawH) / 2;
            pdf?.addImage(item.dataUrl, "JPEG", x, y, drawW, drawH, undefined, "FAST");
          });
        }
      }

      if (pdf) {
        const outName = images.length === 1 
          ? `${images[0].file.name.replace(/\.[^.]+$/, "")}.pdf`
          : "combined_images.pdf";
        pdf.save(outName);
        setMessage(`✓ Downloaded "${outName}" with ${images.length} combined image(s)!`);
      }
    } catch (err) {
      console.error("Image to PDF conversion error:", err);
      setError("Failed to generate PDF from images.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  return (
    <div className="converter-card">
      {images.length === 0 ? (
        <label
          className="upload-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files) void processFiles(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              if (e.target.files) void processFiles(e.target.files);
            }}
          />
          <span className="upload-icon">▧</span>
          <strong>Drop images here (single or multiple)</strong>
          <span className="upload-hint">or click to browse · PNG, JPG, WebP, SVG supported</span>
        </label>
      ) : (
        <div className="loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{images.length} Image{images.length === 1 ? "" : "s"} loaded</strong>
              <label className="add-more" style={{ marginLeft: 12 }}>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) void processFiles(e.target.files);
                  }}
                />
                ＋ Add more images
              </label>
            </div>
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                setImages([]);
                setMessage("");
                setError("");
              }}
              disabled={busy}
            >
              Clear all
            </button>
          </div>

          <div className="word-fidelity-banner">
            <span className="fidelity-badge">✦ Multi-Image Engine</span>
            <span>Combine, reorder, and rotate images with custom paper sizes and margins.</span>
          </div>

          {/* Layout controls */}
          <div className="advanced-toolbar" style={{ marginTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Page Size:
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as any)}
                disabled={busy}
              >
                <option value="a4">A4 (Standard)</option>
                <option value="letter">US Letter</option>
                <option value="fit">Fit to Image Size</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Orientation:
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as any)}
                disabled={busy}
              >
                <option value="auto">Auto (Match Image)</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Per Page:
              <select
                value={imagesPerPage}
                onChange={(e) => setImagesPerPage(Number(e.target.value) as any)}
                disabled={busy}
              >
                <option value={1}>1 image per page</option>
                <option value={2}>2 images per page</option>
                <option value={4}>4 images grid</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Margin:
              <select
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
                disabled={busy}
              >
                <option value={0}>None (Full-Bleed)</option>
                <option value={20}>Small (20pt)</option>
                <option value={40}>Normal (40pt)</option>
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
              disabled={busy || images.length === 0}
            >
              {busy ? "Building PDF…" : `Convert & download ${images.length} image(s) as PDF ↓`}
            </button>
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          {/* Interactive Image list / grid */}
          <div className="docx-preview-section">
            <div className="docx-preview-header">
              <span className="docx-preview-title">Image Sequence ({images.length} pages)</span>
              <span className="docx-preview-hint">Use ⟳ to rotate or ↑ ↓ to reorder pages</span>
            </div>

            <div className="images-thumb-grid">
              {images.map((img, idx) => (
                <div key={img.id} className="image-thumb-card">
                  <div className="image-thumb-preview-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.dataUrl}
                      alt={img.file.name}
                      style={{ transform: `rotate(${img.rotation}deg)` }}
                    />
                    <span className="image-order-badge">#{idx + 1}</span>
                  </div>

                  <div className="image-thumb-info">
                    <span className="image-thumb-name" title={img.file.name}>{img.file.name}</span>
                    <span className="image-thumb-meta">
                      {img.width}×{img.height} · {(img.file.size / 1024).toFixed(0)} KB
                    </span>
                  </div>

                  <div className="image-thumb-actions">
                    <button
                      type="button"
                      title="Move earlier"
                      onClick={() => moveImage(idx, -1)}
                      disabled={idx === 0 || busy}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="Move later"
                      onClick={() => moveImage(idx, 1)}
                      disabled={idx === images.length - 1 || busy}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      title="Rotate 90° clockwise"
                      onClick={() => rotateImage(idx)}
                      disabled={busy}
                    >
                      ⟳
                    </button>
                    <button
                      type="button"
                      className="delete-img-btn"
                      title="Remove image"
                      onClick={() => removeImage(idx)}
                      disabled={busy}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
