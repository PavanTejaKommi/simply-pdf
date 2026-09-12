import { PDFDocument, PDFName, PDFRawStream, degrees, rgb, StandardFonts, PDFOperator, PDFOperatorNames, PDFNumber } from "pdf-lib";
import forge from "node-forge";

export type RedactionBounds = { pageIndex: number; x: number; y: number; width: number; height: number };

export type EncryptPdfOptions = {
  input: ArrayBuffer;
  userPassword?: string;
  ownerPassword?: string;
  keyLength?: 128 | 256;
  print?: "none" | "low" | "full" | boolean;
  modify?: "none" | "assembly" | "form" | "annotate" | "all" | boolean;
  extract?: boolean;
  annotate?: boolean;
  accessibility?: boolean;
};

export type DecryptPdfOptions = {
  input: ArrayBuffer;
  password?: string;
  userPassword?: string;
};

type QpdfRequest = {
  input: ArrayBuffer;
  mode: "encrypt" | "decrypt";
  userPassword?: string;
  ownerPassword?: string;
  keyLength?: 128 | 256;
  print?: "none" | "low" | "full" | boolean;
  modify?: "none" | "assembly" | "form" | "annotate" | "all" | boolean;
  extract?: boolean;
  annotate?: boolean;
  accessibility?: boolean;
  password?: string;
};

async function runQpdfDirect(request: QpdfRequest): Promise<Uint8Array> {
  const createQpdf = (await import("@neslinesli93/qpdf-wasm")).default;
  const errorLogs: string[] = [];

  const qpdf = await createQpdf({
    locateFile: () => "/qpdf.wasm",
    printErr: (text: string) => {
      errorLogs.push(text);
    },
  } as any);

  const qpdfModule = qpdf as typeof qpdf & {
    FS: {
      writeFile: (path: string, data: Uint8Array) => void;
      readFile: (path: string) => Uint8Array;
    };
  };

  qpdfModule.FS.writeFile("/input.pdf", new Uint8Array(request.input));

  let args: string[] = [];

  if (request.mode === "encrypt") {
    const userPass = request.userPassword || "";
    const ownerPass = request.ownerPassword || request.userPassword || "";
    const bits = String(request.keyLength === 128 ? 128 : 256);

    args.push("--encrypt", userPass, ownerPass, bits);

    if (request.print === "none" || request.print === false) {
      args.push("--print=none");
    } else if (request.print === "low") {
      args.push("--print=low");
    } else if (request.print === "full" || request.print === true) {
      args.push("--print=full");
    }

    if (request.modify === "none" || request.modify === false) {
      args.push("--modify=none");
    } else if (request.modify === "assembly") {
      args.push("--modify=assembly");
    } else if (request.modify === "form") {
      args.push("--modify=form");
    } else if (request.modify === "annotate") {
      args.push("--modify=annotate");
    } else if (request.modify === "all" || request.modify === true) {
      args.push("--modify=all");
    }

    if (request.extract === false) {
      args.push("--extract=n");
    } else if (request.extract === true) {
      args.push("--extract=y");
    }

    if (request.annotate === false) {
      args.push("--annotate=n");
    } else if (request.annotate === true) {
      args.push("--annotate=y");
    }

    if (request.accessibility === false) {
      args.push("--accessibility=n");
    }

    args.push("--", "/input.pdf", "/output.pdf");
  } else {
    const pass = request.password || request.userPassword || request.ownerPassword || "";
    if (pass) {
      args.push(`--password=${pass}`);
    }
    args.push("--decrypt", "/input.pdf", "/output.pdf");
  }

  let code = 0;
  try {
    code = qpdfModule.callMain(args);
  } catch (err: any) {
    const fullLog = errorLogs.join(" ");
    if (
      fullLog.toLowerCase().includes("invalid password") ||
      fullLog.toLowerCase().includes("incorrect password")
    ) {
      throw new Error("Incorrect password. Please verify the password and try again.");
    }
    throw new Error(fullLog || err?.message || "QPDF execution failed");
  }

  if (code !== 0) {
    const fullLog = errorLogs.join(" ");
    if (
      fullLog.toLowerCase().includes("invalid password") ||
      fullLog.toLowerCase().includes("incorrect password") ||
      code === 2
    ) {
      throw new Error("Incorrect password. Please verify the password and try again.");
    }
    throw new Error(fullLog || `QPDF exited with code ${code}`);
  }

  return qpdfModule.FS.readFile("/output.pdf");
}

