import { PDFDocument, PDFName, degrees } from "pdf-lib";

export type PdfPage = {
  id: string;
  file: File | null;
  fileIndex: number;
  pageIndex: number;
  url: string;
  rotation?: number;
  blank?: boolean;
  width?: number;
  height?: number;
};

async function drawPageInCell(
  output: PDFDocument,
  sheet: ReturnType<PDFDocument["addPage"]>,
  sourceDoc: PDFDocument | null,
  pageIndex: number,
  rotationDeg: number,
  cellX: number,
  cellY: number,
  cellW: number,
  cellH: number
) {
  if (!sourceDoc) return; // Blank page, keep cell empty

  const srcPage = sourceDoc.getPage(pageIndex);
  const contentsRef = srcPage.node.get(PDFName.of("Contents"));
  if (!contentsRef) {
    // Empty / blank page in source PDF, keep cell empty
    return;
  }

  const embedded = await output.embedPage(srcPage);
  const intrinsicRot = srcPage.getRotation() ? srcPage.getRotation().angle : 0;
  const rot = (((rotationDeg || 0) + intrinsicRot) % 360 + 360) % 360;
  const isRotated90or270 = rot === 90 || rot === 270;

  const contentW = isRotated90or270 ? embedded.height : embedded.width;
  const contentH = isRotated90or270 ? embedded.width : embedded.height;

  const scale = Math.min(cellW / contentW, cellH / contentH);
  const drawW = contentW * scale;
  const drawH = contentH * scale;

  const targetX = cellX + (cellW - drawW) / 2;
  const targetY = cellY + (cellH - drawH) / 2;

  let drawX = targetX;
  let drawY = targetY;
  if (rot === 90) {
    drawX = targetX + drawW;
    drawY = targetY;
  } else if (rot === 180) {
    drawX = targetX + drawW;
    drawY = targetY + drawH;
  } else if (rot === 270) {
    drawX = targetX;
    drawY = targetY + drawH;
  }

  sheet.drawPage(embedded, {
    x: drawX,
    y: drawY,
    width: embedded.width * scale,
    height: embedded.height * scale,
    rotate: degrees(rot),
  });
}

export async function createPdfFromPages(pages: PdfPage[], options: { nUp?: 2 | 4 | 8; booklet?: boolean } = {}) {
  const output = await PDFDocument.create();
  const sources = new Map<File, PDFDocument>();

  const getSourceDoc = async (file: File | null) => {
    if (!file) return null;
    let source = sources.get(file);
    if (!source) {
      source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      sources.set(file, source);
    }
    return source;
  };

  if (options.booklet) {
    const padded = [...pages];
    while (padded.length % 4 !== 0) {
      padded.push({
        id: `blank-booklet-${padded.length}`,
        file: null,
        fileIndex: 0,
        pageIndex: 0,
        url: "",
        blank: true,
        width: 612,
        height: 792,
      });
    }
    const n = padded.length;
    const numSheets = n / 4;
    const bookletPairs: [PdfPage, PdfPage][] = [];
    for (let s = 0; s < numSheets; s++) {
      // Sheet s Front
      bookletPairs.push([padded[n - 1 - 2 * s], padded[2 * s]]);
      // Sheet s Back
      bookletPairs.push([padded[2 * s + 1], padded[n - 2 - 2 * s]]);
    }

    const sheetW = 792;
    const sheetH = 612; // Landscape Letter
    const cellW = sheetW / 2;
    const cellH = sheetH;

    for (const [leftPage, rightPage] of bookletPairs) {
      const sheet = output.addPage([sheetW, sheetH]);
      if (leftPage && leftPage.file && !leftPage.blank) {
        const doc = await getSourceDoc(leftPage.file);
        await drawPageInCell(output, sheet, doc, leftPage.pageIndex, leftPage.rotation || 0, 0, 0, cellW, cellH);
      }
      if (rightPage && rightPage.file && !rightPage.blank) {
        const doc = await getSourceDoc(rightPage.file);
        await drawPageInCell(output, sheet, doc, rightPage.pageIndex, rightPage.rotation || 0, cellW, 0, cellW, cellH);
      }
    }
    return output.save();
  }

  if (options.nUp) {
    const nUp = options.nUp;
    const isLandscape = nUp === 2 || nUp === 8;
    const sheetW = isLandscape ? 792 : 612;
    const sheetH = isLandscape ? 612 : 792;
    const cols = nUp === 2 ? 2 : nUp === 4 ? 2 : 4;
    const rows = nUp === 2 ? 1 : nUp === 4 ? 2 : 2;
    const cellW = sheetW / cols;
    const cellH = sheetH / rows;

    for (let i = 0; i < pages.length; i += nUp) {
      const sheet = output.addPage([sheetW, sheetH]);
      for (let j = 0; j < nUp && i + j < pages.length; j++) {
        const page = pages[i + j];
        if (!page || !page.file || page.blank) continue;
        const col = j % cols;
        const row = Math.floor(j / cols);
        const cellX = col * cellW;
        const cellY = sheetH - (row + 1) * cellH;
        const doc = await getSourceDoc(page.file);
        await drawPageInCell(output, sheet, doc, page.pageIndex, page.rotation || 0, cellX, cellY, cellW, cellH);
      }
    }
    return output.save();
  }

  // Regular organize / extract / rotate / split
  for (const page of pages) {
    if (page.blank || !page.file) {
      output.addPage([page.width || 612, page.height || 792]);
      continue;
    }
    const doc = await getSourceDoc(page.file);
    if (!doc) {
      output.addPage([page.width || 612, page.height || 792]);
      continue;
    }
    const [copied] = await output.copyPages(doc, [page.pageIndex]);
    if (page.rotation) {
      copied.setRotation(degrees(((copied.getRotation()?.angle || 0) + page.rotation) % 360));
    }
    output.addPage(copied);
  }
  return output.save();
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { interleavePdfBuffers } from "./interleave-worker";
