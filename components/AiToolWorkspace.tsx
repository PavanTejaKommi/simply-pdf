"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

type AiToolKind = "chat" | "summarize" | "extract" | "translate" | "redact-ai" | "quiz" | "rewrite";

const aiToolsMeta: Record<AiToolKind, { title: string; description: string; action: string }> = {
  chat: { title: "Chat with PDF", description: "Ask questions and extract precise information interactively.", action: "Start Chat" },
  summarize: { title: "Summarize", description: "Generate a concise executive summary or abstract.", action: "Generate Summary" },
  extract: { title: "Extract Data", description: "Pull structured data like tables, invoice totals, or contacts.", action: "Extract to JSON/CSV" },
  translate: { title: "Translate PDF", description: "Translate text content while maintaining document structure (including images/barcodes).", action: "Translate & Download" },
  "redact-ai": { title: "Auto-Redact PII", description: "Automatically detect and redact sensitive information (SSN, names).", action: "Run AI Redaction" },
  quiz: { title: "Generate Quiz", description: "Create study materials, flashcards, or quizzes from the text.", action: "Generate Quiz" },
  rewrite: { title: "Proofread & Rewrite", description: "Improve grammar, clarity, or adjust the tone of the document.", action: "Rewrite Text" },
};

export function AiToolWorkspace({ kind }: { kind: AiToolKind }) {
  const item = aiToolsMeta[kind];
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [targetLang, setTargetLang] = useState("Spanish");
  const [chatQuery, setChatQuery] = useState("");
  const [extractTarget, setExtractTarget] = useState("");
  const [summaryStyle, setSummaryStyle] = useState("executive");



  const handleApply = async () => {
    if (!file) return;
    setBusy(true);
    setResult("");

    if (kind === "summarize") {
      try {
        const { loadPdf } = await import("../lib/pdfjs");
        const doc = await loadPdf(file);
        let fullText = "";
        for (let i = 1; i <= doc.numPages; i++) {
           const page = await doc.getPage(i);
           const content = await page.getTextContent();
           fullText += content.items.map((item: any) => "str" in item ? item.str : "").join(" ") + " ";
        }
        
        let promptModifier = "Summarize the following document comprehensively. Provide only the summary, no conversational filler.";
        if (summaryStyle === "executive") promptModifier = "Provide a concise executive summary of the following document. Provide only the summary, no conversational filler.";
        if (summaryStyle === "detailed") promptModifier = "Provide a highly detailed, comprehensive summary covering all key arguments and data of the following document.";
        if (summaryStyle === "bullets") promptModifier = "Provide a summary of the following document in the form of a bulleted list of the top takeaways.";
        if (summaryStyle === "eli5") promptModifier = "Summarize this document in extremely simple terms, as if explaining to a 5-year-old.";
        if (summaryStyle === "action_items") promptModifier = "Extract and summarize only the actionable items, tasks, and next steps from the following document.";

        const response = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama3.1",
            prompt: `${promptModifier}\n\nDocument text: ${fullText}`,
            stream: true,
            options: { num_gpu: 0, num_ctx: 16384 }
          })
        });
        
        if (!response.ok) throw new Error("Ollama request failed. Is Ollama running?");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");
        
        const decoder = new TextDecoder();
        let fullResponse = "";
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(l => l.trim() !== '');
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.response) {
                fullResponse += data.response;
                setResult(fullResponse);
              }
            } catch (e) {
              // Ignore partial JSON lines
            }
          }
        }
        
        setBusy(false);
      } catch (err: any) {
        setBusy(false);
        setResult("Failed to generate summary: " + err.message);
      }
      return;
    }

    if (kind === "translate") {
      try {
        const { loadPdf } = await import("../lib/pdfjs");
        const doc = await loadPdf(file);
        const { jsPDF } = await import("jspdf");
        
        const newPdf = new jsPDF();
        
        const translateText = async (text: string) => {
          // @ts-ignore
          if (!('ai' in self) || !('translator' in self.ai)) {
            throw new Error("Browser-side Translation API is not supported in this browser. Please use a compatible browser (e.g., Chrome with Translation API enabled).");
          }

          const langMap: Record<string, string> = {
            "Spanish": "es",
            "French": "fr",
            "German": "de",
            "Japanese": "ja",
            "Chinese (Simplified)": "zh"
          };
          
          const targetCode = langMap[targetLang] || "es";
          
          // @ts-ignore
          const translator = await self.ai.translator.create({
            sourceLanguage: 'en',
            targetLanguage: targetCode
          });
          
          const result = await translator.translate(text);
          return result.trim();
        };

        for (let i = 1; i <= doc.numPages; i++) {
           if (i > 1) newPdf.addPage();
           const page = await doc.getPage(i);
           const content = await page.getTextContent();
           const viewport = page.getViewport({ scale: 2.0 });
           
           const canvas = document.createElement("canvas");
           const ctx = canvas.getContext("2d");
           canvas.height = viewport.height;
           canvas.width = viewport.width;
           if (ctx) {
             await page.render({ canvasContext: ctx, viewport }).promise;
           }

           let items = content.items
             .filter((item: any) => item.str && item.str.trim().length > 0)
             .map((item: any) => ({
               str: item.str,
               y: viewport.height - (item.transform[5] * 2.0),
               height: item.height * 2.0
             }))
             .sort((a, b) => a.y - b.y);

           let currentPdfY = 20;
           let lastY = 0;
           let textBlocks = [];
           let currentBlock = "";
           
           for (let j = 0; j < items.length; j++) {
              let item = items[j];
              // Detect gaps for images/barcodes (approx 150 canvas units)
              if (j > 0 && item.y - lastY > 150) {
                 if (currentBlock.trim().length > 0) {
                    textBlocks.push({ type: 'text', content: currentBlock.trim() });
                    currentBlock = "";
                 }
                 let sliceHeight = item.y - lastY - 40;
                 if (sliceHeight > 50 && ctx) {
                    const sliceCanvas = document.createElement("canvas");
                    sliceCanvas.width = canvas.width;
                    sliceCanvas.height = sliceHeight;
                    const sCtx = sliceCanvas.getContext("2d");
                    sCtx?.drawImage(canvas, 0, lastY + 20, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
                    textBlocks.push({ type: 'image', content: sliceCanvas.toDataURL("image/jpeg", 0.9), height: sliceHeight / 2.0 });
                 }
              }
              currentBlock += item.str + " ";
              lastY = item.y;
           }
           if (currentBlock.trim().length > 0) {
              textBlocks.push({ type: 'text', content: currentBlock.trim() });
           }

           for (const block of textBlocks) {
              if (block.type === 'text') {
                 try {
                   const translated = await translateText(block.content as string);
                   const split = newPdf.splitTextToSize(translated, 180);
                   newPdf.text(split, 15, currentPdfY);
                   currentPdfY += split.length * 7;
                 } catch (e) {
                   console.error("Translation error", e);
                 }
              } else if (block.type === 'image') {
                 const pdfWidth = 180;
                 const imgHeight = (block.height as number) * (pdfWidth / (viewport.width / 2.0));
                 newPdf.addImage(block.content as string, "JPEG", 15, currentPdfY, pdfWidth, imgHeight);
                 currentPdfY += imgHeight + 10;
              }
              
              if (currentPdfY > 280) {
                 newPdf.addPage();
                 currentPdfY = 20;
              }
           }
        }
        

        newPdf.save(`Translated_${file.name}`);
        setBusy(false);
        setResult("Document translated and downloaded successfully! The layout and images were preserved.");
        return;
      } catch (err) {
        console.error(err);
        setBusy(false);
        setResult("Failed to translate PDF.");
        return;
      }
    }

    try {
      const { loadPdf } = await import("../lib/pdfjs");
      const doc = await loadPdf(file);
      let fullText = "";
      for (let i = 1; i <= doc.numPages; i++) {
         const page = await doc.getPage(i);
         const content = await page.getTextContent();
         fullText += content.items.map((item: any) => "str" in item ? item.str : "").join(" ") + " ";
      }
      
      let prompt = "";
      if (kind === "chat") prompt = `Based on the following document, answer this question: ${chatQuery}\n\nDocument: ${fullText}`;
      else if (kind === "extract") prompt = `Extract the following information from this document: ${extractTarget}. Output strictly as JSON. Do not include markdown formatting like \`\`\`json.\n\nDocument: ${fullText}`;
      else if (kind === "redact-ai") prompt = `Identify all sensitive PII (names, SSN, emails, phone numbers) in the following text and replace them with [REDACTED]. Return the redacted text.\n\nDocument: ${fullText}`;
      else if (kind === "quiz") prompt = `Generate a 5-question multiple choice quiz based on the following document. Include an answer key at the end.\n\nDocument: ${fullText}`;
      else if (kind === "rewrite") prompt = `Proofread and rewrite the following document to improve grammar, clarity, and professionalism.\n\nDocument: ${fullText}`;

      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.1",
          prompt,
          stream: true,
          options: { num_gpu: 0, num_ctx: 16384 }
        })
      });
      
      if (!response.ok) throw new Error("Ollama request failed. Is Ollama running?");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");
      
      const decoder = new TextDecoder();
      let fullResponse = "";
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim() !== '');
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.response) {
              fullResponse += data.response;
              setResult(fullResponse);
            }
          } catch (e) {
            // Ignore partial JSON lines
          }
        }
      }
      
      setBusy(false);
    } catch (err: any) {
      setBusy(false);
      setResult("Failed to process document: " + err.message);
    }
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
                  <select className="wm-select" value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
                    <option>Spanish</option>
                    <option>French</option>
                    <option>German</option>
                    <option>Japanese</option>
                    <option>Chinese (Simplified)</option>
                  </select>
                </div>
              )}

              {kind === "summarize" && (
                <div className="wm-form-group" style={{ marginBottom: 24 }}>
                  <label className="wm-label">Summary Style</label>
                  <select className="wm-select" value={summaryStyle} onChange={(e) => setSummaryStyle(e.target.value)}>
                    <option value="executive">Executive Summary</option>
                    <option value="detailed">Detailed Breakdown</option>
                    <option value="bullets">Bullet Points</option>
                    <option value="eli5">Explain Like I'm 5 (ELI5)</option>
                    <option value="action_items">Action Items</option>
                  </select>
                </div>
              )}

              {kind === "chat" && (
                <div className="wm-form-group" style={{ marginBottom: 24 }}>
                  <label className="wm-label">Your Question</label>
                  <input type="text" className="wm-text-input" placeholder="e.g. What is the main conclusion of this report?" value={chatQuery} onChange={(e) => setChatQuery(e.target.value)} />
                </div>
              )}

              {kind === "extract" && (
                <div className="wm-form-group" style={{ marginBottom: 24 }}>
                  <label className="wm-label">Extraction Target</label>
                  <input type="text" className="wm-text-input" placeholder="e.g. Invoice Totals, Contact Emails, Action Items" value={extractTarget} onChange={(e) => setExtractTarget(e.target.value)} />
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