export function runQpdf(request: QpdfRequest): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    try {
      if (typeof Worker !== "undefined") {
        const worker = new Worker(new URL("./qpdf-worker.ts", import.meta.url));
        worker.onmessage = (
          event: MessageEvent<{ output?: Uint8Array; error?: string }>
        ) => {
          worker.terminate();
          if (event.data.output) {
            resolve(event.data.output);
          } else {
            // If worker reported error, check if fallback is warranted
            reject(new Error(event.data.error || "QPDF operation failed"));
          }
        };
        worker.onerror = () => {
          worker.terminate();
          // Graceful fallback to direct WASM
          runQpdfDirect(request).then(resolve).catch(reject);
        };
        worker.postMessage(request, [request.input]);
      } else {
        runQpdfDirect(request).then(resolve).catch(reject);
      }
    } catch {
      runQpdfDirect(request).then(resolve).catch(reject);
    }
  });
}

export function encryptPdf(options: EncryptPdfOptions) {
  return runQpdf({ ...options, mode: "encrypt" });
}

export function decryptPdf(options: DecryptPdfOptions) {
  return runQpdf({
    input: options.input,
    mode: "decrypt",
    userPassword: options.password || options.userPassword,
    password: options.password || options.userPassword,
  });
}

export type ManagePermissionsOptions = {
  input: ArrayBuffer;
  permissionsPassword: string;
  requireOpenPassword?: boolean;
  openPassword?: string;
  keyLength?: 128 | 256;
  print?: "none" | "low" | "full" | boolean;
  modify?: "none" | "assembly" | "form" | "annotate" | "all" | boolean;
  extract?: boolean;
  annotate?: boolean;
  accessibility?: boolean;
};

export function applyPdfPermissions(options: ManagePermissionsOptions) {
  const userPass = options.requireOpenPassword ? (options.openPassword || "") : "";
  const ownerPass = options.permissionsPassword || userPass;

  return runQpdf({
    input: options.input,
    mode: "encrypt",
    userPassword: userPass,
    ownerPassword: ownerPass,
    keyLength: options.keyLength || 256,
    print: options.print,
    modify: options.modify,
    extract: options.extract,
    annotate: options.annotate,
    accessibility: options.accessibility,
  });
}

export async function checkPdfEncrypted(
  input: ArrayBuffer
): Promise<{ isEncrypted: boolean }> {
  try {
    const pdf = await PDFDocument.load(input, { ignoreEncryption: true });
    return { isEncrypted: Boolean(pdf.isEncrypted) };
  } catch (err: any) {
    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("encrypt") || msg.includes("password")) {
      return { isEncrypted: true };
    }
    return { isEncrypted: false };
  }
}

export interface RedactionItem {
  id: string;
  pageIndex: number; // 0-indexed
  x: number; // bottom-left origin in PDF points
  y: number; // bottom-left origin in PDF points
  width: number;
  height: number;
  color?: "black" | "white" | "gray";
  label?: string; // e.g. "[REDACTED]"
  reason?: string; // e.g. "Email", "Custom Box"
}

export async function redactPdf(input: ArrayBuffer, bounds: RedactionBounds[]) {
  const pdf = await PDFDocument.load(input);
  for (const bound of bounds) {
    const page = pdf.getPages()[bound.pageIndex];
    if (!page) continue;
    page.drawRectangle({ x: bound.x, y: bound.y, width: bound.width, height: bound.height, color: rgb(0, 0, 0), opacity: 1 });
  }
  return pdf.save({ useObjectStreams: true });
}

