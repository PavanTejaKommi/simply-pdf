"use client";

import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { WordConverter } from "./convert/WordConverter";
import { ExcelConverter } from "./convert/ExcelConverter";
import { PowerPointConverter } from "./convert/PowerPointConverter";
import { ImagesConverter } from "./convert/ImagesConverter";
import { TextConverter } from "./convert/TextConverter";
import { HtmlConverter } from "./convert/HtmlConverter";
import { MarkdownConverter } from "./convert/MarkdownConverter";
import { AudioConverter } from "./convert/AudioConverter";

type ConvertKind = "word" | "excel" | "powerpoint" | "images" | "text" | "html" | "markdown" | "audio";

const config: Record<ConvertKind, { title: string; description: string }> = {
  word: {
    title: "Word to PDF",
    description: "Convert Word documents to PDF with exact layouts, tables, fonts, and styles matching Microsoft Word.",
  },
  excel: {
    title: "Excel to PDF",
    description: "Convert spreadsheets to PDF preserving column headers, gridlines, formulas, and formatting across sheets.",
  },
  powerpoint: {
    title: "PowerPoint to PDF",
    description: "Turn presentations into widescreen landscape PDF slides with shapes, titles, and bullet lists.",
  },
  images: {
    title: "Images to PDF",
    description: "Combine, rotate, and reorder multiple images into a clean multi-page PDF document.",
  },
  text: {
    title: "Text to PDF",
    description: "Create a formatted PDF from plain text or code with line numbers, custom typography, and margins.",
  },
  html: {
    title: "HTML to PDF",
    description: "Save an HTML web document as a high-DPI PDF preserving full CSS styling, tables, and colors.",
  },
  markdown: {
    title: "Markdown to PDF",
    description: "Render GitHub-flavored markdown with styled headings, code syntax, tables, and quotes into a PDF.",
  },
  audio: {
    title: "Audio to PDF",
    description: "Analyze audio recordings with waveform visualizer and export executive transcript meeting reports.",
  }
};

export function ConvertWorkspace({ kind }: { kind: ConvertKind }) {
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
            <p className="eyebrow">Convert to PDF</p>
            <h1>{item.title}</h1>
            <p className="description">{item.description}</p>
          </div>

          {kind === "word" && <WordConverter />}
          {kind === "excel" && <ExcelConverter />}
          {kind === "powerpoint" && <PowerPointConverter />}
          {kind === "images" && <ImagesConverter />}
          {kind === "text" && <TextConverter />}
          {kind === "html" && <HtmlConverter />}
          {kind === "markdown" && <MarkdownConverter />}
          {kind === "audio" && <AudioConverter />}
        </section>

        <footer className="footer">
          <span>✦ Built for privacy</span>
          <span>Everything happens locally in your browser</span>
        </footer>
      </main>
    </div>
  );
}
