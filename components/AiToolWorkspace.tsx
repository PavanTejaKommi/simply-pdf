"use client";

import { useState, useEffect, useRef } from "react";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

type AiToolKind = "chat" | "summarize" | "extract" | "translate" | "redact-ai" | "quiz" | "rewrite";

const aiToolsMeta: Record<AiToolKind, { title: string; description: string; action: string }> = {
  chat: { title: "Chat with PDF", description: "Ask questions and extract precise information interactively.", action: "Start Chat" },
  summarize: { title: "Summarize", description: "Generate a concise executive summary or abstract.", action: "Generate Summary" },
  extract: { title: "Extract Data", description: "Pull structured data like tables, invoice totals, or contacts.", action: "Extract to JSON/CSV" },
  translate: { title: "Translate PDF", description: "Translate text content while maintaining document structure.", action: "Translate Document" },
  "redact-ai": { title: "Auto-Redact PII", description: "Automatically detect and redact sensitive information (SSN, names).", action: "Run AI Redaction" },
  quiz: { title: "Generate Quiz", description: "Create study materials, flashcards, or quizzes from the text.", action: "Generate Quiz" },
  rewrite: { title: "Proofread & Rewrite", description: "Improve grammar, clarity, or adjust the tone of the document.", action: "Rewrite Text" },
};

export function AiToolWorkspace({ kind }: { kind: AiToolKind }) {
  const item = aiToolsMeta[kind];
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const workerRef = useRef<Worker | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ file: string, progress: number } | null>(null);

  useEffect(() => {
    if (kind === "summarize") {
      workerRef.current = new Worker(new URL('../lib/ai-worker.ts', import.meta.url), {
        type: 'module'
      });
      
      workerRef.current.addEventListener('message', (event) => {
        const { status, data, result, error } = event.data;
        if (status === 'progress') {
          setDownloadProgress({ file: data.file, progress: data.progress });
        } else if (status === 'ready') {
          setDownloadProgress(null);
        } else if (status === 'complete') {
          setBusy(false);
          setResult(result);
        } else if (status === 'error') {
          setBusy(false);
          setResult(`Error: ${error}`);
        }
      });

      return () => {
        workerRef.current?.terminate();
      };
    }
  }, [kind]);

  const handleApply = async () => {
    if (!file) return;
    setBusy(true);
    setResult("");

    if (kind === "summarize" && workerRef.current) {
      try {
        const { loadPdf } = await import("../lib/pdfjs");
        const doc = await loadPdf(file);
        let fullText = "";
        for (let i = 1; i <= doc.numPages; i++) {
           const page = await doc.getPage(i);
           const content = await page.getTextContent();
           fullText += content.items.map((item: any) => "str" in item ? item.str : "").join(" ") + " ";
        }
        
        workerRef.current.postMessage({ text: fullText });
      } catch (err) {
        setBusy(false);
        setResult("Failed to read PDF text.");
      }
      return;
    }

    // Simulate API call for other tools
    setTimeout(() => {
      setBusy(false);
      setResult("Since this application is running locally without an external API key, this is a simulated response. In a production environment, this would securely process your PDF using an AI model to fulfill your request.");
    }, 2500);
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="workspace">
        <header className="topbar">
          <span className="local-pill" style={{ backgroundColor: "rgba(138, 43, 226, 0.15)", color: "#8a2be2" }}>
            <span className="status-dot" style={{ backgroundColor: "#8a2be2" }} /> AI Powered
          </span>
          <div className="topbar-right">
            <span className="topbar-help">Requires API Configuration</span>
            <ThemeToggle />
          </div>
        </header>
        <section className="content">
          <div className="intro">
            <p className="eyebrow">AI Assistant</p>
            <h1>{item.title}</h1>
            <p className="description">{item.description}</p>
          </div>
          
          {!file ? (
            <label className="upload-zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && f.type.includes("pdf")) setFile(f); }}>
              <input type="file" accept="application/pdf,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
              <span className="upload-icon">↑</span>
              <strong>Drop your PDF here</strong>
              <span className="upload-hint">or click to browse</span>
            </label>
          ) : (
            <div className="watermark-studio-container" style={{ maxWidth: 700, margin: "0 auto" }}>
              <div className="watermark-file-banner" style={{ marginBottom: 24 }}>
                <div className="file-info-group">
                  <span className="file-type-badge" style={{ backgroundColor: "#8a2be2" }}>PDF</span>
                  <div>
                    <strong>{file.name}</strong>
                    <span className="file-subtext">Ready for AI Processing</span>
                  </div>
                </div>
                <button type="button" className="reset-button" onClick={() => { setFile(null); setResult(""); }}>Choose another file</button>
              </div>

              {kind === "translate" && (
                <div className="wm-form-group" style={{ marginBottom: 24 }}>
                  <label className="wm-label">Target Language</label>
                  <select className="wm-select">
                    <option>Spanish</option>
                    <option>French</option>
                    <option>German</option>
                    <option>Japanese</option>
                    <option>Chinese (Simplified)</option>
                  </select>
                </div>
              )}

              {kind === "extract" && (
                <div className="wm-form-group" style={{ marginBottom: 24 }}>
                  <label className="wm-label">Extraction Target</label>
                  <input type="text" className="wm-text-input" placeholder="e.g. Invoice Totals, Contact Emails, Action Items" />
                </div>
              )}

              {result ? (
                <div style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
                  <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>AI Response</h3>
                  <p style={{ color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>{result}</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <button type="button" className="download-button" onClick={() => void handleApply()} disabled={busy} style={{ width: "100%", marginTop: 24, padding: "14px 20px", fontSize: 15, backgroundColor: "#8a2be2" }}>
                    {busy ? "AI is thinking..." : item.action}
                  </button>
                  
                  {downloadProgress && (
                    <div style={{ padding: "12px", backgroundColor: "rgba(138, 43, 226, 0.05)", borderRadius: 8, fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "80%" }}>
                          Downloading model: {downloadProgress.file}
                        </span>
                        <span>{Math.round(downloadProgress.progress)}%</span>
                      </div>
                      <div style={{ width: "100%", height: 4, backgroundColor: "rgba(0,0,0,0.1)", borderRadius: 2 }}>
                        <div style={{ width: `${downloadProgress.progress}%`, height: "100%", backgroundColor: "#8a2be2", borderRadius: 2, transition: "width 0.2s" }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
        <footer className="footer">
          <span>✦ Powered by SimplyPDF AI</span>
        </footer>
      </main>
    </div>
  );
}