export async function applyAdvancedRedactPdf(
  input: ArrayBuffer,
  redactions: RedactionItem[]
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Group redactions by pageIndex
  const pageRedactions = new Map<number, RedactionItem[]>();
  for (const r of redactions) {
    const list = pageRedactions.get(r.pageIndex) || [];
    list.push(r);
    pageRedactions.set(r.pageIndex, list);
  }

  const pages = pdf.getPages();
  for (const [pageIndex, list] of Array.from(pageRedactions.entries())) {
    if (pageIndex < 0 || pageIndex >= pages.length) continue;
    const page = pages[pageIndex];

    for (const item of list) {
      let fillColor = rgb(0, 0, 0);
      let textColor = rgb(1, 1, 1);
      if (item.color === "white") {
        fillColor = rgb(1, 1, 1);
        textColor = rgb(0, 0, 0);
      } else if (item.color === "gray") {
        fillColor = rgb(0.25, 0.25, 0.25);
        textColor = rgb(1, 1, 1);
      }

      page.drawRectangle({
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        color: fillColor,
        opacity: 1,
      });

      if (item.label && item.width > 28 && item.height > 9) {
        const fontSize = Math.min(10, Math.max(6, item.height * 0.55));
        const textWidth = font.widthOfTextAtSize(item.label, fontSize);
        if (textWidth < item.width - 4) {
          page.drawText(item.label, {
            x: item.x + (item.width - textWidth) / 2,
            y: item.y + (item.height - fontSize) / 2,
            size: fontSize,
            font,
            color: textColor,
          });
        }
      }
    }
  }

  return pdf.save({ useObjectStreams: true });
}

export interface PdfMetadataReport {
  title: string;
  author: string;
  subject: string;
  keywords: string[];
  creator: string;
  producer: string;
  creationDate: string;
  modificationDate: string;
  hasXmp: boolean;
  pageCount: number;
  isEncrypted: boolean;
}

export async function inspectPdfMetadata(input: ArrayBuffer): Promise<PdfMetadataReport> {
  const pdf = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const title = pdf.getTitle() || "";
  const author = pdf.getAuthor() || "";
  const subject = pdf.getSubject() || "";
  const rawKeywords = pdf.getKeywords();
  const keywords = rawKeywords ? rawKeywords.split(/[,;]\s*/).filter(Boolean) : [];
  const creator = pdf.getCreator() || "";
  const producer = pdf.getProducer() || "";
  let creationDate = "";
  try {
    const cd = pdf.getCreationDate();
    if (cd) creationDate = cd.toISOString();
  } catch {
    creationDate = "";
  }
  let modificationDate = "";
  try {
    const md = pdf.getModificationDate();
    if (md) modificationDate = md.toISOString();
  } catch {
    modificationDate = "";
  }
  const catalog = pdf.catalog;
  const hasXmp = Boolean(catalog.has(PDFName.of("Metadata")));
  const pageCount = pdf.getPageCount();

  return {
    title,
    author,
    subject,
    keywords,
    creator,
    producer,
    creationDate,
    modificationDate,
    hasXmp,
    pageCount,
    isEncrypted: Boolean(pdf.isEncrypted),
  };
}

export interface SanitizeOptions {
  stripAuthor?: boolean;
  stripTitle?: boolean;
  stripSubject?: boolean;
  stripKeywords?: boolean;
  stripCreator?: boolean;
  stripProducer?: boolean;
  stripCreationDate?: boolean;
  stripModificationDate?: boolean;
  stripXmp?: boolean;
  customTitle?: string;
  customAuthor?: string;
}

export async function sanitizePdf(input: ArrayBuffer) {
  return applyAdvancedSanitizePdf(input);
}

export async function applyAdvancedSanitizePdf(
  input: ArrayBuffer,
  options: SanitizeOptions = {}
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input, { updateMetadata: false, ignoreEncryption: true });

  if (options.stripTitle ?? true) pdf.setTitle(options.customTitle || "");
  if (options.stripAuthor ?? true) pdf.setAuthor(options.customAuthor || "");
  if (options.stripSubject ?? true) pdf.setSubject("");
  if (options.stripKeywords ?? true) pdf.setKeywords([]);
  if (options.stripCreator ?? true) pdf.setCreator("");
  if (options.stripProducer ?? true) pdf.setProducer("");
  if (options.stripCreationDate ?? true) pdf.setCreationDate(new Date(0));
  if (options.stripModificationDate ?? true) pdf.setModificationDate(new Date(0));

  if (options.stripXmp ?? true) {
    const catalog = pdf.catalog;
    if (catalog.has(PDFName.of("Metadata"))) {
      catalog.delete(PDFName.of("Metadata"));
    }
    if (catalog.has(PDFName.of("PieceInfo"))) {
      catalog.delete(PDFName.of("PieceInfo"));
    }
  }

  return pdf.save({ useObjectStreams: true, addDefaultPage: false });
}

