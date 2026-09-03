"use client";

import { useState } from "react";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";
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

function stripHtml(value: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(value, "text/html");
  return doc.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\t/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractWordText(file: File) {
  const extension = file.name.toLowerCase();
  if (extension.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return normalizeText(result.value || "");
  }

  if (extension.endsWith(".doc") || extension.endsWith(".txt")) {
    return normalizeText(await file.text());
  }

  return normalizeText(await file.text());
}

async function extractExcelText(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const textParts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as Array<Array<string | number | null>>;
    if (!rows.length) continue;

    textParts.push(`Sheet: ${sheetName}`);
    for (const row of rows) {
      const cleaned = row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))).join(" | ");
      if (cleaned.trim()) textParts.push(cleaned);
    }
    textParts.push("");
  }

  return normalizeText(textParts.join("\n"));
}

async function extractPowerPointText(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  if (!slideFiles.length) {
    return normalizeText(await file.text());
  }

  const parts: string[] = [];
  for (let index = 0; index < slideFiles.length; index += 1) {
    const slideFile = slideFiles[index];
    const xml = await zip.file(slideFile)?.async("string");
    if (!xml) continue;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const texts = Array.from(doc.querySelectorAll("a\:t, t"))
      .map((node) => node.textContent?.trim())
      .filter(Boolean) as string[];

    const slideText = texts.join(" ");
    if (slideText) {
      parts.push(`Slide ${index + 1}: ${slideText}`);
    }
  }

  return normalizeText(parts.join("\n\n"));
}

type PdfDocument = InstanceType<typeof jsPDF>;

function pushTextPage(pdf: PdfDocument, text: string, title: string, fileName: string) {
  const pageWidth = 515;
  const pageHeight = 760;
  let y = 72;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text(title, 40, 52);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(90, 90, 90);
  pdf.text(`Source: ${fileName}`, 40, 68);
  pdf.setTextColor(0, 0, 0);

  const lines = pdf.splitTextToSize(text, pageWidth);
  pdf.setFontSize(11);

  for (const line of lines) {
    if (y > pageHeight) {
      pdf.addPage();
      y = 52;
    }

    pdf.text(line, 40, y);
    y += 16;
  }
}

async function exportImagePdf(file: File, title: string) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image could not be decoded"));
    img.src = dataUrl;
  });

  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - 80;
  const maxHeight = pageHeight - 100;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  const x = (pageWidth - width) / 2;
  const y = (pageHeight - height) / 2;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(title, 40, 40);
  pdf.addImage(dataUrl, "PNG", x, y, width, height, undefined, "FAST");
  return pdf;
}

async function generatePdfForFile(file: File, kind: ConvertKind) {
  const title = config[kind].title;

  if (kind === "images") {
    return exportImagePdf(file, title);
  }

  if (kind === "audio") {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const text = [
      "Audio transcription is not yet running locally in-browser.",
      "The app is ready for a client-side Whisper/Transformers.js integration point.",
      `Uploaded file: ${file.name}`,
      `Size: ${(file.size / 1024 / 1024).toFixed(2)} MB`,
      "",
      "Integrate a WASM transcription model here, then replace this placeholder with the generated transcript before exporting the PDF."
    ].join("\n");
    pushTextPage(pdf, text, title, file.name);
    return pdf;
  }

  let text = "";
  switch (kind) {
    case "word":
      text = await extractWordText(file);
      break;
    case "excel":
      text = await extractExcelText(file);
      break;
    case "powerpoint":
      text = await extractPowerPointText(file);
      break;
    case "text":
      text = normalizeText(await file.text());
      break;
    case "html":
      text = stripHtml(await file.text());
      break;
    case "markdown":
      text = normalizeText(await file.text()).replace(/^#+\s*/gm, "");
      break;
    default:
      text = `${file.name}\n\nNo readable content could be extracted for this file type.`;
  }

  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const fallback = text || `No readable content could be extracted from ${file.name}.`;
  pushTextPage(pdf, fallback, title, file.name);
  return pdf;
}

export function ConvertWorkspace({ kind }: { kind: ConvertKind }) {
  const item = config[kind];
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const convert = async () => {
    if (!file) return;

    setBusy(true);
    setMessage("");

    try {
      const pdf = await generatePdfForFile(file, kind);
      pdf.save(`${file.name.replace(/\.[^.]+$/, "")}.pdf`);
      setMessage("PDF downloaded locally with the extracted content.");
    } catch {
      setMessage("This file could not be converted in the browser.");
    } finally {
      setBusy(false);
    }
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
