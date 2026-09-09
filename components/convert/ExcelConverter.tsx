"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { convertElementsToPdf } from "./shared";

interface SheetData {
  name: string;
  rows: Array<Array<string | number | boolean | null>>;
  maxCols: number;
}

export function ExcelConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheetIdx, setActiveSheetIdx] = useState<number>(0);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [showGridlines, setShowGridlines] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const sheetContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file) {
      setSheets([]);
      setActiveSheetIdx(0);
      setMessage("");
      setError("");
      return;
    }

    const parseExcel = async () => {
      setBusy(true);
      setProgressText("Parsing spreadsheet sheets and cell data…");
      setError("");
      setMessage("");

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const extracted: SheetData[] = [];

        for (const name of workbook.SheetNames) {
          const ws = workbook.Sheets[name];
          const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as Array<Array<string | number | boolean | null>>;
          let maxCols = 0;
          for (const row of rawRows) {
            if (row.length > maxCols) maxCols = row.length;
          }
          extracted.push({ name, rows: rawRows, maxCols });
        }

        setSheets(extracted);
        setActiveSheetIdx(0);
        const totalRows = extracted.reduce((acc, s) => acc + s.rows.length, 0);
        setMessage(`Loaded ${extracted.length} ${extracted.length === 1 ? "sheet" : "sheets"} with ${totalRows} total rows.`);
      } catch (err) {
        console.error("Excel parse error:", err);
        setError("Failed to parse spreadsheet. Please ensure it is a valid .xlsx, .xls, or .csv file.");
      } finally {
        setBusy(false);
        setProgressText("");
      }
    };

    void parseExcel();
  }, [file]);

  const handleConvert = async () => {
    if (!file || !sheetContainerRef.current) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      // Find all sheet tables or active sheet
      const container = sheetContainerRef.current;
      const targetElements = Array.from(container.querySelectorAll<HTMLElement>(".excel-page-sheet"));
      const elementsToRender = targetElements.length > 0 ? targetElements : [container];

      await convertElementsToPdf(elementsToRender, {
        fileName: file.name,
        orientation,
        onProgress: setProgressText,
      });

      setMessage(`✓ Downloaded PDF with spreadsheet tables, gridlines, and formatting!`);
    } catch (err) {
      console.error("Excel conversion error:", err);
      setError("An error occurred while generating the PDF.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  const getColLetter = (index: number) => {
    let letter = "";
    let temp = index;
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  };

  const activeSheet = sheets[activeSheetIdx] || sheets[0];

  return (
    <div className="converter-card">
      {!file && (
        <label
          className="upload-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setFile(e.dataTransfer.files[0] || null);
          }}
        >
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <span className="upload-icon">▦</span>
          <strong>Drop Excel or CSV file here</strong>
          <span className="upload-hint">or click to browse · .xlsx, .xls, .csv processed locally</span>
        </label>
      )}

      {file && (
        <div className="loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{file.name}</strong>
              <span className="page-count">
                {(file.size / 1024 / 1024).toFixed(2)} MB · {sheets.length} {sheets.length === 1 ? "sheet" : "sheets"}
              </span>
            </div>
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                setFile(null);
                setSheets([]);
                setMessage("");
                setError("");
              }}
              disabled={busy}
            >
              Choose another file
            </button>
          </div>

          <div className="word-fidelity-banner">
            <span className="fidelity-badge">✦ Spreadsheet Engine</span>
            <span>Preserving cell alignments, table borders, gridlines, numbers & headers across pages.</span>
          </div>

          {/* Controls toolbar */}
          <div className="advanced-toolbar" style={{ marginTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              Orientation:
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as "landscape" | "portrait")}
                disabled={busy}
              >
                <option value="landscape">Landscape (Recommended)</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showGridlines}
                onChange={(e) => setShowGridlines(e.target.checked)}
                disabled={busy}
              />
              Show Gridlines
            </label>

            {sheets.length > 1 && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                Sheet View:
                <select
                  value={activeSheetIdx}
                  onChange={(e) => setActiveSheetIdx(Number(e.target.value))}
                  disabled={busy}
                >
                  {sheets.map((s, idx) => (
                    <option key={s.name} value={idx}>
                      {s.name} ({s.rows.length} rows)
                    </option>
                  ))}
                  <option value={-1}>All Sheets ({sheets.length})</option>
                </select>
              </label>
            )}
          </div>

          {progressText && (
            <div className="conversion-progress-box" role="status">
              <div className="spinner-dot" />
              <span>{progressText}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="convert-actions">
            <button
              type="button"
              className="download-button"
              onClick={handleConvert}
              disabled={busy || sheets.length === 0}
            >
              {busy ? "Generating PDF…" : "Convert & download PDF ↓"}
            </button>

            <button
              type="button"
              className="download-button secondary print-button"
              onClick={() => window.print()}
              disabled={busy || sheets.length === 0}
              title="Print or save as vector PDF using browser print dialog"
            >
              Save as PDF (Vector Print) 🖨
            </button>
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          {/* Spreadsheet Preview Desk */}
          {sheets.length > 0 && (
            <div className="docx-preview-section">
              <div className="docx-preview-header">
                <span className="docx-preview-title">
                  Spreadsheet Preview ({activeSheetIdx === -1 ? "All Sheets" : activeSheet?.name})
                </span>
                <span className="docx-preview-hint">Rendered with spreadsheet grid layout</span>
              </div>

              {/* Sheet tabs if multiple */}
              {sheets.length > 1 && (
                <div className="excel-sheet-tabs">
                  {sheets.map((s, idx) => (
                    <button
                      key={s.name}
                      type="button"
                      className={`excel-sheet-tab ${activeSheetIdx === idx ? "active" : ""}`}
                      onClick={() => setActiveSheetIdx(idx)}
                    >
                      {s.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`excel-sheet-tab ${activeSheetIdx === -1 ? "active" : ""}`}
                    onClick={() => setActiveSheetIdx(-1)}
                  >
                    ★ All Sheets
                  </button>
                </div>
              )}

              <div className="docx-desk-wrapper">
                <div ref={sheetContainerRef} className="excel-preview-container">
                  {(activeSheetIdx === -1 ? sheets : [activeSheet]).filter(Boolean).map((sh, sIndex) => (
                    <div
                      key={sh.name}
                      className={`excel-page-sheet ${orientation}`}
                      style={{ marginBottom: 28 }}
                    >
                      <div className="excel-sheet-header-banner">
                        <span className="excel-sheet-title-text">Sheet: {sh.name}</span>
                        <span className="excel-sheet-meta-text">{sh.rows.length} rows · {sh.maxCols} columns</span>
                      </div>

                      <div className="excel-table-scroll-wrapper">
                        <table className={`excel-grid-table ${showGridlines ? "with-grid" : ""}`}>
                          <thead>
                            <tr>
                              <th className="excel-corner-cell">#</th>
                              {Array.from({ length: Math.min(sh.maxCols, 35) }).map((_, cIdx) => (
                                <th key={cIdx} className="excel-col-header">
                                  {getColLetter(cIdx)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sh.rows.slice(0, 300).map((row, rIdx) => {
                              const isHeaderRow = rIdx === 0;
                              return (
                                <tr key={rIdx} className={isHeaderRow ? "excel-first-row" : ""}>
                                  <td className="excel-row-num">{rIdx + 1}</td>
                                  {Array.from({ length: Math.min(sh.maxCols, 35) }).map((_, cIdx) => {
                                    const val = row[cIdx];
                                    const displayVal = val === null || val === undefined ? "" : String(val);
                                    const isNumeric = typeof val === "number" || (!isNaN(Number(displayVal)) && displayVal.trim() !== "");
                                    return (
                                      <td
                                        key={cIdx}
                                        className={`excel-cell ${isHeaderRow ? "header-cell" : ""} ${isNumeric ? "num-cell" : ""}`}
                                      >
                                        {displayVal}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {sh.rows.length > 300 && (
                        <p className="excel-truncation-note">
                          (Showing first 300 rows for preview. All rows are preserved during PDF generation.)
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