export async function stampSignature(input: ArrayBuffer, png: Uint8Array, pageIndex: number, x: number, y: number, width: number, height: number) {
  const pdf = await PDFDocument.load(input); const page = pdf.getPages()[pageIndex]; if (!page) throw new Error("Signature page does not exist");
  page.drawImage(await pdf.embedPng(png), { x, y, width, height }); return pdf.save({ useObjectStreams: true });
}

// ---------------------------------------------------------------------------
// Advanced Watermark Engine: All Scenarios, Multiple Colors & Opacity
// ---------------------------------------------------------------------------

export type WatermarkType = "text" | "image";

export type WatermarkLayout =
  | "diagonal"
  | "center"
  | "tiled"
  | "header"
  | "footer"
  | "anchor"
  | "custom";

export type WatermarkAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type WatermarkFontFamily = "Helvetica" | "TimesRoman" | "Courier";
export type WatermarkFontStyle = "regular" | "bold" | "italic" | "boldItalic";
export type WatermarkRenderMode = "fill" | "stroke" | "both";
export type WatermarkPageSelection = "all" | "first" | "last" | "odd" | "even" | "custom";
export type WatermarkLayer = "foreground" | "background";

export interface WatermarkOptions {
  type: WatermarkType;
  // Text options
  text?: string;
  colorHex?: string; // e.g. #ef4444
  fontSize?: number; // in pt, default 48
  fontFamily?: WatermarkFontFamily;
  fontStyle?: WatermarkFontStyle;
  renderMode?: WatermarkRenderMode;
  strokeWidth?: number;

  // Image options
  imageBytes?: Uint8Array;
  imageFormat?: "png" | "jpeg";
  imageScalePct?: number; // 10% to 150%, default 40%

  // Layout & positioning
  layout: WatermarkLayout;
  anchor?: WatermarkAnchor;
  rotationDeg?: number; // -180 to 180
  opacity: number; // 0.05 to 1.0
  customOffsetX?: number; // 0 to 100 (% of page width)
  customOffsetY?: number; // 0 to 100 (% of page height)
  layer?: WatermarkLayer;

  // Target pages
  pageSelection?: WatermarkPageSelection;
  customPageRange?: string; // e.g. "1-3, 5"
}

export function parseColorToRgb(hex: string = "#ef4444") {
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  const val = parseInt(clean, 16);
  if (isNaN(val)) return { r: 0.85, g: 0.15, b: 0.15 };
  return {
    r: Math.min(1, Math.max(0, ((val >> 16) & 255) / 255)),
    g: Math.min(1, Math.max(0, ((val >> 8) & 255) / 255)),
    b: Math.min(1, Math.max(0, (val & 255) / 255)),
  };
}

export function parsePageRange(rangeStr: string, totalPages: number): Set<number> {
  const result = new Set<number>();
  if (!rangeStr || !rangeStr.trim()) return result;
  const parts = rangeStr.split(/[,;\s]+/);
  for (const part of parts) {
    if (!part) continue;
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = Math.max(1, parseInt(startStr, 10));
      const end = Math.min(totalPages, parseInt(endStr, 10));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          result.add(i - 1);
        }
      }
    } else {
      const pageNum = parseInt(part, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        result.add(pageNum - 1);
      }
    }
  }
  return result;
}

export function shouldWatermarkPage(
  pageIndex: number,
  totalPages: number,
  selection: WatermarkPageSelection = "all",
  customRange?: string
): boolean {
  if (selection === "all") return true;
  if (selection === "first") return pageIndex === 0;
  if (selection === "last") return pageIndex === totalPages - 1;
  if (selection === "odd") return pageIndex % 2 === 0; // Page 1 is index 0
  if (selection === "even") return pageIndex % 2 === 1; // Page 2 is index 1
  if (selection === "custom" && customRange) {
    const set = parsePageRange(customRange, totalPages);
    return set.has(pageIndex);
  }
  return true;
}

export function resolveStandardFont(
  family: WatermarkFontFamily = "Helvetica",
  style: WatermarkFontStyle = "bold"
): StandardFonts {
  if (family === "TimesRoman") {
    if (style === "bold") return StandardFonts.TimesRomanBold;
    if (style === "italic") return StandardFonts.TimesRomanItalic;
    if (style === "boldItalic") return StandardFonts.TimesRomanBoldItalic;
    return StandardFonts.TimesRoman;
  }
  if (family === "Courier") {
    if (style === "bold") return StandardFonts.CourierBold;
    if (style === "italic") return StandardFonts.CourierOblique;
    if (style === "boldItalic") return StandardFonts.CourierBoldOblique;
    return StandardFonts.Courier;
  }
  if (style === "regular") return StandardFonts.Helvetica;
  if (style === "italic") return StandardFonts.HelveticaOblique;
  if (style === "boldItalic") return StandardFonts.HelveticaBoldOblique;
  return StandardFonts.HelveticaBold;
}

