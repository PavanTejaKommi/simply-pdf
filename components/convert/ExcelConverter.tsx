"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { convertElementsToPdf } from "./shared";

interface CellData {
  value: string | number | boolean | null;
  displayValue: string;
  bgColor?: string;
  textColor?: string;
  isBold?: boolean;
}

interface SheetData {
  name: string;
  rows: CellData[][];
  maxCols: number;
  effectiveCols: number;
  images: string[];
}

interface SheetTableRendererProps {
  sheet: SheetData;
  orientation: "landscape" | "portrait";
  showGridlines: boolean;
  fitMode: "fit-width" | "wrap" | "actual";
  scalePercent: string;
  wrapText: boolean;
  density: "auto" | "compact" | "normal" | "spacious";
  includeEmptyCols: boolean;
  isExporting: boolean;
  getColLetter: (index: number) => string;
}

interface CellStyleInfo {
  bgColor?: string;
  textColor?: string;
  isBold?: boolean;
}

function parseExcelStyles(stylesXml: string): Map<number, CellStyleInfo> {
  const styleMap = new Map<number, CellStyleInfo>();
  try {
    const doc = new DOMParser().parseFromString(stylesXml, "application/xml");

    // 1. Parse fills
    const fillElements = Array.from(doc.getElementsByTagName("fill"));
    const fillColors: (string | undefined)[] = [];
    for (const f of fillElements) {
      const fgColor = f.getElementsByTagName("fgColor")[0];
      let hex: string | undefined = undefined;
      if (fgColor) {
        const rgb = fgColor.getAttribute("rgb");
        if (rgb && rgb !== "00000000") {
          hex = "#" + (rgb.length === 8 ? rgb.slice(2) : rgb);
        }
      }
      fillColors.push(hex);
    }

    // 2. Parse fonts
    const fontElements = Array.from(doc.getElementsByTagName("font"));
    const fontStyles: { color?: string; isBold?: boolean }[] = [];
    for (const f of fontElements) {
      const b = f.getElementsByTagName("b").length > 0;
      let hex: string | undefined = undefined;
      const colorElem = f.getElementsByTagName("color")[0];
      if (colorElem) {
        const rgb = colorElem.getAttribute("rgb");
        if (rgb) {
          hex = "#" + (rgb.length === 8 ? rgb.slice(2) : rgb);
        }
      }
      fontStyles.push({ color: hex, isBold: b });
    }

    // 3. Parse cellXfs
    const cellXfs = doc.getElementsByTagName("cellXfs")[0];
    if (cellXfs) {
      const xfElements = Array.from(cellXfs.getElementsByTagName("xf"));
      for (let i = 0; i < xfElements.length; i++) {
        const xf = xfElements[i];
        const fillId = Number(xf.getAttribute("fillId") || "0");
        const fontId = Number(xf.getAttribute("fontId") || "0");
        const applyFill = xf.getAttribute("applyFill") === "1" || fillId > 1;

        const info: CellStyleInfo = {};
        if (applyFill && fillId < fillColors.length && fillColors[fillId]) {
          info.bgColor = fillColors[fillId];
        }
        if (fontId < fontStyles.length) {
          if (fontStyles[fontId].color) info.textColor = fontStyles[fontId].color;
          if (fontStyles[fontId].isBold) info.isBold = fontStyles[fontId].isBold;
        }
        styleMap.set(i, info);
      }
    }
  } catch (err) {
    console.warn("Could not parse styles.xml:", err);
  }
  return styleMap;
}

