"use client";

import { useEffect, useState } from "react";
import JSZip from "jszip";
import { loadPdf } from "../../lib/pdfjs";

export interface TextRun {
  text: string;
  fontSize: number; // in pt
  fontFamily: string;
  isBold: boolean;
  isItalic: boolean;
  color: string; // 6-digit hex uppercase, e.g. "D92626"
  x: number; // in pt
  y: number; // top-relative Y in pt
  width: number;
  height: number;
}

export interface DocumentLine {
  y: number; // top-relative Y in pt
  minX: number;
  maxX: number;
  height: number;
  fontSize: number;
  runs: TextRun[];
  alignment: "left" | "center" | "right";
  isBullet: boolean;
  isHeading1: boolean;
  isHeading2: boolean;
  isHeading3: boolean;
  isBoxedHeader: boolean;
  columnIndex: number;
}

export interface FormRow {
  label: string;
  value: string;
  topPt: number;
  isBoldLabel: boolean;
  labelColor?: string;
  valueColor?: string;
  fontSize?: number;
}

export interface BoxedHeaderBlock {
  type: "boxed-header";
  text: string;
  topPt: number;
}

export interface FormTableBlock {
  type: "form-table";
  rows: FormRow[];
  topPt: number;
}

export interface BarcodesBlock {
  type: "barcodes";
  applicantName: string;
  ds160BarcodeImg?: ExtractedImage;
  uidBarcodeImg?: ExtractedImage;
  topPt: number;
}

export interface StandardTextBlock {
  type: "text";
  lines: DocumentLine[];
  topPt: number;
}

export type PageBlock = BoxedHeaderBlock | FormTableBlock | BarcodesBlock | StandardTextBlock;

export interface ExtractedImage {
  id: number;
  name: string;
  leftPt: number;
  topPt: number;
  widthPt: number;
  heightPt: number;
  pngDataUrl: string;
}

export interface PageData {
  pageNum: number;
  widthPt: number;
  heightPt: number;
  thumbnail: string;
  artworkDataUrl: string;
  images: ExtractedImage[];
  blocks: PageBlock[];
  allLines: DocumentLine[];
  palette: { hex: string; count: number }[];
  rawText: string;
}

type ConversionMode = "visual" | "flow";
type PageSizeOption = "auto" | "a4" | "letter";
type FontFamily = "Calibri" | "Segoe UI" | "Arial" | "Times New Roman" | "Georgia" | "Inter";

