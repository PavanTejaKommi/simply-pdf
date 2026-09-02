"use client";

import { useCallback, useEffect, useState } from "react";
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
  organize: { eyebrow: "Advanced page tools", title: "Organize PDF", description: "Rotate, delete, insert, extract and arrange pages entirely in your browser.", action: "Save organized PDF", empty: "Drop PDF files here to organize them" }
} as const;

function SortableTile({ page, selected, onClick }: { page: PdfPage; selected: boolean; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : 1 }} {...attributes} {...listeners}><PageTile page={page} selected={selected} onClick={onClick} draggable /></div>;
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
  const [activeTool, setActiveTool] = useState("rotate");
  const content = copy[mode];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    const updateTool = () => setActiveTool(window.location.hash.replace("#", "") || "organize");
    const selectTool = (event: Event) => {
      const tool = (event as CustomEvent<string>).detail;
      setActiveTool(tool);
      window.history.replaceState(null, "", `/organize#${tool}`);
    };
    updateTool();
    window.addEventListener("hashchange", updateTool);
    window.addEventListener("organize-tool", selectTool);
    return () => {
      window.removeEventListener("hashchange", updateTool);
      window.removeEventListener("organize-tool", selectTool);
    };
  }, []);

  const loadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    if (!list.every((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) { setError("Please choose PDF files only."); return; }
    if (mode === "split" && list.length > 1) { setError("This tool accepts one PDF at a time."); return; }
    setError("");
    const next: PdfPage[] = [];
    const fileOffset = pages.reduce((max, page) => Math.max(max, page.fileIndex + 1), 0);
    for (let fileIndex = 0; fileIndex < list.length; fileIndex++) {
      const doc = await loadPdf(list[fileIndex]);
      const sourceIndex = fileOffset + fileIndex;
      for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex++) next.push({ id: `${sourceIndex}-${pageIndex}-${list[fileIndex].name}`, file: list[fileIndex], fileIndex: sourceIndex, pageIndex, url: "", rotation: 0 });
    }
    setPages((current) => mode === "merge" || mode === "organize" ? [...current, ...next] : next);
    const totalPages = (mode === "merge" || mode === "organize") ? pages.length + next.length : next.length;
    setRange({ start: "1", end: String(totalPages) });
    if (mode === "split" || mode === "organize") {
      setSelectedPageIds((current) => new Set(Array.from(current).concat(next.map((page) => page.id))));
    }
  }, [mode, pages]);

  const selected = pages.filter((p) => selectedPageIds.has(p.id));
  const interleave = () => {
    const groups = Array.from(new Set(pages.map((p) => p.fileIndex))).slice(0, 2).map((index) => pages.filter((p) => p.fileIndex === index));
    if (groups.length < 2) { setError("Add two PDFs to interleave them."); return; }
    const result: PdfPage[] = [];
    for (let i = 0; i < Math.max(groups[0].length, groups[1].length); i++) { if (groups[0][i]) result.push(groups[0][i]); if (groups[1][i]) result.push(groups[1][i]); }
    setPages(result);
  };
  const applyToSelection = (fn: (page: PdfPage) => PdfPage) => setPages((items) => items.map((page) => selectedPageIds.has(page.id) ? fn(page) : page));
  const download = async (kind = "organized") => {
    if (!pages.length) return;
    setBusy(true); setError("");
    try {
      const chosen = mode === "split" || kind === "extract" ? selected : pages;
      if (!chosen.length) throw new Error("empty");
      downloadPdf(await createPdfFromPages(chosen, { nUp: nUp ? Number(nUp) as 2 | 4 | 8 : undefined, booklet }), mode === "merge" ? "merged.pdf" : kind === "extract" ? "extracted.pdf" : "organized.pdf");
    } catch { setError("We could not create that PDF. Please try again."); } finally { setBusy(false); }
  };
  const onDrop = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id) setPages((items) => arrayMove(items, items.findIndex((item) => item.id === event.active.id), items.findIndex((item) => item.id === event.over!.id)));
  };
  const updateRange = (field: "start" | "end", value: string) => {
    const nextRange = { ...range, [field]: value.replace(/\D/g, "") }; setRange(nextRange);
    const start = Number(nextRange.start), end = Number(nextRange.end);
    if (start >= 1 && end >= start && end <= pages.length) setSelectedPageIds(new Set(pages.slice(start - 1, end).map((p) => p.id)));
  };
  const normalizeRange = () => {
    const start = Math.max(1, Math.min(Number(range.start) || 1, pages.length)), end = Math.max(start, Math.min(Number(range.end) || pages.length, pages.length));
    setRange({ start: String(start), end: String(end) }); setSelectedPageIds(new Set(pages.slice(start - 1, end).map((p) => p.id)));
  };

  return <div className="app-shell"><Sidebar /><main className="workspace">
    <header className="topbar"><span className="local-pill"><span className="status-dot" /> 100% local processing</span><div className="topbar-right"><span className="topbar-help">No uploads. No tracking.</span><ThemeToggle /></div></header>
    <section className="content"><div className="intro"><p className="eyebrow">{content.eyebrow}</p><h1>{content.title}</h1><p className="description">{content.description}</p></div>
      {!pages.length ? <label className="upload-zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void loadFiles(e.dataTransfer.files); }}><input type="file" accept="application/pdf,.pdf" multiple={mode !== "split"} onChange={(e) => { if (e.target.files) void loadFiles(e.target.files); }} /><span className="upload-icon">↑</span><strong>{content.empty}</strong><span className="upload-hint">or click to browse · PDF up to 100 MB</span></label> : <div className="loaded-area">
        <div className="toolbar"><label className="add-more"><input type="file" accept=".pdf,application/pdf" multiple={mode !== "split"} onChange={(e) => { if (e.target.files) void loadFiles(e.target.files); }} />＋ Add PDF</label><span className="page-count">{pages.length} pages</span></div>
        {mode === "organize" && <div className="tool-panel">
          <strong>{activeTool === "organize" ? "Organize PDF" : activeTool === "n-up" ? "N-up layout" : activeTool === "booklet" ? "Booklet formatting" : activeTool === "interleave" ? "Interleave PDFs" : activeTool === "insert" ? "Insert blank pages" : activeTool === "reverse" ? "Reverse page order" : activeTool === "delete" ? "Delete pages" : activeTool === "extract" ? "Extract pages" : "Rotate pages"}</strong>
          {activeTool === "organize" && <span className="tool-hint">Drag and drop pages below to swap and reorder them.</span>}
          {activeTool === "rotate" && <><button onClick={() => applyToSelection((p) => ({ ...p, rotation: ((p.rotation || 0) + rotation) % 360 }))}>Rotate selected {rotation}°</button><select value={rotation} onChange={(e) => setRotation(Number(e.target.value) as 90 | 180 | 270)} aria-label="Rotation angle"><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select><button onClick={() => setPages((items) => items.map((p) => ({ ...p, rotation: ((p.rotation || 0) + rotation) % 360 })))}>Rotate all</button></>}
          {activeTool === "delete" && <button onClick={() => setPages((items) => items.filter((p) => !selectedPageIds.has(p.id)))}>Delete selected pages</button>}
          {activeTool === "insert" && <button onClick={() => setPages((items) => { const blank: PdfPage = { id: `blank-${Date.now()}`, file: null, fileIndex: 0, pageIndex: 0, url: "", blank: true, width: 612, height: 792 }; const at = Math.max(-1, ...items.map((p, i) => selectedPageIds.has(p.id) ? i : -1)) + 1; return [...items.slice(0, at), blank, ...items.slice(at)]; })}>＋ Insert blank page</button>}
          {activeTool === "reverse" && <button onClick={() => setPages((items) => [...items].reverse())}>Reverse all pages</button>}
          {activeTool === "interleave" && <button onClick={interleave}>Interleave two PDFs</button>}
          {activeTool === "n-up" && <label>Pages per sheet <select value={nUp} onChange={(e) => setNUp(e.target.value as "" | "2" | "4" | "8")}><option value="">Off</option><option value="2">2</option><option value="4">4</option><option value="8">8</option></select></label>}
          {activeTool === "booklet" && <label><input type="checkbox" checked={booklet} onChange={(e) => setBooklet(e.target.checked)} /> Enable booklet formatting</label>}
          {activeTool === "extract" && <span className="tool-hint">Select pages below, then use “Extract selected”.</span>}
        </div>}
        {mode === "split" && <div className="range-control"><span>Select range</span><input type="text" inputMode="numeric" value={range.start} aria-label="First page" onChange={(e) => updateRange("start", e.target.value)} onBlur={normalizeRange} /><span>to</span><input type="text" inputMode="numeric" value={range.end} aria-label="Last page" onChange={(e) => updateRange("end", e.target.value)} onBlur={normalizeRange} /><span className="range-hint">Click pages to include or exclude; non-consecutive extraction is supported</span></div>}
        {mode === "organize" ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDrop}><SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}><div className="page-grid">{pages.map((page) =>         <SortableTile key={page.id} page={page} selected={selectedPageIds.has(page.id)} onClick={() => setSelectedPageIds((current) => { const next = new Set(current); next.has(page.id) ? next.delete(page.id) : next.add(page.id); return next; })} />)}</div></SortableContext></DndContext> : <div className="page-grid">{pages.map((page) => <PageTile key={page.id} page={page} selected={selectedPageIds.has(page.id)} onClick={() => mode === "split" && setSelectedPageIds((current) => { const next = new Set(current); next.has(page.id) ? next.delete(page.id) : next.add(page.id); return next; })} />)}</div>}
        <div className="bottom-actions"><button className="download-button" onClick={() => void download()} disabled={busy}>{busy ? "Preparing…" : `${content.action}  ↓`}</button>{mode === "organize" && <button id="extract" className="download-button secondary" onClick={() => void download("extract")} disabled={busy}>Extract selected</button>}<button className="reset-button" onClick={() => { setPages([]); setSelectedPageIds(new Set()); }}>Start over</button></div>
      </div>} {error && <p className="error-message" role="alert">{error}</p>}</section>
    <footer className="footer"><span>✦ Built for privacy</span><span>Everything happens in your browser</span></footer>
  </main></div>;
}
