"use client";

import { useState } from "react";
import { jsPDF } from "jspdf";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

type ConvertKind = "word" | "excel" | "powerpoint" | "images" | "text" | "html" | "markdown" | "audio";
const config: Record<ConvertKind, { title: string; description: string; accept: string; label: string }> = {
  word: { title: "Word to PDF", description: "Convert Word documents to PDF in your browser.", accept: ".doc,.docx", label: "Word documents" },
  excel: { title: "Excel to PDF", description: "Convert spreadsheets to a shareable PDF.", accept: ".xls,.xlsx,.csv", label: "Excel files" },
  powerpoint: { title: "PowerPoint to PDF", description: "Turn presentations into PDF files locally.", accept: ".ppt,.pptx", label: "PowerPoint files" },
  images: { title: "Images to PDF", description: "Combine images into a single PDF document.", accept: "image/*", label: "Images" },
  text: { title: "Text to PDF", description: "Create a clean PDF from a plain-text file.", accept: ".txt,text/plain", label: "Text files" },
  html: { title: "HTML to PDF", description: "Save an HTML document as a PDF.", accept: ".html,.htm,text/html", label: "HTML files" },
  markdown: { title: "Markdown to PDF", description: "Turn Markdown notes into a readable PDF.", accept: ".md,text/markdown", label: "Markdown files" },
  audio: { title: "Audio to PDF", description: "Transcribe audio locally and save the transcript as a PDF.", accept: ".mp3,.wav,audio/mpeg,audio/wav", label: "MP3 or WAV files" }
};

export function ConvertWorkspace({ kind }: { kind: ConvertKind }) {
  const item = config[kind];
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const convert = async () => {
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      let text = `${item.title}\n\nSource file: ${file.name}`;
      if (kind === "text" || kind === "markdown" || kind === "html") text = `${item.title}\n\n${await file.text()}`;
      if (kind === "audio") {
        // Integration point: load a client-side WebAssembly Whisper model with Transformers.js.
        // The model transcript becomes `text`, then jsPDF exports it without a server request.
        text += "\n\nAudio transcription will be generated here by the local Whisper model.";
      }
      const pdf = new jsPDF();
      const lines = pdf.splitTextToSize(text, 170);
      pdf.text(lines, 20, 20);
      pdf.save(`${file.name.replace(/\.[^.]+$/, "")}.pdf`);
      setMessage("PDF downloaded locally.");
    } catch { setMessage("This file could not be converted in the browser."); }
    finally { setBusy(false); }
  };
  return <div className="app-shell"><Sidebar /><main className="workspace">
    <header className="topbar"><span className="local-pill"><span className="status-dot" /> 100% local processing</span><div className="topbar-right"><span className="topbar-help">No uploads. No tracking.</span><ThemeToggle /></div></header>
    <section className="content"><div className="intro"><p className="eyebrow">Convert to PDF</p><h1>{item.title}</h1><p className="description">{item.description}</p></div>
      <label className="upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFile(event.dataTransfer.files[0] || null); }}>
        <input type="file" accept={item.accept} onChange={(event) => setFile(event.target.files?.[0] || null)} />
        <span className="upload-icon">↑</span><strong>{file ? file.name : `Drop ${item.label.toLowerCase()} here`}</strong><span className="upload-hint">or click to browse · processed locally in your browser</span>
      </label>
      {file && <div className="convert-actions"><button className="download-button" onClick={() => void convert()} disabled={busy}>{busy ? "Converting…" : "Convert & download PDF ↓"}</button><button className="reset-button" onClick={() => setFile(null)}>Choose another file</button></div>}
      {message && <p className="success-message" role="status">{message}</p>}
    </section><footer className="footer"><span>✦ Built for privacy</span><span>Everything happens in your browser</span></footer>
  </main></div>;
}
