"use client";

import { Sidebar } from "../Sidebar";
import { ThemeToggle } from "../ThemeToggle";
import { PdfToWordConverter } from "./PdfToWordConverter";
import { PdfToPowerpointConverter } from "./PdfToPowerpointConverter";
import { PdfToExcelConverter } from "./PdfToExcelConverter";
import { PdfToAudioConverter } from "./PdfToAudioConverter";

export type FromPdfKind = "word" | "powerpoint" | "excel" | "audio" | "office" | "images" | "text" | "html" | "pdfa";

const config: Record<
  string,
  { title: string; description: string; eyebrow: string }
> = {
  word: {
    title: "PDF to Word",
    description: "Convert PDF documents into clean, editable Microsoft Word documents (.docx) with formatted headings, typography, and paragraphs.",
    eyebrow: "Convert from PDF",
  },
  powerpoint: {
    title: "PDF to PowerPoint",
    description: "Convert PDF slides into genuine OpenXML PowerPoint presentations (.pptx) with high-res graphics and editable text boxes.",
    eyebrow: "Convert from PDF",
  },
  excel: {
    title: "PDF to Excel",
    description: "Extract data tables, rows, columns, and numbers from PDF into genuine multi-sheet Excel workbooks (.xlsx).",
    eyebrow: "Convert from PDF",
  },
  audio: {
    title: "PDF to Audio",
    description: "Listen to your PDF documents with natural browser speech voices, live reading tracking, and export to audio (.wav).",
    eyebrow: "Convert from PDF",
  },
  office: {
    title: "PDF to Office",
    description: "Extract readable PDF content into editable Office documents.",
    eyebrow: "Convert from PDF",
  },
  images: {
    title: "PDF to Images",
    description: "Rasterize PDF pages into high-resolution image files.",
    eyebrow: "Convert from PDF",
  },
  text: {
    title: "PDF to Text",
    description: "Extract raw text content from PDF pages without styling.",
    eyebrow: "Convert from PDF",
  },
  html: {
    title: "PDF to HTML",
    description: "Convert PDF pages into clean web-viewable HTML documents.",
    eyebrow: "Convert from PDF",
  },
  pdfa: {
    title: "PDF to PDF/A",
    description: "Rewrite the document with archive metadata for long-term storage.",
    eyebrow: "Convert from PDF",
  },
};

export function FromPdfWorkspace({ kind }: { kind: FromPdfKind }) {
  const item = config[kind] || config.word;

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="workspace">
        <header className="topbar">
          <span className="local-pill">
            <span className="status-dot" /> 100% local processing
          </span>
          <div className="topbar-right">
            <span className="topbar-help">No uploads. No tracking.</span>
            <ThemeToggle />
          </div>
        </header>

        <section className="content">
          <div className="intro">
            <p className="eyebrow">{item.eyebrow}</p>
            <h1>{item.title}</h1>
            <p className="description">{item.description}</p>
          </div>

          {kind === "word" && <PdfToWordConverter />}
          {kind === "powerpoint" && <PdfToPowerpointConverter />}
          {kind === "excel" && <PdfToExcelConverter />}
          {kind === "audio" && <PdfToAudioConverter />}
        </section>

        <footer className="footer">
          <span>✦ Built for privacy</span>
          <span>Everything happens locally in your browser</span>
        </footer>
      </main>
    </div>
  );
}
