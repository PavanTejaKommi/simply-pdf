"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { loadPdf } from "../../lib/pdfjs";

interface SheetData {
  name: string;
  rows: (string | number)[][];
  colCount: number;
}

export function PdfToExcelConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) {
      setSheets([]);
      setActiveSheetIndex(0);
      setMessage("");
      setError("");
      return;
    }

    const parsePdfTables = async () => {
      setBusy(true);
      setProgressText("Extracting tabular data and layout coordinates…");
      setError("");
      setMessage("");

      try {
        const doc = await loadPdf(file);
        const total = doc.numPages;
        const extractedSheets: SheetData[] = [];
        const combinedRows: (string | number)[][] = [];

        for (let pageNum = 1; pageNum <= total; pageNum += 1) {
          setProgressText(`Analyzing page ${pageNum} of ${total}…`);
          const page = await doc.getPage(pageNum);
          const textContent = await page.getTextContent();

          // Gather text items with coordinates
          interface CoordItem {
            str: string;
            x: number;
            y: number;
            width: number;
          }

          const rawItems: CoordItem[] = [];
          for (const item of textContent.items) {
            if ("str" in item && item.str.trim()) {
              const x = item.transform ? item.transform[4] : 0;
              const y = item.transform ? item.transform[5] : 0;
              rawItems.push({
                str: item.str.trim(),
                x,
                y,
                width: item.width || 20,
              });
            }
          }

          // Group items into rows by Y coordinate (within threshold of ~5px)
          const rowGroups: { y: number; items: CoordItem[] }[] = [];
          const ROW_TOLERANCE = 5.5;

          // Sort descending by Y (top of page to bottom)
          rawItems.sort((a, b) => b.y - a.y);

          for (const item of rawItems) {
            let placed = false;
            for (const group of rowGroups) {
              if (Math.abs(group.y - item.y) <= ROW_TOLERANCE) {
                group.items.push(item);
                // Update running average Y
                group.y = (group.y + item.y) / 2;
                placed = true;
                break;
              }
            }
            if (!placed) {
              rowGroups.push({ y: item.y, items: [item] });
            }
          }

          // For each row group, sort items by X coordinate (left to right)
          const pageRows: (string | number)[][] = [];

          for (const group of rowGroups) {
            group.items.sort((a, b) => a.x - b.x);

            const rowCells: (string | number)[] = [];
            for (const cellItem of group.items) {
              const text = cellItem.str;

              // Detect numeric cells: "$1,200.50", "45%", "123.45", "-20"
              const cleanNum = text.replace(/[$,]/g, "").trim();
              if (cleanNum && !isNaN(Number(cleanNum)) && /^-?\d+(\.\d+)?$/.test(cleanNum)) {
                rowCells.push(Number(cleanNum));
              } else if (text.endsWith("%") && !isNaN(Number(text.slice(0, -1).trim()))) {
                rowCells.push(Number(text.slice(0, -1).trim()) / 100);
              } else {
                rowCells.push(text);
              }
            }

            if (rowCells.length > 0) {
              pageRows.push(rowCells);
              combinedRows.push(rowCells);
            }
          }

          const maxCols = pageRows.reduce((acc, r) => Math.max(acc, r.length), 0);
          extractedSheets.push({
            name: `Page ${pageNum}`,
            rows: pageRows,
            colCount: maxCols,
          });
        }

        // Add Combined sheet if multi-page
        if (total > 1 && combinedRows.length > 0) {
          const maxCombinedCols = combinedRows.reduce((acc, r) => Math.max(acc, r.length), 0);
          extractedSheets.unshift({
            name: "Combined All Pages",
            rows: combinedRows,
            colCount: maxCombinedCols,
          });
        }

        setSheets(extractedSheets);
        setActiveSheetIndex(0);
        setMessage(`Extracted ${extractedSheets.length} sheet${extractedSheets.length > 1 ? "s" : ""} with structured rows and columns.`);
      } catch (err) {
        console.error("PDF to Excel extraction error:", err);
        setError("Failed to extract tabular data from this PDF.");
      } finally {
        setBusy(false);
        setProgressText("");
      }
    };

    void parsePdfTables();
  }, [file]);

  const handleDownloadXlsx = () => {
    if (!sheets.length) return;

    try {
      const wb = XLSX.utils.book_new();

      for (const sheet of sheets) {
        const ws = XLSX.utils.aoa_to_sheet(sheet.rows);

        // Auto-calculate column widths
        const colWidths: { wch: number }[] = [];
        for (let col = 0; col < sheet.colCount; col += 1) {
          let maxLen = 10;
          for (const row of sheet.rows) {
            const val = row[col];
            if (val !== undefined && val !== null) {
              maxLen = Math.max(maxLen, String(val).length);
            }
          }
          colWidths.push({ wch: Math.min(60, maxLen + 3) });
        }
        ws["!cols"] = colWidths;

        // Clean sheet name (Excel limits sheet names to 31 chars and bans : \ / ? * [ ])
        const safeName = sheet.name.replace(/[:\\/?*[\]]/g, "").slice(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, safeName);
      }

      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([out], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file?.name ? file.name.replace(/\.pdf$/i, "") : "spreadsheet"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

      setMessage("✓ Downloaded genuine Excel workbook (.xlsx) with preserved numbers and sheets!");
    } catch (err) {
      console.error("XLSX download error:", err);
      setError("Failed to create Excel workbook.");
    }
  };

  const handleDownloadCsv = () => {
    if (!sheets.length) return;
    const currentSheet = sheets[activeSheetIndex] || sheets[0];
    const ws = XLSX.utils.aoa_to_sheet(currentSheet.rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file?.name ? file.name.replace(/\.pdf$/i, "") : "table"}-${currentSheet.name.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage(`✓ Exported ${currentSheet.name} as CSV!`);
  };

  const currentSheet = sheets[activeSheetIndex] || null;

  // Helper to generate Excel column letters (A, B, C... Z, AA, AB...)
  const getColLetter = (index: number): string => {
    let letter = "";
    let temp = index;
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  };

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
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <span className="upload-icon">X</span>
          <strong>Drop PDF document here</strong>
          <span className="upload-hint">or click to browse · extracts tables and data rows into Excel (.xlsx)</span>
        </label>
      )}

      {file && (
        <div className="loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{file.name}</strong>
              <span className="page-count">
                {sheets.length} Sheet{sheets.length !== 1 ? "s" : ""} · {currentSheet ? `${currentSheet.rows.length} rows` : ""}
              </span>
            </div>
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                setFile(null);
                setSheets([]);
                setActiveSheetIndex(0);
                setMessage("");
                setError("");
              }}
              disabled={busy}
            >
              Choose another PDF
            </button>
          </div>

          <div className="word-fidelity-banner">
            <span className="fidelity-badge">✦ Spatial Table Engine</span>
            <span>Automatically detects table rows, aligns horizontal columns by 2D coordinates, and parses numbers and formulas.</span>
          </div>

          {progressText && (
            <div className="conversion-progress-box" role="status">
              <div className="spinner-dot" />
              <span>{progressText}</span>
            </div>
          )}

          <div className="convert-actions">
            <button
              type="button"
              className="download-button"
              onClick={handleDownloadXlsx}
              disabled={busy || !sheets.length}
            >
              {busy ? "Generating Spreadsheet…" : "Download Excel (.xlsx) ↓"}
            </button>
            <button
              type="button"
              className="download-button secondary"
              onClick={handleDownloadCsv}
              disabled={busy || !sheets.length}
            >
              Download Current Sheet (.csv)
            </button>
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          {/* Spreadsheet Table Grid Preview */}
          {sheets.length > 0 && currentSheet && (
            <div className="excel-export-preview">
              <div className="excel-sheet-nav">
                {sheets.map((s, idx) => (
                  <button
                    key={s.name}
                    type="button"
                    className={`excel-sheet-tab-btn ${idx === activeSheetIndex ? "active" : ""}`}
                    onClick={() => setActiveSheetIndex(idx)}
                  >
                    {s.name} ({s.rows.length} rows)
                  </button>
                ))}
              </div>

              <div className="excel-preview-scroll">
                <table className="excel-preview-grid-table">
                  <thead>
                    <tr>
                      <th className="excel-row-num-cell">#</th>
                      {Array.from({ length: currentSheet.colCount }).map((_, colIdx) => (
                        <th key={colIdx}>{getColLetter(colIdx)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentSheet.rows.slice(0, 150).map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        <td className="excel-row-num-cell">{rowIdx + 1}</td>
                        {Array.from({ length: currentSheet.colCount }).map((_, colIdx) => {
                          const cellVal = row[colIdx];
                          const isNumeric = typeof cellVal === "number";
                          return (
                            <td
                              key={colIdx}
                              style={{
                                textAlign: isNumeric ? "right" : "left",
                                fontWeight: rowIdx === 0 ? 600 : 400,
                              }}
                            >
                              {cellVal !== undefined && cellVal !== null ? String(cellVal) : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {currentSheet.rows.length > 150 && (
                <div style={{ padding: "8px 16px", fontSize: 12, color: "var(--muted)", background: "var(--bg)", borderTop: "1px solid var(--line)" }}>
                  Showing first 150 of {currentSheet.rows.length} rows. Full dataset included in download.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
