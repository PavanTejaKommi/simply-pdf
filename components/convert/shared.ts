import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

export function findCleanBreakY(canvas: HTMLCanvasElement, idealY: number, maxSearchUp: number): number {
  if (idealY >= canvas.height) return canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return idealY;

  const startY = Math.max(0, idealY - maxSearchUp);
  const searchHeight = idealY - startY;
  if (searchHeight <= 0) return idealY;

  try {
    const sampleX = Math.round(canvas.width * 0.08);
    const sampleW = Math.round(canvas.width * 0.84);
    const imgData = ctx.getImageData(sampleX, startY, sampleW, searchHeight);
    const data = imgData.data;

    // Search upwards from idealY - 1 towards startY for a clean whitespace row
    for (let dy = searchHeight - 1; dy >= 0; dy -= 2) {
      let isRowWhite = true;
      const rowOffset = dy * sampleW * 4;
      for (let x = 0; x < sampleW; x += 12) {
        const idx = rowOffset + x * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        if (r < 240 || g < 240 || b < 240) {
          isRowWhite = false;
          break;
        }
      }
      if (isRowWhite) {
        return startY + dy;
      }
    }
  } catch {
    // If getImageData fails (e.g. security sandbox), fallback to idealY
  }

  return idealY;
}

export interface ConvertMultiPageOptions {
  fileName: string;
  nominalPageHeightPx?: number;
  orientation?: "portrait" | "landscape";
  onProgress?: (text: string) => void;
}

export async function convertElementsToPdf(
  elements: HTMLElement[],
  options: ConvertMultiPageOptions
): Promise<jsPDF> {
  const { fileName, orientation: forcedOrientation, onProgress } = options;
  let pdf: jsPDF | null = null;

  // Pre-calculate target pages
  const plans = elements.map((elem) => {
    const rect = elem.getBoundingClientRect();
    const widthPx = elem.offsetWidth || rect.width || 816;
    const comp = window.getComputedStyle(elem);
    let nominalH = options.nominalPageHeightPx || parseFloat(comp.minHeight);
    if (!nominalH || isNaN(nominalH) || nominalH < 200) {
      nominalH = forcedOrientation === "landscape" 
        ? Math.round(widthPx * (8.5 / 11)) 
        : Math.round(widthPx * (11 / 8.5));
    }
    const totalH = elem.offsetHeight || rect.height || nominalH;
    const pages = Math.max(1, Math.ceil((totalH - 15) / nominalH));
    return { elem, widthPx, nominalH, totalH, pages };
  });

  const totalPages = plans.reduce((acc, p) => acc + p.pages, 0);
  let currentPage = 1;

  for (let i = 0; i < plans.length; i += 1) {
    const { elem, widthPx, nominalH, pages } = plans[i];

    onProgress?.(`Rendering page ${currentPage} of ${totalPages} (192 DPI)…`);
    await new Promise((r) => setTimeout(r, 25));

    const widthPt = (widthPx / 96) * 72;
    const pageHeightPt = (nominalH / 96) * 72;
    const isLandscape = forcedOrientation ? forcedOrientation === "landscape" : widthPt > pageHeightPt;

    const fullCanvas = await html2canvas(elem, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      scrollX: 0,
      scrollY: 0,
      windowWidth: Math.max(document.documentElement.offsetWidth, elem.scrollWidth),
    });

    if (pages === 1) {
      if (!pdf) {
        pdf = new jsPDF({
          orientation: isLandscape ? "landscape" : "portrait",
          unit: "pt",
          format: [widthPt, pageHeightPt],
        });
      } else {
        pdf.addPage([widthPt, pageHeightPt], isLandscape ? "landscape" : "portrait");
      }

      const imgData = fullCanvas.toDataURL("image/jpeg", 0.95);
      pdf.addImage(imgData, "JPEG", 0, 0, widthPt, pageHeightPt, undefined, "FAST");
      currentPage += 1;
    } else {
      const nominalCanvasH = Math.round(nominalH * 2);
      let currentCanvasY = 0;

      while (currentCanvasY < fullCanvas.height - 10) {
        onProgress?.(`Rendering page ${currentPage} of ${totalPages} (192 DPI)…`);
        await new Promise((r) => setTimeout(r, 20));

        const idealNextY = currentCanvasY + nominalCanvasH;
        let sliceEndY = idealNextY;

        if (sliceEndY < fullCanvas.height) {
          sliceEndY = findCleanBreakY(fullCanvas, idealNextY, Math.round(nominalCanvasH * 0.08));
        } else {
          sliceEndY = fullCanvas.height;
        }

        if (sliceEndY <= currentCanvasY) {
          sliceEndY = Math.min(fullCanvas.height, currentCanvasY + nominalCanvasH);
        }

        const sliceH = Math.max(1, sliceEndY - currentCanvasY);

        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = fullCanvas.width;
        pageCanvas.height = nominalCanvasH;
        const ctx = pageCanvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
          ctx.drawImage(fullCanvas, 0, currentCanvasY, fullCanvas.width, sliceH, 0, 0, fullCanvas.width, sliceH);
        }

        if (!pdf) {
          pdf = new jsPDF({
            orientation: isLandscape ? "landscape" : "portrait",
            unit: "pt",
            format: [widthPt, pageHeightPt],
          });
        } else {
          pdf.addPage([widthPt, pageHeightPt], isLandscape ? "landscape" : "portrait");
        }

        const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
        pdf.addImage(imgData, "JPEG", 0, 0, widthPt, pageHeightPt, undefined, "FAST");

        currentCanvasY = sliceEndY;
        currentPage += 1;
      }
    }
  }

  if (!pdf) {
    pdf = new jsPDF({ unit: "pt", format: "a4" });
  }

  const outName = `${fileName.replace(/\.[^.]+$/, "")}.pdf`;
  pdf.save(outName);
  return pdf;
}
