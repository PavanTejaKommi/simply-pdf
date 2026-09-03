import { PDFDocument, degrees } from "pdf-lib";

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

export async function createPdfFromPages(pages: PdfPage[], options: { nUp?: 2 | 4 | 8; booklet?: boolean } = {}) {
  let ordered = pages;
  if (options.booklet) {
    const padded = [...pages];
    while (padded.length % 4) padded.push({ id: `blank-booklet-${padded.length}`, file: null, fileIndex: 0, pageIndex: 0, url: "", blank: true, width: 612, height: 792 });
    const booklet: PdfPage[] = [];
    for (let i = 0; i < padded.length; i += 4) {
      const q = padded.slice(i, i + 4);
      booklet.push(q[3], q[0], q[1], q[2]);
    }
    ordered = booklet;
  }
  const output = await PDFDocument.create();
  const sources = new Map<File, PDFDocument>();
  const copiedPages: { page: PdfPage; sourcePage?: ReturnType<PDFDocument["getPage"]> }[] = [];
  for (const page of ordered) {
    if (page.blank || !page.file) {
      copiedPages.push({ page });
      continue;
    }
    let source = sources.get(page.file);
    if (!source) {
      source = await PDFDocument.load(await page.file.arrayBuffer());
      sources.set(page.file, source);
    }
    const [copied] = await output.copyPages(source, [page.pageIndex]);
    copied.setRotation(degrees(page.rotation || 0));
    copiedPages.push({ page, sourcePage: copied });
  }
  if (options.nUp) {
    const cols = options.nUp === 2 ? 2 : options.nUp === 4 ? 2 : 4;
    const rows = options.nUp === 2 ? 1 : options.nUp === 4 ? 2 : 2;
    const cellW = 612 / cols, cellH = 792 / rows;
    for (let i = 0; i < copiedPages.length; i += options.nUp) {
      const sheet = output.addPage([612, 792]);
      for (let j = 0; j < options.nUp && i + j < copiedPages.length; j++) {
        const item = copiedPages[i + j];
        if (!item.sourcePage) continue;
        const embedded = await output.embedPage(item.sourcePage);
        const scale = Math.min(cellW / embedded.width, cellH / embedded.height);
        const col = j % cols, row = Math.floor(j / cols);
        sheet.drawPage(embedded, { x: col * cellW + (cellW - embedded.width * scale) / 2, y: 792 - (row + 1) * cellH + (cellH - embedded.height * scale) / 2, width: embedded.width * scale, height: embedded.height * scale });
      }
    }
  } else {
    for (const item of copiedPages) {
      if (item.sourcePage) output.addPage(item.sourcePage);
      else output.addPage([item.page.width || 612, item.page.height || 792]);
    }
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
