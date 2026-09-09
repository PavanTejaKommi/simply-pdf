"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { PageTile } from "./PageTile";
import { createPdfFromPages, downloadPdf, type PdfPage } from "../lib/pdf";
import { loadPdf } from "../lib/pdfjs";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Mode = "merge" | "split" | "organize";
const copy = {
  merge: { eyebrow: "Combine documents", title: "Merge PDF", description: "Bring multiple PDFs together in any order.", action: "Merge & download", empty: "Drop PDFs here to merge them" },
  split: { eyebrow: "Extract pages", title: "Split PDF", description: "Select a range of pages and save it as a new PDF.", action: "Split & download", empty: "Drop one PDF here to split it" },
  organize: { eyebrow: "Advanced page tools", title: "Organize PDF", description: "Rotate, delete, insert, extract and arrange pages entirely in your browser.", action: "Save organized PDF", empty: "Drop a PDF file here to organize it" }
} as const;

function SortableTile({
  page,
  selected,
  onClick,
  onDelete,
  onRotate,
  rotation,
  swappable = true,
}: {
  page: PdfPage;
  selected?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
  onRotate?: () => void;
  rotation?: number;
  swappable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    disabled: !swappable,
  });
  return (
    <div
      ref={setNodeRef}
      className="tile-container"
      style={{
        transform: swappable ? CSS.Transform.toString(transform) : undefined,
        transition: swappable ? transition : undefined,
        zIndex: isDragging ? 2 : 1,
      }}
      {...(swappable ? attributes : {})}
      {...(swappable ? listeners : {})}
    >
      <PageTile page={page} selected={selected} onClick={onClick} draggable={swappable} />
      {onDelete && (
        <button
          type="button"
          className="tile-delete-btn"
          title="Delete this page"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
          <span>Delete</span>
        </button>
      )}
      {onRotate && (
        <button
          type="button"
          className="tile-action-btn"
          title={`Rotate this page ${rotation ?? 90}°`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRotate();
          }}
        >
          <span>⟳ Rotate {rotation ?? 90}°</span>
        </button>
      )}
    </div>
  );
}