export async function applyAdvancedWatermark(
  input: ArrayBuffer,
  options: WatermarkOptions
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input);
  const pages = pdf.getPages();
  const totalPages = pages.length;
  if (totalPages === 0) return pdf.save({ useObjectStreams: true });

  const isText = options.type !== "image";
  const color = parseColorToRgb(options.colorHex || "#ef4444");
  const pdfColor = rgb(color.r, color.g, color.b);
  const opacity = Math.min(1, Math.max(0.01, options.opacity ?? 0.25));

  // Pre-embed font if text mode
  let font: any = null;
  let lines: string[] = [];
  let fontSize = options.fontSize || 48;
  let lineHeight = fontSize * 1.25;

  if (isText) {
    const standardFont = resolveStandardFont(options.fontFamily, options.fontStyle);
    font = await pdf.embedFont(standardFont);
    const rawText = options.text?.trim() ? options.text : "CONFIDENTIAL";
    lines = rawText.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) lines = ["CONFIDENTIAL"];
  }

  // Pre-embed image if image mode
  let embeddedImage: any = null;
  let imgWidth = 0;
  let imgHeight = 0;

  if (!isText && options.imageBytes && options.imageBytes.length > 0) {
    const bytes = options.imageBytes;
    const isPng =
      options.imageFormat === "png" ||
      (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47);
    try {
      embeddedImage = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      imgWidth = embeddedImage.width;
      imgHeight = embeddedImage.height;
    } catch {
      // Fallback: try the other format
      try {
        embeddedImage = !isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        imgWidth = embeddedImage.width;
        imgHeight = embeddedImage.height;
      } catch (err) {
        console.warn("Failed to embed watermark image:", err);
      }
    }
  }

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    if (!shouldWatermarkPage(pageIdx, totalPages, options.pageSelection, options.customPageRange)) {
      continue;
    }

    const page = pages[pageIdx];
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();

    // Determine target rotation angle
    let angleDeg = options.rotationDeg;
    if (angleDeg === undefined) {
      if (options.layout === "diagonal") angleDeg = 45;
      else if (options.layout === "tiled") angleDeg = 35;
      else angleDeg = 0;
    }
    const angleRad = (angleDeg * Math.PI) / 180;

    // Calculate dimensions for text / image bounding box
    let boxWidth = 0;
    let boxHeight = 0;

    if (isText && font) {
      boxWidth = Math.max(...lines.map((line) => font.widthOfTextAtSize(line, fontSize)));
      boxHeight = lines.length * lineHeight;
    } else if (embeddedImage) {
      const scalePct = (options.imageScalePct || 40) / 100;
      const targetW = pageWidth * scalePct;
      const aspect = imgHeight / (imgWidth || 1);
      boxWidth = targetW;
      boxHeight = targetW * aspect;
    }

    // Determine target center coordinates (cx, cy)
    const margin = 48;
    const centers: { cx: number; cy: number }[] = [];

    if (options.layout === "diagonal" || options.layout === "center") {
      centers.push({ cx: pageWidth / 2, cy: pageHeight / 2 });
    } else if (options.layout === "header") {
      centers.push({ cx: pageWidth / 2, cy: pageHeight - 32 });
    } else if (options.layout === "footer") {
      centers.push({ cx: pageWidth / 2, cy: 32 });
    } else if (options.layout === "custom") {
      const xPct = (options.customOffsetX !== undefined ? options.customOffsetX : 50) / 100;
      const yPct = (options.customOffsetY !== undefined ? options.customOffsetY : 50) / 100;
      centers.push({ cx: pageWidth * xPct, cy: pageHeight * yPct });
    } else if (options.layout === "anchor") {
      const anchor = options.anchor || "center";
      let cx = pageWidth / 2;
      let cy = pageHeight / 2;
      if (anchor.includes("left")) cx = margin + boxWidth / 2;
      else if (anchor.includes("right")) cx = pageWidth - margin - boxWidth / 2;

      if (anchor.startsWith("top")) cy = pageHeight - margin - boxHeight / 2;
      else if (anchor.startsWith("bottom")) cy = margin + boxHeight / 2;
      centers.push({ cx, cy });
    } else if (options.layout === "tiled") {
      // 3x3 repeating grid
      const colFractions = [1 / 6, 3 / 6, 5 / 6];
      const rowFractions = [1 / 6, 3 / 6, 5 / 6];
      for (const rx of rowFractions) {
        for (const cx of colFractions) {
          centers.push({ cx: pageWidth * cx, cy: pageHeight * rx });
        }
      }
    }

    // Render onto page at all target centers
    for (const { cx, cy } of centers) {
      if (isText && font) {
        const N = lines.length;
        const renderMode = options.renderMode || "fill";

        if (renderMode === "stroke" || renderMode === "both") {
          page.pushOperators(
            PDFOperator.of(PDFOperatorNames.SetLineWidth, [
              PDFNumber.of(options.strokeWidth || 1.5),
            ]),
            PDFOperator.of(PDFOperatorNames.StrokingColorRgb, [
              PDFNumber.of(color.r),
              PDFNumber.of(color.g),
              PDFNumber.of(color.b),
            ]),
            PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [
              PDFNumber.of(renderMode === "stroke" ? 1 : 2),
            ])
          );
        }

        for (let i = 0; i < N; i++) {
          const line = lines[i];
          const lineWidth = font.widthOfTextAtSize(line, fontSize);
          const lineHeightAtSize = font.heightAtSize(fontSize) * 0.75;
          const dLocal = ((N - 1) / 2 - i) * lineHeight;

          // Offset line center along perpendicular angle
          const lineCx = cx - dLocal * Math.sin(angleRad);
          const lineCy = cy + dLocal * Math.cos(angleRad);

          const dx = (lineWidth / 2) * Math.cos(angleRad) - (lineHeightAtSize / 2) * Math.sin(angleRad);
          const dy = (lineWidth / 2) * Math.sin(angleRad) + (lineHeightAtSize / 2) * Math.cos(angleRad);

          page.drawText(line, {
            x: lineCx - dx,
            y: lineCy - dy,
            size: fontSize,
            font,
            color: pdfColor,
            opacity,
            rotate: degrees(angleDeg),
          });
        }

        if (renderMode === "stroke" || renderMode === "both") {
          page.pushOperators(
            PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [PDFNumber.of(0)])
          );
        }
      } else if (embeddedImage) {
        const dx = (boxWidth / 2) * Math.cos(angleRad) - (boxHeight / 2) * Math.sin(angleRad);
        const dy = (boxWidth / 2) * Math.sin(angleRad) + (boxHeight / 2) * Math.cos(angleRad);

        page.drawImage(embeddedImage, {
          x: cx - dx,
          y: cy - dy,
          width: boxWidth,
          height: boxHeight,
          opacity,
          rotate: degrees(angleDeg),
        });
      }
    }
  }

  return pdf.save({ useObjectStreams: true });
}

