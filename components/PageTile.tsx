"use client";

import { useEffect, useRef } from "react";
import type { PdfPage } from "../lib/pdf";
import { loadPdf } from "../lib/pdfjs";

export function PageTile({
  page,
  selected,
  draggable,
  onClick,
  unselectedLabel = "Excluded",
  ...dragProps
}: {
  page: PdfPage;
  selected?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  unselectedLabel?: string;
  [key: string]: unknown;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!page.file) return;
    const file = page.file;
    let cancelled = false;
    void (async () => {
      const document = await loadPdf(file);
      const pdfPage = await document.getPage(page.pageIndex + 1);
      const viewport = pdfPage.getViewport({ scale: 1.1 });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const scale = Math.min(1, 220 / viewport.width);
      const scaled = pdfPage.getViewport({ scale: scale * 1.1 });
      canvas.width = scaled.width;
      canvas.height = scaled.height;
      await pdfPage.render({ canvasContext: canvas.getContext("2d")!, viewport: scaled }).promise;
    })();
    return () => { cancelled = true; };
  }, [page]);
  return (
    <button
      className={`page-tile file-color-${page.fileIndex % 10} ${selected === true ? "selected" : selected === false ? "not-selected" : ""} ${onClick ? "clickable" : "non-clickable"}`}
      onClick={onClick}
      draggable={draggable}
      aria-pressed={selected}
      {...dragProps}
    >
      <span className="page-number">
        <span className="file-badge">PDF {page.fileIndex + 1}</span>
        <span className="page-idx">p.{page.blank ? "Blank" : page.pageIndex + 1}</span>
      </span>
      {selected === true && <span className="selected-badge" aria-hidden="true">✓</span>}
      {selected === false && <span className="not-selected-badge" aria-hidden="true">× <span>{unselectedLabel}</span></span>}
      {page.blank ? <span className="blank-preview" /> : <canvas ref={canvasRef} style={{ transform: `rotate(${page.rotation || 0}deg)` }} />}
      <span className="tile-caption">
        <span className="tile-caption-dot" />
        <span className="tile-caption-text">{page.file?.name ?? "Blank page"}</span>
      </span>
    </button>
  );
}