export function PdfWorkspace({ mode }: { mode: Mode }) {
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [range, setRange] = useState({ start: "1", end: "1" });
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rotation, setRotation] = useState<90 | 180 | 270>(90);
  const [nUp, setNUp] = useState<"" | "2" | "4" | "8">("");
  const [booklet, setBooklet] = useState(false);
  const [reverseSecond, setReverseSecond] = useState(false);
  const [activeTool, setActiveTool] = useState("organize");
  const content =
    mode === "organize" && activeTool === "interleave"
      ? {
          eyebrow: "Alternate pages",
          title: "Interleave PDF",
          description: "Merge odd and even scanned pages from multiple PDFs or alternate pages into a single document.",
          action: "Save interleaved PDF",
          empty: "Drop 2 or more PDFs here to interleave them",
        }
      : copy[mode];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const prevToolRef = useRef(activeTool);
  useEffect(() => {
    const handleToolChange = (tool: string) => {
      setActiveTool(tool);
      if (tool === "n-up") setNUp((prev) => prev || "2");
      if (tool === "booklet") setBooklet(true);
    };
    const updateTool = () => handleToolChange(window.location.hash.replace("#", "") || "organize");
    const selectTool = (event: Event) => {
      const tool = (event as CustomEvent<string>).detail || "organize";
      handleToolChange(tool);
      window.history.replaceState(null, "", tool === "organize" ? "/organize" : `/organize#${tool}`);
    };
    updateTool();
    window.addEventListener("hashchange", updateTool);
    window.addEventListener("organize-tool", selectTool);
    return () => {
      window.removeEventListener("hashchange", updateTool);
      window.removeEventListener("organize-tool", selectTool);
    };
  }, []);

  useEffect(() => {
    if (mode === "organize" && activeTool === "extract" && prevToolRef.current !== "extract" && pages.length > 0) {
      setSelectedPageIds(new Set(pages.map((p) => p.id)));
    }
    prevToolRef.current = activeTool;
  }, [mode, activeTool, pages]);

  const loadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    if (!list.every((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) { setError("Please choose PDF files only."); return; }
    const allowMultiple = mode === "merge" || activeTool === "interleave";
    if (!allowMultiple && list.length > 1) { setError("Only one PDF is allowed here. Multiple PDFs are supported in Merge PDF and Interleave."); return; }
    setError("");
    const next: PdfPage[] = [];
    const fileOffset = pages.reduce((max, page) => Math.max(max, page.fileIndex + 1), 0);
    for (let fileIndex = 0; fileIndex < list.length; fileIndex++) {
      const doc = await loadPdf(list[fileIndex]);
      const sourceIndex = fileOffset + fileIndex;
      for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex++) {
        next.push({ id: `${sourceIndex}-${pageIndex}-${list[fileIndex].name}`, file: list[fileIndex], fileIndex: sourceIndex, pageIndex, url: "", rotation: 0 });
      }
    }
    setPages((current) => (allowMultiple && current.length > 0) || mode === "merge" ? [...current, ...next] : next);
    const totalPages = (allowMultiple && pages.length > 0) || mode === "merge" ? pages.length + next.length : next.length;
    setRange({ start: "1", end: String(totalPages) });
    if (mode === "split" || mode === "organize") {
      setSelectedPageIds((current) => (allowMultiple && current.size > 0) ? new Set([...Array.from(current), ...next.map((page) => page.id)]) : new Set(next.map((page) => page.id)));
    } else {
      setSelectedPageIds(new Set());
    }
  }, [mode, activeTool, pages]);

  const selected = pages.filter((p) => selectedPageIds.has(p.id));
  const uniqueFiles = Array.from(
    new Map(
      pages
        .filter((p) => p.file)
        .map((p) => [
          p.fileIndex,
          {
            fileIndex: p.fileIndex,
            name: p.file!.name,
            count: pages.filter((x) => x.fileIndex === p.fileIndex).length,
          },
        ])
    ).values()
  );

  const interleave = () => {
    if (pages.length < 2) {
      setError("Please add at least 2 pages or 2 PDF files to interleave.");
      return;
    }
    setError("");

    // Identify unique document fileIndex values in order of appearance
    const docIndices: number[] = [];
    for (const p of pages) {
      if (!docIndices.includes(p.fileIndex)) {
        docIndices.push(p.fileIndex);
      }
    }

    if (docIndices.length > 1) {
      // Interleave multiple documents
      const docGroups = docIndices.map((fIdx, idx) => {
        const group = pages.filter((p) => p.fileIndex === fIdx);
        // If reverseSecond is checked and this is the second document:
        if (reverseSecond && idx === 1) {
          return [...group].reverse();
        }
        return group;
      });

      const maxDepth = Math.max(...docGroups.map((g) => g.length), 0);
      const result: PdfPage[] = [];

      for (let pageIdx = 0; pageIdx < maxDepth; pageIdx++) {
        for (let docIdx = 0; docIdx < docGroups.length; docIdx++) {
          if (pageIdx < docGroups[docIdx].length) {
            result.push(docGroups[docIdx][pageIdx]);
          }
        }
      }

      setPages(result);
    } else {
      // Interleave single document: split into two halves
      const half = Math.ceil(pages.length / 2);
      const firstHalf = pages.slice(0, half);
      let secondHalf = pages.slice(half);
      if (reverseSecond) {
        secondHalf = [...secondHalf].reverse();
      }
      const result: PdfPage[] = [];
      const maxLen = Math.max(firstHalf.length, secondHalf.length);
      for (let i = 0; i < maxLen; i++) {
        if (firstHalf[i]) result.push(firstHalf[i]);
        if (secondHalf[i]) result.push(secondHalf[i]);
      }
      setPages(result);
    }
  };
  const deletePage = (id: string) => {
    setPages((items) => items.filter((p) => p.id !== id));
    setSelectedPageIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };
  const deleteSelected = () => {
    setPages((items) => items.filter((p) => !selectedPageIds.has(p.id)));
    setSelectedPageIds(new Set());
  };
  const rotatePage = (id: string, deg: number) => {
    setPages((items) => items.map((p) => (p.id === id ? { ...p, rotation: ((p.rotation || 0) + deg) % 360 } : p)));
  };
  const isSelectable = mode === "organize" && activeTool === "extract";
  const isSwappable = mode === "organize" && activeTool === "organize";
  const isPageInRange = (index: number) => {
    const start = Number(range.start) || 1;
    const end = Number(range.end) || pages.length;
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    const pageNum = index + 1;
    return pageNum >= min && pageNum <= max;
  };
  const inRangePages = mode === "split" ? pages.filter((_, idx) => isPageInRange(idx)) : [];
  const download = async (kind = "organized") => {
    if (!pages.length) return;
    setBusy(true); setError("");
    try {
      const isExtracting = kind === "extract" || isSelectable;
      const chosen = mode === "split"
        ? inRangePages
        : isExtracting
        ? selected
        : pages;
      if (!chosen.length) {
        setError(
          mode === "split"
            ? "Please enter a valid page range to split."
            : isExtracting
            ? "Please select at least one page to extract."
            : "Please add at least one page."
        );
        setBusy(false);
        return;
      }
      const useNUp = activeTool === "n-up" ? ((Number(nUp) || 2) as 2 | 4 | 8) : (nUp ? (Number(nUp) as 2 | 4 | 8) : undefined);
      const useBooklet = activeTool === "booklet" ? booklet : false;
      const filename =
        mode === "merge"
          ? "merged.pdf"
          : mode === "split"
          ? "split.pdf"
          : isExtracting
          ? "extracted.pdf"
          : activeTool === "booklet"
          ? "booklet.pdf"
          : activeTool === "n-up"
          ? `${useNUp}-up.pdf`
          : activeTool === "interleave"
          ? "interleaved.pdf"
          : "organized.pdf";

      downloadPdf(
        await createPdfFromPages(chosen, { nUp: useNUp, booklet: useBooklet }),
        filename
      );
    } catch (err) {
      console.error("createPdfFromPages error:", err);
      setError("We could not create that PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const onDrop = (event: DragEndEvent) => {
    if (!isSwappable) return;
    if (event.over && event.active.id !== event.over.id) setPages((items) => arrayMove(items, items.findIndex((item) => item.id === event.active.id), items.findIndex((item) => item.id === event.over!.id)));
  };
  const updateRange = (field: "start" | "end", value: string) => {
    const nextRange = { ...range, [field]: value.replace(/\D/g, "") }; setRange(nextRange);
  };
  const normalizeRange = () => {
    const start = Math.max(1, Math.min(Number(range.start) || 1, pages.length)), end = Math.max(start, Math.min(Number(range.end) || pages.length, pages.length));
    setRange({ start: String(start), end: String(end) });
  };

  return <div className="app-shell"><Sidebar /><main className="workspace">
    <header className="topbar"><span className="local-pill"><span className="status-dot" /> 100% local processing</span><div className="topbar-right"><span className="topbar-help">No uploads. No tracking.</span><ThemeToggle /></div></header>
    <section className="content"><div className="intro"><p className="eyebrow">{content.eyebrow}</p><h1>{content.title}</h1><p className="description">{content.description}</p></div>
      {!pages.length ? <label className="upload-zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void loadFiles(e.dataTransfer.files); }}><input type="file" accept="application/pdf,.pdf" multiple={mode === "merge" || activeTool === "interleave"} onChange={(e) => { if (e.target.files) void loadFiles(e.target.files); }} /><span className="upload-icon">↑</span><strong>{content.empty}</strong><span className="upload-hint">or click to browse · PDF up to 100 MB</span></label> : <div className="loaded-area">
        <div className="toolbar">
          <div className="toolbar-left">
            {mode === "merge" || activeTool === "interleave" ? (
              <label className="add-more">
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) void loadFiles(e.target.files);
                  }}
                />
                ＋ Add PDF
              </label>
            ) : (
              <label className="add-more">
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple={false}
                  onChange={(e) => {
                    if (e.target.files) void loadFiles(e.target.files);
                  }}
                />
                ⟲ Change PDF
              </label>
            )}
            {isSelectable && (
              <button
                type="button"
                className="select-toggle-btn"
                onClick={() => setSelectedPageIds(selectedPageIds.size === pages.length ? new Set() : new Set(pages.map((p) => p.id)))}
              >
                {selectedPageIds.size === pages.length ? "Deselect all" : "Select all"}
              </button>
            )}
          </div>
          <span className="page-count">
            {isSelectable
              ? `${selected.length} of ${pages.length} pages selected`
              : mode === "split"
              ? `${inRangePages.length} of ${pages.length} pages in range`
              : `${pages.length} pages`}
          </span>
        </div>
        {(mode === "merge" || activeTool === "interleave" || uniqueFiles.length > 1) && uniqueFiles.length > 0 && (
          <div className="file-legend">
            <span className="legend-label">Documents:</span>
            {uniqueFiles.map((f) => (
              <span key={f.fileIndex} className={`legend-pill file-color-${f.fileIndex % 10}`}>
                <span className="legend-dot" />
                <span className="legend-name" title={f.name}>{f.name}</span>
                <span className="legend-count">({f.count} {f.count === 1 ? "page" : "pages"})</span>
              </span>
            ))}
          </div>
        )}
        {mode === "organize" && <div className="tool-panel">
          <strong>{activeTool === "organize" ? "Organize PDF" : activeTool === "n-up" ? "N-up layout" : activeTool === "booklet" ? "Booklet formatting" : activeTool === "interleave" ? "Interleave pages" : activeTool === "insert" ? "Insert blank pages" : activeTool === "reverse" ? "Reverse page order" : activeTool === "delete" ? "Delete pages" : activeTool === "extract" ? "Extract PDF" : "Rotate pages"}</strong>
          {activeTool === "organize" && <span className="tool-hint">Drag and drop pages below to swap and reorder them.</span>}
          {activeTool === "rotate" && (
            <>
              <button onClick={() => setPages((items) => items.map((p) => ({ ...p, rotation: ((p.rotation || 0) + rotation) % 360 })))}>
                Rotate all {rotation}°
              </button>
              <select value={rotation} onChange={(e) => setRotation(Number(e.target.value) as 90 | 180 | 270)} aria-label="Rotation angle">
                <option value="90">90°</option>
                <option value="180">180°</option>
                <option value="270">270°</option>
              </select>
              <span className="tool-hint">Click Rotate below any page, or Rotate all.</span>
            </>
          )}
          {activeTool === "delete" && (
            <span className="tool-hint">Click Delete below any page to remove it.</span>
          )}
          {activeTool === "insert" && (
            <button
              onClick={() => {
                const blank: PdfPage = { id: `blank-${Date.now()}`, file: null, fileIndex: 0, pageIndex: 0, url: "", blank: true, width: 612, height: 792 };
                setPages((items) => [...items, blank]);
                setSelectedPageIds((current) => new Set([...Array.from(current), blank.id]));
              }}
            >
              ＋ Insert blank page
            </button>
          )}
          {activeTool === "reverse" && <button onClick={() => setPages((items) => [...items].reverse())}>Reverse all pages</button>}
          {activeTool === "interleave" && (
            <>
              <button type="button" onClick={interleave}>
                ≋ Interleave pages
              </button>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={reverseSecond}
                  onChange={(e) => setReverseSecond(e.target.checked)}
                />
                {uniqueFiles.length > 1
                  ? "Reverse 2nd PDF (for duplex scans)"
                  : "Reverse 2nd half (for duplex scans)"}
              </label>
              <label className="add-more" style={{ display: "inline-flex", alignItems: "center", cursor: "pointer", padding: "5px 10px", borderRadius: "6px", fontSize: "12px", border: "1px dashed currentColor" }}>
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) void loadFiles(e.target.files);
                  }}
                  style={{ display: "none" }}
                />
                ＋ Add another PDF
              </label>
              <span className="tool-hint">
                {uniqueFiles.length > 1
                  ? `Interleaving ${uniqueFiles.length} documents alternately page-by-page.`
                  : "Upload a 2nd PDF or click to interleave front and back halves."}
              </span>
            </>
          )}
          {activeTool === "n-up" && (
            <label>
              Pages per sheet{" "}
              <select value={nUp || "2"} onChange={(e) => setNUp(e.target.value as "" | "2" | "4" | "8")}>
                <option value="2">2 (side-by-side)</option>
                <option value="4">4 (2×2 grid)</option>
                <option value="8">8 (4×2 grid)</option>
              </select>
            </label>
          )}
          {activeTool === "booklet" && (
            <label>
              <input type="checkbox" checked={booklet} onChange={(e) => setBooklet(e.target.checked)} />
              {" "}Enable 2-up booklet formatting (saddle-stitch imposition)
            </label>
          )}
          {activeTool === "extract" && (
            <>
              <span className="tool-hint">Click pages below to select or unselect, then click “Extract selected”.</span>
              <button
                type="button"
                className="download-button secondary"
                style={{ padding: "7px 14px", fontSize: "12px" }}
                onClick={() => void download("extract")}
                disabled={busy || !selected.length}
              >
                Extract selected ({selected.length})
              </button>
            </>
          )}
        </div>}
        {mode === "split" && (
          <div className="range-control">
            <span>Select range</span>
            <input
              type="text"
              inputMode="numeric"
              value={range.start}
              aria-label="First page"
              onChange={(e) => updateRange("start", e.target.value)}
              onBlur={normalizeRange}
            />
            <span>to</span>
            <input
              type="text"
              inputMode="numeric"
              value={range.end}
              aria-label="Last page"
              onChange={(e) => updateRange("end", e.target.value)}
              onBlur={normalizeRange}
            />
            <span className="range-hint">Enter start and end page numbers to set range.</span>
          </div>
        )}
        {mode === "organize" ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDrop}>
            <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
              <div className="page-grid">
                {pages.map((page) => (
                  <SortableTile
                    key={page.id}
                    page={page}
                    swappable={isSwappable}
                    selected={isSelectable ? selectedPageIds.has(page.id) : undefined}
                    onClick={
                      isSelectable
                        ? () =>
                            setSelectedPageIds((current) => {
                              const next = new Set(current);
                              next.has(page.id) ? next.delete(page.id) : next.add(page.id);
                              return next;
                            })
                        : undefined
                    }
                    onDelete={activeTool === "delete" ? () => deletePage(page.id) : undefined}
                    onRotate={activeTool === "rotate" ? () => rotatePage(page.id, rotation) : undefined}
                    rotation={rotation}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="page-grid">
            {pages.map((page, index) => {
              const inRange = isPageInRange(index);
              const isSplit = mode === "split";
              const selectedValue = isSplit ? inRange : isSelectable ? selectedPageIds.has(page.id) : undefined;
              return (
                <div key={page.id} className="tile-container">
                  <PageTile
                    page={page}
                    selected={selectedValue}
                    draggable={false}
                    unselectedLabel={isSplit ? "Not in range" : "Excluded"}
                    onClick={
                      isSelectable
                        ? () =>
                            setSelectedPageIds((current) => {
                              const next = new Set(current);
                              next.has(page.id) ? next.delete(page.id) : next.add(page.id);
                              return next;
                            })
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
        <div className="bottom-actions">
          <button
            className="download-button"
            onClick={() => void download(isSelectable ? "extract" : mode === "split" ? "split" : "organized")}
            disabled={busy || (isSelectable && !selected.length) || (mode === "split" && !inRangePages.length)}
          >
            {busy
              ? "Preparing…"
              : mode === "merge"
              ? "Merge & download  ↓"
              : isSelectable
              ? `Extract selected (${selected.length})  ↓`
              : mode === "split"
              ? `Split & download (${inRangePages.length} pages)  ↓`
              : activeTool === "booklet"
              ? "Download booklet PDF  ↓"
              : activeTool === "n-up"
              ? `Download ${nUp || 2}-up PDF  ↓`
              : activeTool === "interleave"
              ? "Download interleaved PDF  ↓"
              : `${content.action}  ↓`}
          </button>
          <button
            type="button"
            className="reset-button"
            onClick={() => {
              setPages([]);
              setSelectedPageIds(new Set());
            }}
          >
            Start over
          </button>
        </div>
      </div>} {error && <p className="error-message" role="alert">{error}</p>}</section>
    <footer className="footer"><span>✦ Built for privacy</span><span>Everything happens in your browser</span></footer>
  </main></div>;
}