function SheetTableRenderer({
  sheet,
  orientation,
  showGridlines,
  fitMode,
  scalePercent,
  wrapText,
  density,
  includeEmptyCols,
  isExporting,
  getColLetter,
}: SheetTableRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [autoScale, setAutoScale] = useState<number>(1);
  const [viewportHeight, setViewportHeight] = useState<number | undefined>(undefined);

  const colsToRender = includeEmptyCols
    ? Math.min(sheet.maxCols, 50)
    : Math.min(sheet.effectiveCols, 50);

  const effectiveDensity =
    density === "auto"
      ? colsToRender > 7
        ? "density-compact"
        : "density-normal"
      : `density-${density}`;

  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current || !tableRef.current) return;

      if (fitMode === "actual") {
        setAutoScale(1);
        setViewportHeight(undefined);
        return;
      }

      if (scalePercent !== "auto") {
        const manual = Number(scalePercent) / 100;
        setAutoScale(manual);
        if (manual < 1 && tableRef.current) {
          setViewportHeight(Math.ceil(tableRef.current.offsetHeight * manual));
        } else {
          setViewportHeight(undefined);
        }
        return;
      }

      // Auto calculate fit scale so columns never exceed the sheet
      const availableWidth =
        containerRef.current.clientWidth || (orientation === "landscape" ? 972 : 746);
      const tableScrollWidth = tableRef.current.scrollWidth || tableRef.current.offsetWidth;

      if (tableScrollWidth > availableWidth && availableWidth > 50) {
        const calculatedScale = Math.max(
          0.3,
          Math.min(1, Math.floor((availableWidth / tableScrollWidth) * 100) / 100)
        );
        setAutoScale(calculatedScale);
        if (calculatedScale < 1 && tableRef.current) {
          setViewportHeight(Math.ceil(tableRef.current.offsetHeight * calculatedScale));
        } else {
          setViewportHeight(undefined);
        }
      } else {
        setAutoScale(1);
        setViewportHeight(undefined);
      }
    };

    // Run after DOM render
    const timer = setTimeout(updateScale, 30);
    const ro = new ResizeObserver(updateScale);
    if (containerRef.current) ro.observe(containerRef.current);
    if (tableRef.current) ro.observe(tableRef.current);

    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [
    colsToRender,
    orientation,
    fitMode,
    scalePercent,
    wrapText,
    effectiveDensity,
    sheet,
    isExporting,
  ]);

  const rowsToShow = isExporting ? sheet.rows : sheet.rows.slice(0, 300);

  const appliedScale =
    scalePercent !== "auto"
      ? Number(scalePercent) / 100
      : fitMode === "actual"
      ? 1
      : autoScale;

  const isScaled = appliedScale < 0.999;

  return (
    <div
      className={`excel-page-sheet ${orientation}`}
      style={{ marginBottom: 28 }}
    >
      <div className="excel-sheet-header-banner">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="excel-sheet-title-text">Sheet: {sheet.name}</span>
          {isScaled && (
            <span className="excel-fit-badge" title="Automatically scaled to fit sheet margins">
              ✓ Fit to Sheet Width ({Math.round(appliedScale * 100)}%)
            </span>
          )}
        </div>
        <span className="excel-sheet-meta-text">
          {sheet.rows.length} rows · {colsToRender} {colsToRender === 1 ? "column" : "columns"}
          {colsToRender < sheet.maxCols && ` (${sheet.maxCols - colsToRender} empty trailing hidden)`}
        </span>
      </div>

      {/* Embedded sheet pictures banner if present */}
      {sheet.images && sheet.images.length > 0 && (
        <div
          className="excel-sheet-images-bar"
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 16,
            flexWrap: "wrap",
            padding: 8,
            background: "#f8fafc",
            borderRadius: 6,
            border: "1px solid #e2e8f0",
          }}
        >
          {sheet.images.map((imgUrl, imgIdx) => (
            <div
              key={imgIdx}
              style={{
                maxWidth: 240,
                maxHeight: 140,
                overflow: "hidden",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#ffffff",
                boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgUrl}
                alt={`Sheet ${sheet.name} visual ${imgIdx + 1}`}
                style={{ maxWidth: "100%", maxHeight: 130, objectFit: "contain" }}
                loading="eager"
              />
            </div>
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        className={`excel-table-scroll-wrapper ${
          fitMode === "fit-width" || fitMode === "wrap" ? "fit-sheet" : ""
        }`}
      >
        <div
          className="excel-scale-viewport"
          style={{ height: isScaled && viewportHeight ? `${viewportHeight + 4}px` : "auto" }}
        >
          <div
            className="excel-scale-canvas"
            style={{
              transform: isScaled ? `scale(${appliedScale})` : undefined,
              width: isScaled ? `${(100 / appliedScale).toFixed(3)}%` : "100%",
            }}
          >
            <table
              ref={tableRef}
              className={`excel-grid-table ${showGridlines ? "with-grid" : ""} ${effectiveDensity} ${
                wrapText ? "wrap-text" : ""
              }`}
            >
              <thead>
                <tr>
                  <th className="excel-corner-cell">#</th>
                  {Array.from({ length: colsToRender }).map((_, cIdx) => (
                    <th key={cIdx} className="excel-col-header">
                      {getColLetter(cIdx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsToShow.map((row, rIdx) => {
                  const isHeaderRow = rIdx === 0;
                  return (
                    <tr key={rIdx} className={isHeaderRow ? "excel-first-row" : ""}>
                      <td className="excel-row-num">{rIdx + 1}</td>
                      {Array.from({ length: colsToRender }).map((_, cIdx) => {
                        const cell = row[cIdx];
                        const displayVal = cell ? cell.displayValue : "";
                        const val = cell ? cell.value : "";
                        const isNumeric =
                          typeof val === "number" ||
                          (!isNaN(Number(displayVal)) && displayVal.trim() !== "");

                        const cellStyle: React.CSSProperties = {};
                        if (cell?.bgColor) cellStyle.backgroundColor = cell.bgColor;
                        if (cell?.textColor) cellStyle.color = cell.textColor;
                        if (cell?.isBold) cellStyle.fontWeight = 700;

                        return (
                          <td
                            key={cIdx}
                            style={cellStyle}
                            className={`excel-cell ${isHeaderRow ? "header-cell" : ""} ${
                              isNumeric ? "num-cell" : ""
                            }`}
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
        </div>
      </div>
      {!isExporting && sheet.rows.length > 300 && (
        <p className="excel-truncation-note">
          (Showing first 300 rows for preview. All {sheet.rows.length} rows will be exported to the PDF.)
        </p>
      )}
    </div>
  );
}

export function ExcelConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheetIdx, setActiveSheetIdx] = useState<number>(0);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [fitMode, setFitMode] = useState<"fit-width" | "wrap" | "actual">("fit-width");
  const [scalePercent, setScalePercent] = useState<string>("auto");
  const [wrapText, setWrapText] = useState<boolean>(true);
  const [density, setDensity] = useState<"auto" | "compact" | "normal" | "spacious">("auto");
  const [includeEmptyCols, setIncludeEmptyCols] = useState<boolean>(false);
  const [showGridlines, setShowGridlines] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
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
      setProgressText("Parsing spreadsheet sheets, cell colors, fonts, and pictures…");
      setError("");
      setMessage("");

      try {
        const buffer = await file.arrayBuffer();

        // 1. Parse styles and embedded media via JSZip if ZIP-based (.xlsx)
        let styleMap = new Map<number, CellStyleInfo>();
        const sheetImagesMap = new Map<string, string[]>();
        let zip: JSZip | null = null;

        const uint8 = new Uint8Array(buffer.slice(0, 4));
        const isZip = uint8[0] === 0x50 && uint8[1] === 0x4b;
        if (isZip) {
          try {
            zip = await JSZip.loadAsync(buffer);
            const stylesXml = await zip.file("xl/styles.xml")?.async("string");
            if (stylesXml) {
              styleMap = parseExcelStyles(stylesXml);
            }

            // Extract all pictures from xl/media/*
            const mediaFiles = Object.keys(zip.files).filter((k) => /^xl\/media\//i.test(k));
            const allImages: string[] = [];
            for (const mf of mediaFiles) {
              const fileObj = zip.file(mf);
              if (fileObj) {
                const base64 = await fileObj.async("base64");
                const ext = mf.split(".").pop()?.toLowerCase() || "png";
                const mime =
                  ext === "png"
                    ? "image/png"
                    : ext === "svg"
                    ? "image/svg+xml"
                    : ext === "gif"
                    ? "image/gif"
                    : "image/jpeg";
                allImages.push(`data:${mime};base64,${base64}`);
              }
            }
            if (allImages.length > 0) {
              sheetImagesMap.set("__all__", allImages);
            }
          } catch (zipErr) {
            console.warn("Could not read zip styles/media:", zipErr);
          }
        }

        // 2. Parse workbook structure via SheetJS
        const workbook = XLSX.read(buffer, { type: "array", cellStyles: true, cellDates: true });
        const extracted: SheetData[] = [];

        for (let sIdx = 0; sIdx < workbook.SheetNames.length; sIdx++) {
          const name = workbook.SheetNames[sIdx];
          const ws = workbook.Sheets[name];

          // Parse cell style index mapping from worksheet XML if available in ZIP
          const cellStyleIndexMap = new Map<string, number>();
          if (zip) {
            try {
              const sheetXmlPath = `xl/worksheets/sheet${sIdx + 1}.xml`;
              const sheetXml = await zip.file(sheetXmlPath)?.async("string");
              if (sheetXml) {
                const sheetDoc = new DOMParser().parseFromString(sheetXml, "application/xml");
                const cElements = Array.from(sheetDoc.getElementsByTagName("c"));
                for (const c of cElements) {
                  const r = c.getAttribute("r");
                  const s = c.getAttribute("s");
                  if (r && s !== null) {
                    cellStyleIndexMap.set(r, Number(s));
                  }
                }
              }
            } catch {}
          }

          const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as Array<
            Array<string | number | boolean | null>
          >;
          let maxCols = 0;
          let effectiveCols = 0;

          for (const row of rawRows) {
            if (row.length > maxCols) maxCols = row.length;
            for (let c = row.length - 1; c >= 0; c--) {
              const val = row[c];
              if (val !== null && val !== undefined && String(val).trim() !== "") {
                if (c + 1 > effectiveCols) effectiveCols = c + 1;
                break;
              }
            }
          }

          if (effectiveCols === 0 && maxCols > 0) effectiveCols = Math.min(maxCols, 5);
          effectiveCols = Math.max(effectiveCols, 1);

          // Build structured rows with cell colors and formatting
          const structuredRows: CellData[][] = [];
          for (let r = 0; r < rawRows.length; r++) {
            const rawRow = rawRows[r];
            const rowCells: CellData[] = [];
            for (let c = 0; c < Math.max(rawRow.length, maxCols); c++) {
              const val = rawRow[c] !== undefined ? rawRow[c] : "";
              const displayVal = val === null || val === undefined ? "" : String(val);

              const cellRef = XLSX.utils.encode_cell({ r, c });
              let cellBgColor: string | undefined = undefined;
              let cellTextColor: string | undefined = undefined;
              let cellIsBold = false;

              // Check parsed styleMap from styles.xml
              if (cellStyleIndexMap.has(cellRef)) {
                const styleIdx = cellStyleIndexMap.get(cellRef)!;
                const styleInfo = styleMap.get(styleIdx);
                if (styleInfo) {
                  cellBgColor = styleInfo.bgColor;
                  cellTextColor = styleInfo.textColor;
                  cellIsBold = styleInfo.isBold || false;
                }
              }

              // Fallback to SheetJS cell.s if present
              const wsCell = ws[cellRef];
              if (wsCell && wsCell.s) {
                const s = wsCell.s as any;
                if (!cellBgColor && s.fill?.fgColor?.rgb) {
                  const rgb = s.fill.fgColor.rgb;
                  cellBgColor = "#" + (rgb.length === 8 ? rgb.slice(2) : rgb);
                }
                if (!cellTextColor && s.font?.color?.rgb) {
                  const rgb = s.font.color.rgb;
                  cellTextColor = "#" + (rgb.length === 8 ? rgb.slice(2) : rgb);
                }
                if (!cellIsBold && s.font?.bold) {
                  cellIsBold = true;
                }
              }

              rowCells.push({
                value: val,
                displayValue: displayVal,
                bgColor: cellBgColor,
                textColor: cellTextColor,
                isBold: cellIsBold,
              });
            }
            structuredRows.push(rowCells);
          }

          const sheetImages =
            sheetImagesMap.get(name) || sheetImagesMap.get("__all__") || [];

          extracted.push({
            name,
            rows: structuredRows,
            maxCols,
            effectiveCols,
            images: sheetImages,
          });
        }

        setSheets(extracted);
        setActiveSheetIdx(0);
        const totalRows = extracted.reduce((acc, s) => acc + s.rows.length, 0);
        const totalPictures = extracted.reduce((acc, s) => acc + s.images.length, 0);
        setMessage(
          `✓ Loaded ${extracted.length} ${
            extracted.length === 1 ? "sheet" : "sheets"
          } with ${totalRows} total rows, ${totalPictures} pictures, and cell colors preserved!`
        );
      } catch (err) {
        console.error("Excel parse error:", err);
        setError(
          "Failed to parse spreadsheet. Please ensure it is a valid .xlsx, .xls, or .csv file."
        );
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
    setIsExporting(true);
    setError("");
    setMessage("");
    setProgressText("Preparing tables, cell colors, pictures, and fitting to sheet…");

    try {
      // Ensure all images are decoded before conversion
      const imgElements = Array.from(
        sheetContainerRef.current.querySelectorAll<HTMLImageElement>("img")
      );
      await Promise.all(
        imgElements.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.onload = () => resolve(true);
            img.onerror = () => resolve(true);
          });
        })
      );
      await new Promise((r) => setTimeout(r, 120));

      const container = sheetContainerRef.current;
      const targetElements = Array.from(
        container.querySelectorAll<HTMLElement>(".excel-page-sheet")
      );
      const elementsToRender = targetElements.length > 0 ? targetElements : [container];

      await convertElementsToPdf(elementsToRender, {
        fileName: file.name,
        orientation,
        onProgress: setProgressText,
      });

      setMessage(`✓ Downloaded PDF! Tables, cell colors, and pictures preserved.`);
    } catch (err) {
      console.error("Excel conversion error:", err);
      setError("An error occurred while generating the PDF.");
    } finally {
      setIsExporting(false);
      setBusy(false);
      setProgressText("");
    }
  };

  const handlePrint = () => {
    const styleId = "excel-print-orientation-style";
    let styleTag = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = `@page { size: ${orientation}; margin: 8mm; }`;
    window.print();
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
          <span className="upload-hint">
            or click to browse · .xlsx, .xls, .csv processed locally · Preserves cell colors & pictures
          </span>
        </label>
      )}

      {file && (
        <div className="loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{file.name}</strong>
              <span className="page-count">
                {(file.size / 1024 / 1024).toFixed(2)} MB · {sheets.length}{" "}
                {sheets.length === 1 ? "sheet" : "sheets"}
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
            <span className="fidelity-badge">✦ High Fidelity Engine</span>
            <span>
              Preserving cell background colors, bold styling, embedded pictures & full table data inside sheet boundaries.
            </span>
          </div>

          {/* Controls toolbar */}
          <div className="advanced-toolbar" style={{ marginTop: 12, flexWrap: "wrap", gap: 12 }}>
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
              Sheet Fit:
              <select
                value={fitMode}
                onChange={(e) => setFitMode(e.target.value as "fit-width" | "wrap" | "actual")}
                disabled={busy}
              >
                <option value="fit-width">Fit All Columns to Sheet (Auto-Scale)</option>
                <option value="wrap">Wrap Text (Auto Column Widths)</option>
                <option value="actual">Actual Size (100%)</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              Scale:
              <select
                value={scalePercent}
                onChange={(e) => setScalePercent(e.target.value)}
                disabled={busy || fitMode === "actual"}
              >
                <option value="auto">Auto Fit (Smart)</option>
                <option value="100">100%</option>
                <option value="90">90%</option>
                <option value="80">80%</option>
                <option value="75">75%</option>
                <option value="65">65%</option>
                <option value="50">50%</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              Density:
              <select
                value={density}
                onChange={(e) =>
                  setDensity(e.target.value as "auto" | "compact" | "normal" | "spacious")
                }
                disabled={busy}
              >
                <option value="auto">Density: Auto (Adaptive)</option>
                <option value="compact">Compact (9.5px)</option>
                <option value="normal">Normal (11px)</option>
                <option value="spacious">Spacious (12px)</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={wrapText}
                onChange={(e) => setWrapText(e.target.checked)}
                disabled={busy}
              />
              Wrap Text
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showGridlines}
                onChange={(e) => setShowGridlines(e.target.checked)}
                disabled={busy}
              />
              Gridlines
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={includeEmptyCols}
                onChange={(e) => setIncludeEmptyCols(e.target.checked)}
                disabled={busy}
              />
              Show Empty Columns
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
              onClick={handlePrint}
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
                <span className="docx-preview-hint">Rendered with cell colors, pictures & sheet fit</span>
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
                  {(activeSheetIdx === -1 ? sheets : [activeSheet])
                    .filter(Boolean)
                    .map((sh) => (
                      <SheetTableRenderer
                        key={sh.name}
                        sheet={sh}
                        orientation={orientation}
                        showGridlines={showGridlines}
                        fitMode={fitMode}
                        scalePercent={scalePercent}
                        wrapText={wrapText}
                        density={density}
                        includeEmptyCols={includeEmptyCols}
                        isExporting={isExporting}
                        getColLetter={getColLetter}
                      />
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