export async function applyWatermark(
  input: ArrayBuffer,
  text: string,
  opacity: number,
  repeat: boolean
) {
  return applyAdvancedWatermark(input, {
    type: "text",
    text,
    opacity,
    layout: repeat ? "tiled" : "diagonal",
    colorHex: "#334155",
    fontSize: repeat ? 28 : 48,
  });
}

export async function signWithP12(input: ArrayBuffer, certificateFile: ArrayBuffer, password: string) {
  const binary = (value: ArrayBuffer) => { const bytes = new Uint8Array(value); let result = ""; for (let index = 0; index < bytes.length; index += 1) result += String.fromCharCode(bytes[index]); return result; };
  const bytes = forge.util.createBuffer(binary(certificateFile), "raw");
  const asn1 = forge.asn1.fromDer(bytes.getBytes()); const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password); let key: forge.pki.PrivateKey | undefined; let certificate: forge.pki.Certificate | undefined;
  for (const safeContents of p12.safeContents) for (const bag of safeContents.safeBags) { if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag || bag.type === forge.pki.oids.keyBag) key = bag.key; if (bag.type === forge.pki.oids.certBag) certificate = bag.cert; }
  if (!key || !certificate) throw new Error("The certificate does not contain a private key and certificate");
  const signed = forge.pkcs7.createSignedData(); signed.content = forge.util.createBuffer(binary(input), "raw"); signed.addCertificate(certificate); signed.addSigner({ key: key as forge.pki.rsa.PrivateKey, certificate, digestAlgorithm: forge.pki.oids.sha256 }); signed.sign({ detached: true });
  const block = forge.asn1.toDer(signed.toAsn1()).getBytes(); const marker = new TextEncoder().encode(`\n% SimplyPDF-PKCS7 ${forge.util.bytesToHex(block)}\n`); const output = new Uint8Array(input.byteLength + marker.byteLength); output.set(new Uint8Array(input)); output.set(marker, input.byteLength); return output;
}

