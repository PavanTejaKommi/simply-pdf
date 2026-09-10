"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { downloadPdf } from "../lib/pdf";
import {
  inspectPdfMetadata,
  applyAdvancedSanitizePdf,
  PdfMetadataReport,
  SanitizeOptions,
} from "../lib/pdf-security";

type SanitizePreset = "deep" | "author" | "timestamps" | "custom";

export function SanitizeWorkspace() {
  const [activeTab, setActiveTab] = useState<"inspect" | "custom">("inspect");
  const [file, setFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [metadata, setMetadata] = useState<PdfMetadataReport | null>(null);

  // Preset Selection
  const [preset, setPreset] = useState<SanitizePreset>("deep");

  // Granular Field Scrubbing Options
  const [stripTitle, setStripTitle] = useState<boolean>(true);
  const [stripAuthor, setStripAuthor] = useState<boolean>(true);
  const [stripSubject, setStripSubject] = useState<boolean>(true);
  const [stripKeywords, setStripKeywords] = useState<boolean>(true);
  const [stripCreator, setStripCreator] = useState<boolean>(true);
  const [stripProducer, setStripProducer] = useState<boolean>(true);
  const [stripCreationDate, setStripCreationDate] = useState<boolean>(true);
  const [stripModificationDate, setStripModificationDate] = useState<boolean>(true);
  const [stripXmp, setStripXmp] = useState<boolean>(true);

  // Custom Replacement Values (optional)
  const [customTitle, setCustomTitle] = useState<string>("");
  const [customAuthor, setCustomAuthor] = useState<string>("");

  // Processing & Feedback State
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Apply Presets
  const applyPreset = (selected: SanitizePreset) => {
    setPreset(selected);
    switch (selected) {
      case "deep":
        setStripTitle(true);
        setStripAuthor(true);
        setStripSubject(true);
        setStripKeywords(true);
        setStripCreator(true);
        setStripProducer(true);
        setStripCreationDate(true);
        setStripModificationDate(true);
        setStripXmp(true);
        setCustomTitle("");
        setCustomAuthor("");
        break;
      case "author":
        setStripTitle(false);
        setStripAuthor(true);
        setStripSubject(false);
        setStripKeywords(false);
        setStripCreator(true);
        setStripProducer(true);
        setStripCreationDate(false);
        setStripModificationDate(false);
        setStripXmp(true);
        break;
      case "timestamps":
        setStripTitle(false);
        setStripAuthor(false);
        setStripSubject(false);
        setStripKeywords(false);
        setStripCreator(false);
        setStripProducer(false);
        setStripCreationDate(true);
        setStripModificationDate(true);
        setStripXmp(true);
        break;
      case "custom":
        break;
    }
  };

  // Inspect Metadata on File Load
  useEffect(() => {
    if (!file) {
      setFileBuffer(null);
      setMetadata(null);
      setMessage("");
      setError("");
      return;
    }

    let isMounted = true;
    const analyzeFile = async () => {
      setIsProcessing(true);
      setError("");
      try {
        const buffer = await file.arrayBuffer();
        if (!isMounted) return;
        setFileBuffer(buffer);

        const report = await inspectPdfMetadata(buffer);
        if (!isMounted) return;
        setMetadata(report);
      } catch (err: any) {
        if (!isMounted) return;
        console.error(err);
        setError("Could not analyze PDF metadata. The file may be password-protected or corrupted.");
      } finally {
        if (isMounted) setIsProcessing(false);
      }
    };

    void analyzeFile();

    return () => {
      isMounted = false;
    };
  }, [file]);

  // Execute Sanitization
  const handleSanitize = async () => {
    if (!file || !fileBuffer) {
      setError("Please select a PDF file first.");
      return;
    }

    setIsProcessing(true);
    setError("");
    setMessage("");

    try {
      const options: SanitizeOptions = {
        stripTitle,
        stripAuthor,
        stripSubject,
        stripKeywords,
        stripCreator,
        stripProducer,
        stripCreationDate,
        stripModificationDate,
        stripXmp,
        customTitle: customTitle.trim() || undefined,
        customAuthor: customAuthor.trim() || undefined,
      };

      const outputBytes = await applyAdvancedSanitizePdf(fileBuffer, options);
      const baseName = file.name.replace(/\.pdf$/i, "");
      downloadPdf(outputBytes, `${baseName}-sanitized.pdf`);

      setMessage(
        "Success! Document metadata, hidden software signatures, and timestamps scrubbed. Your sanitized PDF was downloaded directly to your computer."
      );
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to sanitize PDF.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setFileBuffer(null);
    setMetadata(null);
    setCustomTitle("");
    setCustomAuthor("");
    setMessage("");
    setError("");
  };

  const detectedItemsCount = metadata
    ? [
        metadata.title,
        metadata.author,
        metadata.subject,
        metadata.keywords.length ? "keywords" : "",
        metadata.creator,
        metadata.producer,
        metadata.creationDate,
        metadata.modificationDate,
        metadata.hasXmp ? "xmp" : "",
      ].filter(Boolean).length
    : 0;

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
            <p className="eyebrow">PDF Security &amp; Protection</p>
            <h1>PDF Metadata Sanitizer Studio</h1>
            <p className="description">
              Inspect, clean, and permanently scrub hidden metadata, author information, revision histories, and software traces. 100% client-side privacy.
            </p>
          </div>

          <div className="password-studio-container">
            {/* Mode Navigation Tabs */}
            <div className="pwd-tabs-nav" role="tablist">
              <button
                type="button"
                className={`pwd-tab-btn ${activeTab === "inspect" ? "active" : ""}`}
                onClick={() => {
                  setActiveTab("inspect");
                  setMessage("");
                  setError("");
                }}
              >
                <span className="tab-icon">🛡️</span> Inspector &amp; Scrubbing
              </button>
              <button
                type="button"
                className={`pwd-tab-btn ${activeTab === "custom" ? "active" : ""}`}
                onClick={() => {
                  setActiveTab("custom");
                  setMessage("");
                  setError("");
                }}
              >
                <span className="tab-icon">⚙️</span> Custom Replacement Values
              </button>
            </div>

            {/* Upload Zone */}
            {!file ? (
              <label
                className="upload-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f && (f.type.includes("pdf") || f.name.toLowerCase().endsWith(".pdf"))) {
                    setFile(f);
                  }
                }}
              >
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setFile(f);
                  }}
                />
                <span className="upload-icon">⌫</span>
                <strong>Drop PDF to inspect and sanitize metadata</strong>
                <span className="upload-hint">
                  or click to browse · processed locally in your browser
                </span>
              </label>
            ) : (
              <div className="pwd-workspace-card">
                {/* File Details Banner */}
                <div className="pwd-file-banner">
                  <div className="file-info-group">
                    <span className="file-type-badge badge-pdf">PDF</span>
                    <div>
                      <strong>{file.name}</strong>
                      <span className="file-subtext">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                        {metadata && ` · ${metadata.pageCount} Page(s)`}
                        {metadata && ` · ${detectedItemsCount} Metadata Property(s) Found`}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="reset-button"
                    onClick={handleReset}
                    disabled={isProcessing}
                  >
                    Choose another file
                  </button>
                </div>

                <div className="pwd-form-body">
                  {/* Quick Cleaning Presets */}
                  <div className="pwd-section">
                    <h3>1. Choose Sanitization Preset</h3>
                    <p className="pwd-section-desc">
                      Select a cleaning profile or adjust individual fields below.
                    </p>

                    <div className="perm-profile-grid">
                      {[
                        {
                          id: "deep",
                          name: "Deep Clean",
                          desc: "Strip all metadata, creator info, timestamps & XMP streams (Recommended)",
                        },
                        {
                          id: "author",
                          name: "Anonymize Author",
                          desc: "Remove author, user names & software tools, keep dates",
                        },
                        {
                          id: "timestamps",
                          name: "Strip Timestamps",
                          desc: "Clear creation & modification dates, keep title",
                        },
                        {
                          id: "custom",
                          name: "Custom Matrix",
                          desc: "Manually toggle individual metadata items",
                        },
                      ].map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`perm-chip ${preset === p.id ? "active" : ""}`}
                          onClick={() => applyPreset(p.id as SanitizePreset)}
                        >
                          <strong>{p.name}</strong>
                          <span>{p.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* CUSTOM REPLACEMENTS (Tab 2) */}
                  {activeTab === "custom" && (
                    <div className="pwd-section">
                      <h3>Optional Custom Replacement Values</h3>
                      <p className="pwd-section-desc">
                        Instead of completely blanking out fields, you can replace them with neutral public labels.
                      </p>
                      <div className="pwd-grid-2">
                        <div className="pwd-field-group">
                          <label className="pwd-label">Custom Document Title</label>
                          <input
                            type="text"
                            className="pwd-text-input"
                            placeholder="e.g. Official Document"
                            value={customTitle}
                            onChange={(e) => {
                              setCustomTitle(e.target.value);
                              setPreset("custom");
                            }}
                          />
                        </div>
                        <div className="pwd-field-group">
                          <label className="pwd-label">Custom Author Name</label>
                          <input
                            type="text"
                            className="pwd-text-input"
                            placeholder="e.g. Organization / Anonymous"
                            value={customAuthor}
                            onChange={(e) => {
                              setCustomAuthor(e.target.value);
                              setPreset("custom");
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* METADATA INSPECTION TABLE (Before vs After) */}
                  {metadata && (
                    <div className="pwd-section">
                      <h3>2. Metadata Inspector &amp; Scrubbing Matrix</h3>
                      <p className="pwd-section-desc">
                        Review all detected properties and uncheck any field you wish to preserve.
                      </p>

                      <div
                        style={{
                          border: "1px solid var(--line)",
                          borderRadius: 10,
                          overflow: "hidden",
                          background: "var(--bg)",
                        }}
                      >
                        <table
                          style={{
                            width: "100%",
                            borderCollapse: "collapse",
                            fontSize: 12,
                            textAlign: "left",
                          }}
                        >
                          <thead>
                            <tr
                              style={{
                                borderBottom: "1px solid var(--line)",
                                background: "var(--surface)",
                              }}
                            >
                              <th style={{ padding: "10px 14px", width: "32px" }}>Scrub</th>
                              <th style={{ padding: "10px 14px", width: "160px" }}>Property</th>
                              <th style={{ padding: "10px 14px" }}>Detected Value in PDF</th>
                              <th style={{ padding: "10px 14px", width: "180px" }}>Result After Sanitizing</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              {
                                key: "author",
                                label: "Author",
                                val: metadata.author,
                                checked: stripAuthor,
                                toggle: (v: boolean) => {
                                  setStripAuthor(v);
                                  setPreset("custom");
                                },
                                target: customAuthor.trim() ? customAuthor : "(Empty / Stripped)",
                                sensitive: Boolean(metadata.author),
                              },
                              {
                                key: "title",
                                label: "Title",
                                val: metadata.title,
                                checked: stripTitle,
                                toggle: (v: boolean) => {
                                  setStripTitle(v);
                                  setPreset("custom");
                                },
                                target: customTitle.trim() ? customTitle : "(Empty / Stripped)",
                                sensitive: false,
                              },
                              {
                                key: "creator",
                                label: "Creator (Software)",
                                val: metadata.creator,
                                checked: stripCreator,
                                toggle: (v: boolean) => {
                                  setStripCreator(v);
                                  setPreset("custom");
                                },
                                target: "(Empty / Stripped)",
                                sensitive: Boolean(metadata.creator),
                              },
                              {
                                key: "producer",
                                label: "Producer (Engine)",
                                val: metadata.producer,
                                checked: stripProducer,
                                toggle: (v: boolean) => {
                                  setStripProducer(v);
                                  setPreset("custom");
                                },
                                target: "(Empty / Stripped)",
                                sensitive: Boolean(metadata.producer),
                              },
                              {
                                key: "creationDate",
                                label: "Creation Timestamp",
                                val: metadata.creationDate,
                                checked: stripCreationDate,
                                toggle: (v: boolean) => {
                                  setStripCreationDate(v);
                                  setPreset("custom");
                                },
                                target: "(Reset to Epoch 0)",
                                sensitive: Boolean(metadata.creationDate),
                              },
                              {
                                key: "modificationDate",
                                label: "Modification Timestamp",
                                val: metadata.modificationDate,
                                checked: stripModificationDate,
                                toggle: (v: boolean) => {
                                  setStripModificationDate(v);
                                  setPreset("custom");
                                },
                                target: "(Reset to Epoch 0)",
                                sensitive: Boolean(metadata.modificationDate),
                              },
                              {
                                key: "subject",
                                label: "Subject / Description",
                                val: metadata.subject,
                                checked: stripSubject,
                                toggle: (v: boolean) => {
                                  setStripSubject(v);
                                  setPreset("custom");
                                },
                                target: "(Empty / Stripped)",
                                sensitive: false,
                              },
                              {
                                key: "keywords",
                                label: "Keywords / Tags",
                                val: metadata.keywords.join(", "),
                                checked: stripKeywords,
                                toggle: (v: boolean) => {
                                  setStripKeywords(v);
                                  setPreset("custom");
                                },
                                target: "(Empty / Stripped)",
                                sensitive: false,
                              },
                              {
                                key: "xmp",
                                label: "XMP Metadata Stream",
                                val: metadata.hasXmp
                                  ? "Embedded XML Metadata Packet Present"
                                  : "None",
                                checked: stripXmp,
                                toggle: (v: boolean) => {
                                  setStripXmp(v);
                                  setPreset("custom");
                                },
                                target: "(Stream Deleted from Catalog)",
                                sensitive: metadata.hasXmp,
                              },
                            ].map((row, idx) => (
                              <tr
                                key={row.key}
                                style={{
                                  borderBottom: idx < 8 ? "1px solid var(--line)" : "none",
                                  background: idx % 2 === 0 ? "transparent" : "var(--surface)",
                                }}
                              >
                                <td style={{ padding: "10px 14px", textAlign: "center" }}>
                                  <input
                                    type="checkbox"
                                    checked={row.checked}
                                    onChange={(e) => row.toggle(e.target.checked)}
                                    style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                                  />
                                </td>
                                <td style={{ padding: "10px 14px", fontWeight: 700 }}>
                                  {row.label}
                                </td>
                                <td style={{ padding: "10px 14px" }}>
                                  {row.val ? (
                                    <span style={{ color: "var(--text)" }}>
                                      {row.val}
                                      {row.sensitive && (
                                        <span
                                          style={{
                                            marginLeft: 8,
                                            fontSize: 10,
                                            fontWeight: 700,
                                            padding: "2px 6px",
                                            borderRadius: 4,
                                            background: "rgba(245, 158, 11, 0.15)",
                                            color: "#f59e0b",
                                          }}
                                        >
                                          Sensitive Trace
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
                                      (Not present)
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: "10px 14px" }}>
                                  {row.checked ? (
                                    <span
                                      style={{
                                        color: "var(--mint)",
                                        fontWeight: 600,
                                      }}
                                    >
                                      ✓ {row.target}
                                    </span>
                                  ) : (
                                    <span style={{ color: "var(--muted)" }}>
                                      Preserved unchanged
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Action Execution Button */}
                  <div className="pwd-action-box">
                    <button
                      type="button"
                      className="download-button"
                      onClick={handleSanitize}
                      disabled={isProcessing}
                    >
                      {isProcessing
                        ? "Sanitizing Metadata..."
                        : "Sanitize & Download Clean PDF ↓"}
                    </button>
                  </div>
                </div>

                {/* Status Messages */}
                {message && (
                  <div className="pwd-notice-banner success" style={{ margin: "0 24px 24px" }}>
                    <span className="notice-icon">✓</span>
                    <div>
                      <strong>Success</strong>
                      <p>{message}</p>
                    </div>
                  </div>
                )}
                {error && (
                  <div className="pwd-notice-banner warning" style={{ margin: "0 24px 24px" }}>
                    <span className="notice-icon">⚠️</span>
                    <div>
                      <strong>Notice</strong>
                      <p>{error}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <footer className="footer">
          <span>✦ Built for privacy</span>
          <span>Everything happens locally in your browser</span>
        </footer>
      </main>
    </div>
  );
}