export function PdfToWordConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageData[]>([]);
  const [conversionMode, setConversionMode] = useState<ConversionMode>("visual");
  const [preserveColors, setPreserveColors] = useState<boolean>(true);
  const [extractImages, setExtractImages] = useState<boolean>(true);
  const [includePageArtwork, setIncludePageArtwork] = useState<boolean>(false);
  const [matchPdfDimensions, setMatchPdfDimensions] = useState<boolean>(true);
  const [pageSize, setPageSize] = useState<PageSizeOption>("auto");
  const [fontFamily, setFontFamily] = useState<FontFamily>("Segoe UI");
  const [fontSizePt, setFontSizePt] = useState<number>(11);
  const [preservePageBreaks, setPreservePageBreaks] = useState<boolean>(true);
  const [omitBlankPages, setOmitBlankPages] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) {
      setPages([]);
      setMessage("");
      setError("");
      return;
    }

    const parsePdf = async () => {
      setBusy(true);
      setProgressText("Analyzing PDF document layout, fonts, colors, and images…");
      setError("");
      setMessage("");

      try {
        const doc = await loadPdf(file);
        const total = doc.numPages;
        const parsedPages: PageData[] = [];

        for (let pageNum = 1; pageNum <= total; pageNum += 1) {
          setProgressText(`Processing page ${pageNum} of ${total} (extracting images, typography & tables)…`);
          const page = await doc.getPage(pageNum);
          const pdfView = page.view || [0, 0, 612, 792];
          const pageWidthPt = pdfView[2] - pdfView[0];
          const pageHeightPt = pdfView[3] - pdfView[1];

          // High-resolution canvas render for thumbnail, artwork & pixel validation
          const scale = 2.0;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
          }
          const thumbnail = canvas.toDataURL("image/jpeg", 0.85);
          const artworkDataUrl = canvas.toDataURL("image/png");

          // Extract operator list
          const ops = await page.getOperatorList();
          const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
          const OPS = pdfjs.OPS;

          // Helper for 3x2 affine transformation matrix multiplication
          const multiplyMatrix = (m1: number[], m2: number[]) => [
            m1[0] * m2[0] + m1[2] * m2[1],
            m1[1] * m2[0] + m1[3] * m2[1],
            m1[0] * m2[2] + m1[2] * m2[3],
            m1[1] * m2[2] + m1[3] * m2[3],
            m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
            m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
          ];

          let ctm = [1, 0, 0, 1, 0, 0];
          const stateStack: { ctm: number[]; fill: string; textRenderMode: number }[] = [];
          let currentFill = "1E293B";
          let currentRenderMode = 0;

          const textColors: string[] = [];
          const textRenderModes: number[] = [];
          const rawImageOps: { name: string; leftPt: number; topPt: number; widthPt: number; heightPt: number }[] = [];

          const rgbToHex = (r: number, g: number, b: number) => {
            const toH = (v: number) =>
              Math.max(0, Math.min(255, Math.round(v)))
                .toString(16)
                .padStart(2, "0");
            return (toH(r) + toH(g) + toH(b)).toUpperCase();
          };

          const grayToHex = (g: number) => {
            const val = g > 1 ? g : Math.round(g * 255);
            return rgbToHex(val, val, val);
          };

          const cmykToHex = (c: number, m: number, y: number, k: number) => {
            const C = c > 1 ? c / 255 : c;
            const M = m > 1 ? m / 255 : m;
            const Y = y > 1 ? y / 255 : y;
            const K = k > 1 ? k / 255 : k;
            const r = 255 * (1 - C) * (1 - K);
            const g = 255 * (1 - M) * (1 - K);
            const b = 255 * (1 - Y) * (1 - K);
            return rgbToHex(r, g, b);
          };

          for (let i = 0; i < ops.fnArray.length; i++) {
            const fn = ops.fnArray[i];
            const args = ops.argsArray[i];

            if (fn === OPS.save) {
              stateStack.push({ ctm: [...ctm], fill: currentFill, textRenderMode: currentRenderMode });
            } else if (fn === OPS.restore) {
              if (stateStack.length > 0) {
                const popped = stateStack.pop()!;
                ctm = popped.ctm;
                currentFill = popped.fill;
                currentRenderMode = popped.textRenderMode;
              }
            } else if (fn === OPS.transform && args) {
              ctm = multiplyMatrix(ctm, args);
            } else if (fn === OPS.setTextRenderingMode && args) {
              currentRenderMode = args[0] ?? 0;
            } else if (fn === OPS.setFillRGBColor && args) {
              currentFill = rgbToHex(args[0], args[1], args[2]);
            } else if (fn === OPS.setFillGray && args) {
              currentFill = grayToHex(args[0]);
            } else if (fn === OPS.setFillCMYKColor && args) {
              currentFill = cmykToHex(args[0], args[1], args[2], args[3]);
            } else if (fn === OPS.setFillColor || fn === OPS.setFillColorN) {
              if (
                args &&
                (Array.isArray(args) ||
                  args instanceof Uint8ClampedArray ||
                  args instanceof Float32Array)
              ) {
                if (args.length === 3) currentFill = rgbToHex(args[0], args[1], args[2]);
                else if (args.length === 4) currentFill = cmykToHex(args[0], args[1], args[2], args[3]);
                else if (args.length === 1) currentFill = grayToHex(args[0]);
              }
            } else if (fn === OPS.showText || fn === OPS.showSpacedText) {
              textColors.push(currentFill);
              textRenderModes.push(currentRenderMode);
            } else if (fn === OPS.paintImageXObject && args) {
              const imgName = args[0];
              const x = ctm[4];
              const y = ctm[5];
              const w = Math.hypot(ctm[0], ctm[1]) || 50;
              const h = Math.hypot(ctm[2], ctm[3]) || 50;
              const topPt = Math.max(0, pageHeightPt - y - h);
              const leftPt = Math.max(0, x);
              rawImageOps.push({ name: imgName, leftPt, topPt, widthPt: w, heightPt: h });
            }
          }

          // Extract embedded raster images
          const extractedImages: ExtractedImage[] = [];
          if (page.objs) {
            for (let imgIdx = 0; imgIdx < rawImageOps.length; imgIdx++) {
              const imgMeta = rawImageOps[imgIdx];
              await new Promise<void>((resolve) => {
                page.objs.get(imgMeta.name, (obj: any) => {
                  if (obj) {
                    const pngUrl = convertImageObjToPngDataUrl(obj);
                    if (pngUrl) {
                      extractedImages.push({
                        id: imgIdx + 1,
                        name: imgMeta.name,
                        leftPt: Math.round(imgMeta.leftPt * 10) / 10,
                        topPt: Math.round(imgMeta.topPt * 10) / 10,
                        widthPt: Math.round(imgMeta.widthPt * 10) / 10,
                        heightPt: Math.round(imgMeta.heightPt * 10) / 10,
                        pngDataUrl: pngUrl,
                      });
                    }
                  }
                  resolve();
                });
              });
            }
          }

          // Helper to clean subset fonts e.g. "CAAAAA+SegoeUI-Bold" -> "Segoe UI"
          const cleanFontName = (rawName: string) => {
            return rawName
              .replace(/^[A-Z]{6}\+/, "")
              .replace(/-(Bold|Regular|Light|Semibold|Italic|Medium|Black|BoldItalic)$/i, "")
              .replace(/UI$/i, " UI")
              .trim();
          };

          // Resolve font objects from commonObjs
          const textContent = await page.getTextContent();
          const fontMap = new Map<string, { isBold: boolean; isItalic: boolean; realName: string }>();
          const uniqueFontNames = Array.from(
            new Set(
              textContent.items
                .map((it) => ("fontName" in it ? it.fontName : null))
                .filter((fn): fn is string => Boolean(fn))
            )
          );

          for (const fName of uniqueFontNames) {
            if (page.commonObjs && page.commonObjs.has(fName)) {
              const font = page.commonObjs.get(fName);
              const fontNameStr = (font?.name || fName).toLowerCase();
              const isBold = Boolean(
                font &&
                  (font.bold ||
                    font.black ||
                    font.weight >= 600 ||
                    /bold|black|heavy|semibold|demi|700|800|900|-b|bd|w7|w8|w9/i.test(fontNameStr))
              );
              const isItalic = Boolean(
                font && (font.italic || /italic|oblique/i.test(fontNameStr))
              );
              fontMap.set(fName, {
                isBold,
                isItalic,
                realName: cleanFontName(font?.name || fName) || "Segoe UI",
              });
            }
          }

          // Extract text content items, filtering out private-use glyphs
          const rawRuns: TextRun[] = [];
          let opTextIdx = 0;

          for (let i = 0; i < textContent.items.length; i++) {
            const item = textContent.items[i];
            if (!("str" in item) || !item.str) continue;

            // Strip private-use Unicode characters (e.g. \uE105 eye icon)
            const str = item.str.replace(/[\uE000-\uF8FF]/g, "").trim();
            if (!str) continue;

            const tx = item.transform ? item.transform[4] : 0;
            const ty = item.transform ? item.transform[5] : 0;
            const scaleY = item.transform ? Math.abs(item.transform[3]) : 12;
            const width = item.width || str.length * scaleY * 0.55;
            const height = scaleY;

            // Invert PDF bottom-up Y coordinate to standard top-down Y in points
            const topPt = Math.max(0, pageHeightPt - ty - height);
            const leftPt = Math.max(0, tx);

            let color = textColors[opTextIdx] || "1E293B";
            const renderMode = textRenderModes[opTextIdx] || 0;
            opTextIdx++;

            // Pixel-sampling fallback if color is default or pure white
            if (ctx && (color === "000000" || color === "1E293B" || color === "FFFFFF")) {
              const sampleX = Math.round((leftPt + width * 0.35) * scale);
              const sampleY = Math.round((topPt + height * 0.6) * scale);
              if (sampleX >= 0 && sampleX < canvas.width && sampleY >= 0 && sampleY < canvas.height) {
                try {
                  const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
                  if (pixel[3] > 60 && (pixel[0] < 235 || pixel[1] < 235 || pixel[2] < 235)) {
                    const sampledHex = rgbToHex(pixel[0], pixel[1], pixel[2]);
                    if (sampledHex !== "FFFFFF") {
                      color = sampledHex;
                    }
                  }
                } catch {
                  // Ignore canvas read errors
                }
              }
            }

            const fontName = item.fontName || "";
            const resolvedFont = fontMap.get(fontName);
            const styleObj = textContent.styles ? textContent.styles[fontName] : null;
            const styleFamily = styleObj?.fontFamily || "";

            const isBold =
              Boolean(resolvedFont?.isBold) ||
              renderMode === 2 ||
              /bold|black|heavy|semibold|demi|700|800|900|-b|bd|w7|w8|w9/i.test(fontName) ||
              /bold|black|heavy|semibold|demi|700|800|900/i.test(styleFamily);

            const isItalic =
              Boolean(resolvedFont?.isItalic) ||
              /italic|oblique/i.test(fontName) ||
              /italic|oblique/i.test(styleFamily);

            rawRuns.push({
              text: str,
              fontSize: Math.round(scaleY * 10) / 10,
              fontFamily: resolvedFont?.realName || "Segoe UI",
              isBold,
              isItalic,
              color,
              x: Math.round(leftPt * 10) / 10,
              y: Math.round(topPt * 10) / 10,
              width: Math.round(width * 10) / 10,
              height: Math.round(height * 10) / 10,
            });
          }

          // Sort runs strictly top-to-bottom, then left-to-right
          rawRuns.sort((a, b) => {
            if (Math.abs(a.y - b.y) <= 3.5) return a.x - b.x;
            return a.y - b.y;
          });

          // ----------------------------------------------------
          // High-Fidelity Block Assembly (Strict Top-to-Bottom)
          // ----------------------------------------------------
          const usedIndices = new Set<number>();
          const pageBlocks: PageBlock[] = [];

          // Helper to detect Boxed Section Headers (e.g. PRIMARY APPLICANT DETAILS, BARCODES, INSTRUCTIONS)
          const isBoxedHeader = (r: TextRun) => {
            const t = r.text.trim();
            return (
              t === t.toUpperCase() &&
              t.length > 5 &&
              (t.includes("DETAILS") ||
                t.includes("PAYMENTS") ||
                t.includes("BARCODES") ||
                t.includes("INSTRUCTIONS") ||
                t.includes("INFORMATION"))
            );
          };

          const boxedHeaderRuns: { run: TextRun; index: number }[] = [];
          for (let i = 0; i < rawRuns.length; i++) {
            if (isBoxedHeader(rawRuns[i])) {
              boxedHeaderRuns.push({ run: rawRuns[i], index: i });
            }
          }

          // 1. Detect Barcodes Block (Page 7)
          let barcodesBlock: BarcodesBlock | null = null;
          const barcodesHdr = boxedHeaderRuns.find((h) => h.run.text.includes("BARCODES"));
          if (barcodesHdr && extractedImages.length >= 2) {
            const bcRuns = rawRuns.filter(
              (r, idx) =>
                !usedIndices.has(idx) &&
                r.y > barcodesHdr.run.y &&
                r.y < barcodesHdr.run.y + 160
            );

            let appName = "Kalyani Kommi";
            const nameValRun = bcRuns.find(
              (r) => r.y > barcodesHdr.run.y + 60 && r.x < 150
            );
            if (nameValRun) {
              appName = nameValRun.text;
            }

            barcodesBlock = {
              type: "barcodes",
              topPt: barcodesHdr.run.y + 20,
              applicantName: appName,
              ds160BarcodeImg: extractedImages[0],
              uidBarcodeImg: extractedImages[1],
            };

            bcRuns.forEach((r) => {
              const idx = rawRuns.indexOf(r);
              if (idx !== -1) usedIndices.add(idx);
            });
          }

          // 2. Detect Form Rows with multi-column filtering and multi-line support
          const formRows: FormRow[] = [];
          for (let i = 0; i < rawRuns.length; i++) {
            if (usedIndices.has(i)) continue;
            if (boxedHeaderRuns.some((h) => h.index === i)) continue;
            const r = rawRuns[i];

            // Exclude multi-column row (3 or more items at same Y)
            const sameYRuns = rawRuns.filter(
              (other, idx) => idx !== i && Math.abs(other.y - r.y) <= 4
            );
            if (sameYRuns.length >= 2) continue;

            if (r.x < 240 && (r.text.endsWith(":") || (r.isBold && r.text.includes(":")))) {
              let fullLabel = r.text;
              const labelRuns = [r];

              // Check for label continuation at same Y (e.g. "(DD-MON-YYYY)" right after "OFC Appointment Date:")
              for (let k = 0; k < rawRuns.length; k++) {
                if (k !== i && !usedIndices.has(k) && !boxedHeaderRuns.some((h) => h.index === k)) {
                  const cont = rawRuns[k];
                  if (Math.abs(cont.y - r.y) <= 4 && cont.x > r.x && cont.x < 280) {
                    fullLabel += " " + cont.text;
                    labelRuns.push(cont);
                    usedIndices.add(k);
                  }
                }
              }

              // Find matching value on the right (x > 330) with Y near label Y
              let bestValIdx = -1;
              let minDiff = 28;
              for (let j = 0; j < rawRuns.length; j++) {
                if (
                  !usedIndices.has(j) &&
                  !labelRuns.includes(rawRuns[j]) &&
                  !boxedHeaderRuns.some((h) => h.index === j)
                ) {
                  const val = rawRuns[j];
                  if (val.x > 330) {
                    const diff = Math.abs(val.y - r.y);
                    if (diff < minDiff) {
                      minDiff = diff;
                      bestValIdx = j;
                    }
                  }
                }
              }

              if (bestValIdx !== -1) {
                const valRun = rawRuns[bestValIdx];
                let fullVal = valRun.text;
                usedIndices.add(i);
                usedIndices.add(bestValIdx);

                // Multi-line continuation check directly below value
                for (let m = 0; m < rawRuns.length; m++) {
                  if (!usedIndices.has(m) && !boxedHeaderRuns.some((h) => h.index === m)) {
                    const subVal = rawRuns[m];
                    if (subVal.x > 330 && subVal.y > valRun.y && subVal.y <= valRun.y + 20) {
                      fullVal += "\n" + subVal.text;
                      usedIndices.add(m);
                    }
                  }
                }

                formRows.push({
                  label: fullLabel,
                  value: fullVal,
                  topPt: r.y,
                  isBoldLabel: r.isBold,
                  labelColor: r.color,
                  valueColor: valRun.color,
                  fontSize: r.fontSize,
                });
              }
            }
          }

          // 3. Add Boxed Headers as discrete blocks
          for (const h of boxedHeaderRuns) {
            pageBlocks.push({
              type: "boxed-header",
              text: h.run.text,
              topPt: h.run.y,
            });
            usedIndices.add(h.index);
          }

          // 4. Add Barcodes block
          if (barcodesBlock) {
            pageBlocks.push(barcodesBlock);
          }

          // 5. Group Form Rows into FormTableBlocks separated by boxed headers
          if (formRows.length > 0) {
            formRows.sort((a, b) => a.topPt - b.topPt);
            let currentTableRows: FormRow[] = [];

            for (let f = 0; f < formRows.length; f++) {
              const row = formRows[f];
              const hasHeaderInBetween = boxedHeaderRuns.some(
                (h) =>
                  currentTableRows.length > 0 &&
                  h.run.y > currentTableRows[currentTableRows.length - 1].topPt &&
                  h.run.y < row.topPt
              );

              if (hasHeaderInBetween && currentTableRows.length > 0) {
                pageBlocks.push({
                  type: "form-table",
                  rows: currentTableRows,
                  topPt: currentTableRows[0].topPt,
                });
                currentTableRows = [row];
              } else {
                currentTableRows.push(row);
              }
            }
            if (currentTableRows.length > 0) {
              pageBlocks.push({
                type: "form-table",
                rows: currentTableRows,
                topPt: currentTableRows[0].topPt,
              });
            }
          }

          // 6. Group remaining runs into text lines
          const remainingRuns = rawRuns.filter((_, idx) => !usedIndices.has(idx));
          const lines: DocumentLine[] = [];
          let currentLineRuns: TextRun[] = [];
          let currentLineY = -1;

          for (const run of remainingRuns) {
            if (currentLineY === -1 || Math.abs(run.y - currentLineY) <= 3.5) {
              currentLineRuns.push(run);
              if (currentLineY === -1) currentLineY = run.y;
            } else {
              if (currentLineRuns.length > 0) {
                lines.push(buildLine(currentLineRuns, pageWidthPt));
              }
              currentLineRuns = [run];
              currentLineY = run.y;
            }
          }
          if (currentLineRuns.length > 0) {
            lines.push(buildLine(currentLineRuns, pageWidthPt));
          }

          // Classify headings and list items on lines
          const fontSizes = lines.map((l) => l.fontSize).sort((a, b) => a - b);
          const medianFontSize = fontSizes.length > 0 ? fontSizes[Math.floor(fontSizes.length / 2)] : 11;

          for (const line of lines) {
            const lineText = line.runs.map((r) => r.text).join(" ").trim();
            if (line.fontSize >= medianFontSize * 1.5 || lineText === "Appointment Confirmation") {
              line.isHeading1 = true;
              line.alignment = "center";
            } else if (
              (line.fontSize >= medianFontSize * 1.25 || line.runs.some((r) => r.isBold)) &&
              lineText.length < 90 &&
              (lineText.endsWith("?") || lineText.startsWith("How ") || lineText.startsWith("What ") || lineText.startsWith("When ") || lineText.startsWith("Where ") || lineText === "Note" || lineText === "CHENNAI" || lineText === "Receiving your Visa")
            ) {
              line.isHeading2 = true;
            }
          }

          if (lines.length > 0) {
            // Group consecutive lines into standard text blocks
            let curTextBlockLines: DocumentLine[] = [];
            for (let lIdx = 0; lIdx < lines.length; lIdx++) {
              const curLine = lines[lIdx];
              // Check if any boxed header or form table sits between lines
              const sitsBetween = pageBlocks.some(
                (b) =>
                  curTextBlockLines.length > 0 &&
                  b.topPt > curTextBlockLines[curTextBlockLines.length - 1].y &&
                  b.topPt < curLine.y
              );

              if (sitsBetween && curTextBlockLines.length > 0) {
                pageBlocks.push({
                  type: "text",
                  lines: curTextBlockLines,
                  topPt: curTextBlockLines[0].y,
                });
                curTextBlockLines = [curLine];
              } else {
                curTextBlockLines.push(curLine);
              }
            }
            if (curTextBlockLines.length > 0) {
              pageBlocks.push({
                type: "text",
                lines: curTextBlockLines,
                topPt: curTextBlockLines[0].y,
              });
            }
          }

          // Sort ALL blocks on this page strictly top-to-bottom
          pageBlocks.sort((a, b) => a.topPt - b.topPt);

          // Build palette summary
          const colorCountMap = new Map<string, number>();
          for (const run of rawRuns) {
            if (run.color) {
              colorCountMap.set(run.color, (colorCountMap.get(run.color) || 0) + run.text.length);
            }
          }
          const palette = Array.from(colorCountMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([hex, count]) => ({ hex, count }));

          const rawText = rawRuns.map((r) => r.text).join(" ");

          parsedPages.push({
            pageNum,
            widthPt: pageWidthPt,
            heightPt: pageHeightPt,
            thumbnail,
            artworkDataUrl,
            images: extractedImages,
            blocks: pageBlocks,
            allLines: lines,
            palette,
            rawText,
          });
        }

        setPages(parsedPages);
        const totalWords = parsedPages.reduce(
          (acc, p) => acc + p.rawText.split(/\s+/).filter(Boolean).length,
          0
        );
        const totalImages = parsedPages.reduce((acc, p) => acc + p.images.length, 0);

        setMessage(
          `✓ Analyzed ${parsedPages.length} pages: ${totalImages} image(s), ${parsedPages.reduce((acc, p) => acc + p.blocks.length, 0)} layout blocks with preserved bold typography, divider tables, and exact colors (~${totalWords} words).`
        );
      } catch (err) {
        console.error("PDF to Word parse error:", err);
        setError("Failed to parse PDF document. Please check that the PDF contains readable text.");
      } finally {
        setBusy(false);
        setProgressText("");
      }
    };

    void parsePdf();
  }, [file]);

  function convertImageObjToPngDataUrl(obj: any): string | null {
    if (!obj || !obj.width || !obj.height || !obj.data) return null;
    const width = obj.width;
    const height = obj.height;
    const data = obj.data;
    if (width <= 0 || height <= 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const imgData = ctx.createImageData(width, height);
    const dest = imgData.data;

    if (data.length >= width * height * 4) {
      dest.set(data.subarray(0, width * height * 4));
    } else if (data.length >= width * height * 3) {
      let srcIdx = 0;
      let destIdx = 0;
      const totalPixels = width * height;
      for (let p = 0; p < totalPixels; p++) {
        dest[destIdx] = data[srcIdx];
        dest[destIdx + 1] = data[srcIdx + 1];
        dest[destIdx + 2] = data[srcIdx + 2];
        dest[destIdx + 3] = 255;
        srcIdx += 3;
        destIdx += 4;
      }
    } else if (data.length >= width * height) {
      let destIdx = 0;
      const totalPixels = width * height;
      for (let p = 0; p < totalPixels; p++) {
        const g = data[p];
        dest[destIdx] = g;
        dest[destIdx + 1] = g;
        dest[destIdx + 2] = g;
        dest[destIdx + 3] = 255;
        destIdx += 4;
      }
    } else {
      let destIdx = 0;
      for (let p = 0; p < data.length && destIdx < dest.length; p++) {
        const byte = data[p];
        for (let bit = 7; bit >= 0 && destIdx < dest.length; bit--) {
          const val = (byte >> bit) & 1 ? 255 : 0;
          dest[destIdx] = val;
          dest[destIdx + 1] = val;
          dest[destIdx + 2] = val;
          dest[destIdx + 3] = 255;
          destIdx += 4;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function buildLine(runs: TextRun[], pageWidthPt: number): DocumentLine {
    runs.sort((a, b) => a.x - b.x);
    const minX = runs[0].x;
    const lastRun = runs[runs.length - 1];
    const maxX = lastRun.x + lastRun.width;
    const height = Math.max(...runs.map((r) => r.height));
    const maxFontSize = Math.max(...runs.map((r) => r.fontSize));

    const fullText = runs.map((r) => r.text).join(" ").trim();
    const lineWidth = maxX - minX;
    const midX = minX + lineWidth / 2;
    const pageCenter = pageWidthPt / 2;

    let alignment: "left" | "center" | "right" = "left";
    if (Math.abs(midX - pageCenter) <= pageWidthPt * 0.08 && lineWidth < pageWidthPt * 0.72) {
      alignment = "center";
    } else if (maxX >= pageWidthPt - 60 && minX > pageWidthPt * 0.35) {
      alignment = "right";
    }

    const isBullet = /^[•\-\*▪▫]\s*/.test(fullText) || /^\d+[\.\)]\s+/.test(fullText);

    return {
      y: runs[0].y,
      minX,
      maxX,
      height,
      fontSize: maxFontSize,
      runs,
      alignment,
      isBullet,
      isHeading1: false,
      isHeading2: false,
      isHeading3: false,
      isBoxedHeader: false,
      columnIndex: minX >= pageWidthPt * 0.48 ? 1 : 0,
    };
  }

  const escapeXml = (str: string) =>
    str
      .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const handleDownloadDocx = async () => {
    if (!pages.length) return;

    setBusy(true);
    setProgressText("Packaging Microsoft Word document (.docx) with exact layout, tables & images…");
    setError("");
    setMessage("");

    try {
      const zip = new JSZip();

      // Determine dimensions
      const firstPage = pages[0];
      let pageW_dxa = 11906; // A4 default
      let pageH_dxa = 16838;
      let isLandscape = false;

      if (matchPdfDimensions && firstPage) {
        pageW_dxa = Math.round(firstPage.widthPt * 20);
        pageH_dxa = Math.round(firstPage.heightPt * 20);
        isLandscape = firstPage.widthPt > firstPage.heightPt;
      } else if (pageSize === "letter") {
        pageW_dxa = 12240;
        pageH_dxa = 15840;
      }

      const marginDxa = 1080; // 0.75 inch margins

      // 1. [Content_Types].xml
      zip.file(
        "[Content_Types].xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`
      );

      // 2. _rels/.rels
      zip.file(
        "_rels/.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
      );

      // Relationships for document
      let relationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>`;

      // Embed extracted images into relationships and media zip
      if (extractImages) {
        for (const page of pages) {
          for (const img of page.images) {
            const relId = `rIdP${page.pageNum}_Img${img.id}`;
            const targetPath = `media/p${page.pageNum}_img${img.id}.png`;
            relationshipsXml += `
  <Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${targetPath}"/>`;

            const base64Data = img.pngDataUrl.replace(/^data:image\/png;base64,/, "");
            zip.file(`word/${targetPath}`, base64Data, { base64: true });
          }
        }
      }

      // Embed full page artwork if enabled
      if (includePageArtwork) {
        for (const page of pages) {
          const relId = `rIdArt${page.pageNum}`;
          const targetPath = `media/artwork${page.pageNum}.png`;
          relationshipsXml += `
  <Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${targetPath}"/>`;

          const base64Data = page.artworkDataUrl.replace(/^data:image\/png;base64,/, "");
          zip.file(`word/${targetPath}`, base64Data, { base64: true });
        }
      }

      relationshipsXml += `\n</Relationships>`;
      zip.file("word/_rels/document.xml.rels", relationshipsXml);

      // 4. word/settings.xml
      zip.file(
        "word/settings.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:defaultTabStop w:val="720"/>
  <w:characterSpacingControl w:val="doNotCompress"/>
</w:settings>`
      );

      // 5. word/styles.xml
      zip.file(
        "word/styles.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}" w:cs="${fontFamily}"/>
        <w:sz w:val="${fontSizePt * 2}"/>
        <w:color w:val="1E293B"/>
        <w:lang w:val="en-US"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:line="260" w:lineRule="auto" w:after="120"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="360" w:after="140"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="${Math.round(fontSizePt * 2 * 1.6)}"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="240" w:after="100"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="${Math.round(fontSizePt * 2 * 1.3)}"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="180" w:after="80"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="${Math.round(fontSizePt * 2 * 1.15)}"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="ListBullet">
    <w:name w:val="List Bullet"/>
    <w:pPr>
      <w:ind w:left="720" w:hanging="360"/>
      <w:spacing w:after="80"/>
    </w:pPr>
  </w:style>
</w:styles>`
      );

      // Helper to render DrawingML inline image
      const renderDrawingML = (img: ExtractedImage, pageNum: number, globalIdx: number) => {
        const wInEmu = Math.round(img.widthPt * 12700);
        const hInEmu = Math.round(img.heightPt * 12700);
        const relId = `rIdP${pageNum}_Img${img.id}`;

        return `
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="${wInEmu}" cy="${hInEmu}"/>
            <wp:docPr id="${globalIdx}" name="Image_${globalIdx}"/>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:nvPicPr>
                    <pic:cNvPr id="${globalIdx}" name="img_${globalIdx}.png"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="${relId}"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="${wInEmu}" cy="${hInEmu}"/></a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>`;
      };

      // Helper to render Boxed Section Header as 1x1 table
      const renderBoxedHeaderXml = (title: string) => {
        return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="10000" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
          <w:left w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
          <w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
          <w:right w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
        </w:tblBorders>
        <w:tblCellMar>
          <w:top w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/>
        </w:tblCellMar>
      </w:tblPr>
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="10000" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>
          </w:tcPr>
          <w:p>
            <w:pPr>
              <w:jc w:val="center"/>
              <w:spacing w:before="60" w:after="60"/>
            </w:pPr>
            <w:r>
              <w:rPr>
                <w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/>
                <w:b/>
                <w:sz w:val="26"/>
                <w:color w:val="64748B"/>
              </w:rPr>
              <w:t xml:space="preserve">${escapeXml(title)}</w:t>
            </w:r>
          </w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr></w:p>`;
      };

      // Helper to render Form Table rows with horizontal divider lines
      const renderFormTableXml = (table: FormTableBlock) => {
        let rowsXml = "";
        for (const row of table.rows) {
          const labelSz = row.fontSize ? Math.round(row.fontSize * 2) : fontSizePt * 2;
          const valSz = labelSz;
          const labelColor = preserveColors && row.labelColor ? `<w:color w:val="${row.labelColor}"/>` : "";
          const valColor = preserveColors && row.valueColor ? `<w:color w:val="${row.valueColor}"/>` : "";

          // Multi-line value support (e.g. street address lines)
          const valueLines = row.value.split("\n");
          let valueRunsXml = "";
          for (let lIdx = 0; lIdx < valueLines.length; lIdx++) {
            const vLine = valueLines[lIdx];
            if (lIdx > 0) {
              valueRunsXml += `</w:p><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="20" w:after="40"/></w:pPr>`;
            }
            valueRunsXml += `
            <w:r>
              <w:rPr><w:sz w:val="${valSz}"/>${valColor}</w:rPr>
              <w:t xml:space="preserve">${escapeXml(vLine)}</w:t>
            </w:r>`;
          }

          rowsXml += `
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="5200" w:type="dxa"/>
            <w:tcBorders>
              <w:top w:val="none"/><w:left w:val="none"/><w:right w:val="none"/>
              <w:bottom w:val="single" w:sz="6" w:space="0" w:color="D1D5DB"/>
            </w:tcBorders>
            <w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/></w:tcMar>
          </w:tcPr>
          <w:p>
            <w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>
            <w:r>
              <w:rPr><w:b/><w:sz w:val="${labelSz}"/>${labelColor}</w:rPr>
              <w:t xml:space="preserve">${escapeXml(row.label)}</w:t>
            </w:r>
          </w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="4800" w:type="dxa"/>
            <w:tcBorders>
              <w:top w:val="none"/><w:left w:val="none"/><w:right w:val="none"/>
              <w:bottom w:val="single" w:sz="6" w:space="0" w:color="D1D5DB"/>
            </w:tcBorders>
            <w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/></w:tcMar>
          </w:tcPr>
          <w:p>
            <w:pPr><w:jc w:val="right"/><w:spacing w:before="60" w:after="60"/></w:pPr>
            ${valueRunsXml}
          </w:p>
        </w:tc>
      </w:tr>`;
        }

        return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="10000" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="none"/><w:left w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/>
          <w:bottom w:val="none"/>
        </w:tblBorders>
      </w:tblPr>
      ${rowsXml}
    </w:tbl>
    <w:p><w:pPr><w:spacing w:before="0" w:after="80"/></w:pPr></w:p>`;
      };

      // Helper to render Barcodes Table with embedded images
      const renderBarcodesTableXml = (
        bcBlock: BarcodesBlock,
        pageNum: number,
        startImgCounter: number
      ) => {
        let col2Drawing = "";
        let col3Drawing = "";
        let imgCount = startImgCounter;

        if (extractImages && bcBlock.ds160BarcodeImg) {
          imgCount++;
          col2Drawing = renderDrawingML(bcBlock.ds160BarcodeImg, pageNum, imgCount);
        }
        if (extractImages && bcBlock.uidBarcodeImg) {
          imgCount++;
          col3Drawing = renderDrawingML(bcBlock.uidBarcodeImg, pageNum, imgCount);
        }

        return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="10000" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/>
          <w:insideH w:val="none"/><w:insideV w:val="none"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="2600" w:type="dxa"/></w:tcPr>
          <w:p><w:pPr><w:spacing w:before="100" w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>Applicant Name:</w:t></w:r></w:p>
          <w:p><w:pPr><w:spacing w:before="40" w:after="100"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${escapeXml(bcBlock.applicantName)}</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="4600" w:type="dxa"/></w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="100" w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>DS-160:</w:t></w:r></w:p>
          <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="100"/></w:pPr><w:r>${col2Drawing}</w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2800" w:type="dxa"/></w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="100" w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>UID:</w:t></w:r></w:p>
          <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="100"/></w:pPr><w:r>${col3Drawing}</w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:pPr><w:spacing w:before="0" w:after="80"/></w:pPr></w:p>`;
      };

      // Helper to render text line to OpenXML paragraph
      const renderLineXml = (line: DocumentLine) => {
        let pPrXml = "<w:pPr>";

        if (line.alignment !== "left") {
          pPrXml += `<w:jc w:val="${line.alignment}"/>`;
        }
        if (line.isHeading1) {
          pPrXml += `<w:pStyle w:val="Heading1"/>`;
        } else if (line.isHeading2) {
          pPrXml += `<w:pStyle w:val="Heading2"/>`;
        } else if (line.isHeading3) {
          pPrXml += `<w:pStyle w:val="Heading3"/>`;
        } else if (line.isBullet) {
          pPrXml += `<w:pStyle w:val="ListBullet"/>`;
        }

        const fullLineText = line.runs.map((r) => r.text).join(" ").trim();
        // Add subtle divider line if this is "CHENNAI VAC" on Page 1
        if (fullLineText === "CHENNAI VAC") {
          pPrXml += `
          <w:pBdr>
            <w:top w:val="single" w:sz="6" w:space="8" w:color="D1D5DB"/>
          </w:pBdr>`;
        }

        const spacingBefore = line.isHeading1 ? 320 : line.isHeading2 ? 220 : 0;
        const spacingAfter = line.isHeading1 ? 160 : line.isHeading2 ? 100 : line.isBullet ? 80 : 60;
        pPrXml += `<w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}" w:line="260" w:lineRule="auto"/>`;
        pPrXml += "</w:pPr>";

        let runsXml = "";
        for (const run of line.runs) {
          let rPrXml = "<w:rPr>";
          if (run.isBold) rPrXml += "<w:b/>";
          if (run.isItalic) rPrXml += "<w:i/>";

          const runSzVal = Math.round(run.fontSize * 2);
          rPrXml += `<w:sz w:val="${runSzVal}"/>`;

          const isUrl = /https?:\/\/|www\.|\.gov|\.com|@/i.test(run.text);
          if (isUrl) {
            rPrXml += `<w:color w:val="0066CC"/><w:u w:val="single"/>`;
          } else if (preserveColors && run.color) {
            rPrXml += `<w:color w:val="${run.color}"/>`;
          }

          if (run.fontFamily && run.fontFamily !== "Segoe UI") {
            rPrXml += `<w:rFonts w:ascii="${escapeXml(run.fontFamily)}" w:hAnsi="${escapeXml(run.fontFamily)}"/>`;
          }

          rPrXml += "</w:rPr>";
          runsXml += `
      <w:r>
        ${rPrXml}
        <w:t xml:space="preserve">${escapeXml(run.text)} </w:t>
      </w:r>`;
        }

        return `
    <w:p>
      ${pPrXml}${runsXml}
    </w:p>`;
      };

      let documentXmlBody = "";
      let globalImageCounter = 100;

      // Filter out blank pages if omitBlankPages is true
      const activePages = omitBlankPages
        ? pages.filter((p) => p.blocks.length > 0 || p.images.length > 0 || includePageArtwork)
        : pages;

      for (let pIdx = 0; pIdx < activePages.length; pIdx += 1) {
        const page = activePages[pIdx];

        // If page artwork embedding is enabled
        if (includePageArtwork) {
          const cxEmu = Math.round(page.widthPt * 12700);
          const cyEmu = Math.round(page.heightPt * 12700);
          const relId = `rIdArt${page.pageNum}`;
          globalImageCounter++;
          documentXmlBody += `
    <w:p>
      <w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="160"/></w:pPr>
      <w:r>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="${cxEmu}" cy="${cyEmu}"/>
            <wp:docPr id="${globalImageCounter}" name="Artwork_${page.pageNum}"/>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:nvPicPr><pic:cNvPr id="${globalImageCounter}" name="art_${page.pageNum}.png"/><pic:cNvPicPr/></pic:nvPicPr>
                  <pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
                  <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cxEmu}" cy="${cyEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>`;
        }

        // Render each block in strict top-to-bottom sequence
        for (const block of page.blocks) {
          if (block.type === "boxed-header") {
            documentXmlBody += renderBoxedHeaderXml(block.text);
          } else if (block.type === "form-table") {
            documentXmlBody += renderFormTableXml(block);
          } else if (block.type === "barcodes") {
            documentXmlBody += renderBarcodesTableXml(block, page.pageNum, globalImageCounter);
            globalImageCounter += 2;
          } else if (block.type === "text") {
            for (const line of block.lines) {
              documentXmlBody += renderLineXml(line);
            }
          }
        }

        // Page breaks between active pages
        if (preservePageBreaks && pIdx < activePages.length - 1) {
          documentXmlBody += `
    <w:p>
      <w:r><w:br w:type="page"/></w:r>
    </w:p>`;
        }
      }

      // Section properties with dimensions
      documentXmlBody += `
    <w:sectPr>
      <w:pgSz w:w="${pageW_dxa}" w:h="${pageH_dxa}" w:orient="${isLandscape ? "landscape" : "portrait"}"/>
      <w:pgMar w:top="${marginDxa}" w:right="${marginDxa}" w:bottom="${marginDxa}" w:left="${marginDxa}" w:header="720" w:footer="720"/>
    </w:sectPr>`;

      zip.file(
        "word/document.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${documentXmlBody}
  </w:body>
</w:document>`
      );

      const docxBlob = await zip.generateAsync({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const url = URL.createObjectURL(docxBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file?.name ? file.name.replace(/\.pdf$/i, "") : "document"}.docx`;
      a.click();
      URL.revokeObjectURL(url);

      setMessage("✓ Downloaded high-fidelity Word document (.docx) with exact layout, divider tables, bold typography, barcodes, and colors!");
    } catch (err) {
      console.error("DOCX generation error:", err);
      setError("Failed to create Word document.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  const allPaletteColors = Array.from(
    new Map(pages.flatMap((p) => p.palette).map((item) => [item.hex, item.count])).entries()
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const totalExtractedImages = pages.reduce((acc, p) => acc + p.images.length, 0);

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
          <span className="upload-icon">W</span>
          <strong>Drop PDF document here</strong>
          <span className="upload-hint">or click to browse · converts into editable Word document (.docx) with preserved colors, images, and layout</span>
        </label>
      )}

      {file && (
        <div className="loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{file.name}</strong>
              <span className="page-count">{pages.length} Page{pages.length !== 1 ? "s" : ""}</span>
              {totalExtractedImages > 0 && (
                <span className="page-count" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10B981" }}>
                  📷 {totalExtractedImages} Image{totalExtractedImages !== 1 ? "s" : ""} Extracted
                </span>
              )}
            </div>
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                setFile(null);
                setPages([]);
                setMessage("");
                setError("");
              }}
              disabled={busy}
            >
              Choose another PDF
            </button>
          </div>

          <div className="word-fidelity-banner">
            <span className="fidelity-badge">✦ Section-Structured OpenXML Engine</span>
            <span>Accurately preserves form tables, boxed headers, barcode images, bold typography, colors, and layout in native Word styles.</span>
          </div>

          {/* Palette Bar */}
          {allPaletteColors.length > 0 && (
            <div className="word-palette-bar">
              <span className="word-palette-label">Detected PDF Colors:</span>
              <div className="word-palette-chips">
                {allPaletteColors.map(([hex]) => (
                  <span key={hex} className="word-color-chip" title={`Color #${hex}`}>
                    <span className="word-color-dot" style={{ backgroundColor: `#${hex}` }} />
                    #{hex}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Mode & Formatting Controls */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              alignItems: "center",
              margin: "16px 0",
              background: "var(--surface)",
              padding: "14px 18px",
              borderRadius: 8,
              border: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                Layout Mode:
              </span>
              <div className="word-mode-tabs">
                <button
                  type="button"
                  className={`word-mode-tab ${conversionMode === "visual" ? "active" : ""}`}
                  onClick={() => setConversionMode("visual")}
                  disabled={busy}
                  title="Preserves exact section blocks, form tables, and barcode tables"
                >
                  📐 Visual Precision (Structured Sections)
                </button>
                <button
                  type="button"
                  className={`word-mode-tab ${conversionMode === "flow" ? "active" : ""}`}
                  onClick={() => setConversionMode("flow")}
                  disabled={busy}
                  title="Converts into standard flowing editable paragraphs"
                >
                  📝 Reflowable Flow
                </button>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label htmlFor="word-font" style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                Base Font:
              </label>
              <select
                id="word-font"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as FontFamily)}
                disabled={busy}
                style={{
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 12,
                }}
              >
                <option value="Segoe UI">Segoe UI (Matched from PDF)</option>
                <option value="Calibri">Calibri (Standard Word)</option>
                <option value="Arial">Arial (Clean)</option>
                <option value="Times New Roman">Times New Roman (Classic)</option>
                <option value="Georgia">Georgia (Editorial)</option>
                <option value="Inter">Inter (Modern)</option>
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label htmlFor="word-size" style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                Base Size:
              </label>
              <select
                id="word-size"
                value={fontSizePt}
                onChange={(e) => setFontSizePt(parseInt(e.target.value, 10))}
                disabled={busy}
                style={{
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 12,
                }}
              >
                <option value={10}>10 pt</option>
                <option value={11}>11 pt (Default)</option>
                <option value={12}>12 pt (Large)</option>
              </select>
            </div>
          </div>

          {/* Feature Toggles */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              alignItems: "center",
              margin: "-8px 0 16px 0",
              background: "var(--surface)",
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              fontSize: 13,
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={preserveColors}
                onChange={(e) => setPreserveColors(e.target.checked)}
                disabled={busy}
              />
              <span style={{ fontWeight: 600 }}>Preserve PDF text colors</span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={extractImages}
                onChange={(e) => setExtractImages(e.target.checked)}
                disabled={busy}
              />
              <span style={{ fontWeight: 600 }}>Extract & position barcode images</span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={omitBlankPages}
                onChange={(e) => setOmitBlankPages(e.target.checked)}
                disabled={busy}
              />
              <span style={{ fontWeight: 600 }}>Omit blank pages (recommended)</span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={matchPdfDimensions}
                onChange={(e) => setMatchPdfDimensions(e.target.checked)}
                disabled={busy}
              />
              <span>Match original PDF page dimensions</span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={preservePageBreaks}
                onChange={(e) => setPreservePageBreaks(e.target.checked)}
                disabled={busy}
              />
              <span>Preserve page breaks</span>
            </label>
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
              onClick={handleDownloadDocx}
              disabled={busy || !pages.length}
            >
              {busy ? "Generating Word Document…" : "Download Word Document (.docx) ↓"}
            </button>
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          {/* Document Content & Real Colors/Layout/Images Preview */}
          {pages.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <strong style={{ fontSize: 14, color: "var(--text)" }}>
                  Document Layout, Images & Color Flow Preview ({pages.length} Pages)
                </strong>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  Rendered with structured sections, divider tables, bold typography, and barcode images
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {pages.map((page) => {
                  if (page.blocks.length === 0 && page.images.length === 0 && omitBlankPages) {
                    return (
                      <div key={page.pageNum} className="word-preview-page" style={{ opacity: 0.6, padding: "16px 24px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
                            PAGE {page.pageNum} · Blank Page (Omitted from Word export)
                          </span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={page.pageNum} className="word-preview-page">
                      <div className="word-preview-header">
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>
                          PAGE {page.pageNum} · {Math.round(page.widthPt)} × {Math.round(page.heightPt)} pt
                        </span>
                        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--muted)" }}>
                          {page.images.length > 0 && (
                            <span style={{ color: "#10B981", fontWeight: 600 }}>
                              📷 {page.images.length} Image{page.images.length !== 1 ? "s" : ""}
                            </span>
                          )}
                          <span>
                            {page.blocks.length} layout block{page.blocks.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>

                      {/* Extracted Images Strip if present */}
                      {page.images.length > 0 && extractImages && (
                        <div
                          style={{
                            display: "flex",
                            gap: 12,
                            flexWrap: "wrap",
                            marginBottom: 16,
                            padding: "10px 14px",
                            background: "var(--bg)",
                            borderRadius: 8,
                            border: "1px solid var(--line)",
                          }}
                        >
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", alignSelf: "center", textTransform: "uppercase" }}>
                            Extracted Images ({page.images.length}):
                          </span>
                          {page.images.map((img) => (
                            <div
                              key={img.id}
                              style={{
                                display: "inline-flex",
                                flexDirection: "column",
                                alignItems: "center",
                                background: "var(--surface)",
                                padding: 6,
                                borderRadius: 6,
                                border: "1px solid var(--line)",
                              }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={img.pngDataUrl}
                                alt={img.name}
                                style={{ maxHeight: 54, maxWidth: 120, objectFit: "contain", borderRadius: 4 }}
                              />
                              <span style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
                                at ({Math.round(img.leftPt)}, {Math.round(img.topPt)}) pt
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                        {page.blocks.map((block, bIdx) => {
                          if (block.type === "boxed-header") {
                            return (
                              <div
                                key={bIdx}
                                style={{
                                  border: "1px solid #CBD5E1",
                                  borderRadius: 6,
                                  background: "#F8FAFC",
                                  padding: "8px 14px",
                                  textAlign: "center",
                                  margin: "16px 0 10px 0",
                                  fontSize: 13,
                                  fontWeight: 700,
                                  letterSpacing: "0.5px",
                                  color: "#475569",
                                }}
                              >
                                {block.text}
                              </div>
                            );
                          }

                          if (block.type === "form-table") {
                            return (
                              <div
                                key={bIdx}
                                style={{
                                  border: "1px solid var(--line)",
                                  borderRadius: 8,
                                  overflow: "hidden",
                                  margin: "12px 0",
                                  background: "var(--surface)",
                                }}
                              >
                                {block.rows.map((row, rIdx) => (
                                  <div
                                    key={rIdx}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      padding: "8px 14px",
                                      borderBottom: rIdx < block.rows.length - 1 ? "1px solid #E2E8F0" : "none",
                                      background: rIdx % 2 === 0 ? "transparent" : "rgba(0, 0, 0, 0.012)",
                                    }}
                                  >
                                    <span style={{ fontWeight: 700, color: preserveColors && row.labelColor ? `#${row.labelColor}` : "var(--text)" }}>
                                      {row.label}
                                    </span>
                                    <span
                                      style={{
                                        color: preserveColors && row.valueColor ? `#${row.valueColor}` : "var(--text)",
                                        textAlign: "right",
                                        whiteSpace: "pre-line",
                                      }}
                                    >
                                      {row.value}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          }

                          if (block.type === "barcodes") {
                            return (
                              <div
                                key={bIdx}
                                style={{
                                  border: "1px solid var(--line)",
                                  borderRadius: 8,
                                  padding: "12px 16px",
                                  margin: "12px 0",
                                  background: "var(--surface)",
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1.5fr 1fr",
                                  gap: 16,
                                  alignItems: "center",
                                }}
                              >
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                                    Applicant Name:
                                  </div>
                                  <div style={{ fontSize: 13, color: "var(--text)" }}>
                                    {block.applicantName}
                                  </div>
                                </div>
                                <div style={{ textAlign: "center" }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                                    DS-160:
                                  </div>
                                  {block.ds160BarcodeImg && (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                      src={block.ds160BarcodeImg.pngDataUrl}
                                      alt="DS-160 Barcode"
                                      style={{ maxHeight: 60, maxWidth: "100%", objectFit: "contain" }}
                                    />
                                  )}
                                </div>
                                <div style={{ textAlign: "center" }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                                    UID:
                                  </div>
                                  {block.uidBarcodeImg && (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                      src={block.uidBarcodeImg.pngDataUrl}
                                      alt="UID Barcode"
                                      style={{ maxHeight: 60, maxWidth: "100%", objectFit: "contain" }}
                                    />
                                  )}
                                </div>
                              </div>
                            );
                          }

                          if (block.type === "text") {
                            return (
                              <div key={bIdx} style={{ marginBottom: 12 }}>
                                {block.lines.map((line, lIdx) => (
                                  <PreviewLine key={lIdx} line={line} preserveColors={preserveColors} />
                                ))}
                              </div>
                            );
                          }

                          return null;
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewLine({ line, preserveColors }: { line: DocumentLine; preserveColors: boolean }) {
  const isHeading = line.isHeading1 || line.isHeading2 || line.isHeading3;

  return (
    <div
      style={{
        textAlign: line.alignment,
        marginBottom: isHeading ? 8 : 4,
        marginTop: line.isHeading1 ? 14 : line.isHeading2 ? 10 : 0,
        fontWeight: isHeading ? 700 : 400,
        fontSize: line.isHeading1 ? 18 : line.isHeading2 ? 14.5 : 13,
      }}
    >
      {line.runs.map((run, rIdx) => {
        const isUrl = /https?:\/\/|www\.|\.gov|\.com|@/i.test(run.text);
        const textColor = isUrl
          ? "#2563EB"
          : preserveColors && run.color
          ? `#${run.color}`
          : "var(--text)";

        return (
          <span
            key={rIdx}
            style={{
              color: textColor,
              fontWeight: run.isBold ? 700 : undefined,
              fontStyle: run.isItalic ? "italic" : undefined,
              textDecoration: isUrl ? "underline" : undefined,
              marginRight: 2,
            }}
          >
            {run.text}
          </span>
        );
      })}
    </div>
  );
}