// ---------------------------------------------------------------------------
// Headers & Footers Engine
// ---------------------------------------------------------------------------

export interface HeadersFootersOptions {
  topLeft?: string;
  topCenter?: string;
  topRight?: string;
  bottomLeft?: string;
  bottomCenter?: string;
  bottomRight?: string;

  headerFontFamily?: WatermarkFontFamily;
  headerFontStyle?: WatermarkFontStyle;
  headerFontSize?: number;
  headerColorHex?: string;
  marginTop?: number;

  footerFontFamily?: WatermarkFontFamily;
  footerFontStyle?: WatermarkFontStyle;
  footerFontSize?: number;
  footerColorHex?: string;
  marginBottom?: number;

  marginX?: number;
  pageSelection?: WatermarkPageSelection;
  customPageRange?: string;
}

export async function applyAdvancedHeadersFooters(
  input: ArrayBuffer,
  options: HeadersFootersOptions
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input);
  const pages = pdf.getPages();
  const totalPages = pages.length;
  if (totalPages === 0) return pdf.save({ useObjectStreams: true });

  const headerColor = parseColorToRgb(options.headerColorHex || "#000000");
  const headerPdfColor = rgb(headerColor.r, headerColor.g, headerColor.b);
  const headerFontSize = options.headerFontSize || 12;
  const headerFont = await pdf.embedFont(resolveStandardFont(options.headerFontFamily, options.headerFontStyle));

  const footerColor = parseColorToRgb(options.footerColorHex || "#000000");
  const footerPdfColor = rgb(footerColor.r, footerColor.g, footerColor.b);
  const footerFontSize = options.footerFontSize || 12;
  const footerFont = await pdf.embedFont(resolveStandardFont(options.footerFontFamily, options.footerFontStyle));

  const marginTop = options.marginTop !== undefined ? options.marginTop : 36;
  const marginBottom = options.marginBottom !== undefined ? options.marginBottom : 36;
  const marginX = options.marginX !== undefined ? options.marginX : 36;

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    if (!shouldWatermarkPage(pageIdx, totalPages, options.pageSelection, options.customPageRange)) {
      continue;
    }

    const page = pages[pageIdx];
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();

    const drawZone = (textRaw: string | undefined, align: "left" | "center" | "right", isTop: boolean) => {
      if (!textRaw) return;
      
      const text = textRaw
        .replace(/{page}/g, String(pageIdx + 1))
        .replace(/{total}/g, String(totalPages));

      if (!text) return;

      const font = isTop ? headerFont : footerFont;
      const fontSize = isTop ? headerFontSize : footerFontSize;
      const pdfColor = isTop ? headerPdfColor : footerPdfColor;

      const textWidth = font.widthOfTextAtSize(text, fontSize);
      const textHeight = font.heightAtSize(fontSize);

      let x = marginX;
      if (align === "center") {
        x = (pageWidth - textWidth) / 2;
      } else if (align === "right") {
        x = pageWidth - marginX - textWidth;
      }

      let y = isTop ? pageHeight - marginTop - textHeight : marginBottom;

      page.drawText(text, {
        x,
        y,
        size: fontSize,
        font,
        color: pdfColor,
      });
    };

    drawZone(options.topLeft, "left", true);
    drawZone(options.topCenter, "center", true);
    drawZone(options.topRight, "right", true);
    drawZone(options.bottomLeft, "left", false);
    drawZone(options.bottomCenter, "center", false);
    drawZone(options.bottomRight, "right", false);
  }

  return pdf.save({ useObjectStreams: true });
}

export async function flattenFormsPdf(input: ArrayBuffer): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input);
  const form = pdf.getForm();
  form.flatten();
  return pdf.save({ useObjectStreams: true });
}