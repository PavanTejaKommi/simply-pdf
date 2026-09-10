"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { convertElementsToPdf } from "./shared";

interface SlideTableCell {
  text: string;
  bgColor?: string;
  textColor?: string;
  isBold?: boolean;
  align?: "left" | "center" | "right";
}

interface SlideTable {
  headers: SlideTableCell[];
  rows: SlideTableCell[][];
  colWidths?: number[];
}

interface SlideItemText {
  text: string;
  color?: string;
  isBold?: boolean;
}

interface SlideData {
  index: number;
  title: string;
  titleColor?: string;
  subtitle?: string;
  subtitleColor?: string;
  bullets: SlideItemText[];
  images: string[];
  tables: SlideTable[];
  backgroundColor?: string;
  backgroundGradient?: string;
  defaultTextColor?: string;
  rawTexts: string[];
}

function getXmlAttr(elem: Element, attrName: string): string | null {
  if (!elem || !elem.attributes) return null;
  const lower = attrName.toLowerCase();
  for (let i = 0; i < elem.attributes.length; i++) {
    const a = elem.attributes[i];
    if (
      a.name.toLowerCase() === lower ||
      a.localName?.toLowerCase() === lower ||
      a.name.toLowerCase().endsWith(":" + lower)
    ) {
      return a.value;
    }
  }
  return elem.getAttribute(attrName);
}

function extractColor(
  colorContainer: Element | null,
  themeMap: Map<string, string>
): string | null {
  if (!colorContainer) return null;

  // Check srgbClr
  const srgb =
    colorContainer.getElementsByTagName("a:srgbClr")[0] ||
    colorContainer.getElementsByTagName("srgbClr")[0];
  if (srgb) {
    const val = getXmlAttr(srgb, "val");
    if (val) return `#${val}`;
  }

  // Check schemeClr
  const scheme =
    colorContainer.getElementsByTagName("a:schemeClr")[0] ||
    colorContainer.getElementsByTagName("schemeClr")[0];
  if (scheme) {
    const val = getXmlAttr(scheme, "val");
    if (val && themeMap.has(val)) {
      return themeMap.get(val)!;
    }
  }

  // Check sysClr
  const sys =
    colorContainer.getElementsByTagName("a:sysClr")[0] ||
    colorContainer.getElementsByTagName("sysClr")[0];
  if (sys) {
    const lastClr = getXmlAttr(sys, "lastClr");
    if (lastClr) return `#${lastClr}`;
  }

  return null;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

function extractImagesFromBuffer(buf: Uint8Array): string[] {
  const images: string[] = [];
  let i = 0;
  while (i < buf.length - 8) {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (
      buf[i] === 0x89 &&
      buf[i + 1] === 0x50 &&
      buf[i + 2] === 0x4e &&
      buf[i + 3] === 0x47 &&
      buf[i + 4] === 0x0d &&
      buf[i + 5] === 0x0a &&
      buf[i + 6] === 0x1a &&
      buf[i + 7] === 0x0a
    ) {
      let end = i + 8;
      while (end < buf.length - 8) {
        if (
          buf[end] === 0x49 &&
          buf[end + 1] === 0x45 &&
          buf[end + 2] === 0x4e &&
          buf[end + 3] === 0x44
        ) {
          end += 8;
          break;
        }
        end++;
      }
      if (end > i + 8 && end <= buf.length) {
        const slice = buf.slice(i, end);
        images.push(`data:image/png;base64,${uint8ToBase64(slice)}`);
        i = end;
        continue;
      }
    }

    // JPEG signature: FF D8 FF
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      let end = i + 2;
      while (end < buf.length - 1) {
        if (buf[end] === 0xff && buf[end + 1] === 0xd9) {
          end += 2;
          break;
        }
        end++;
      }
      if (end > i + 2 && end <= buf.length) {
        const slice = buf.slice(i, end);
        images.push(`data:image/jpeg;base64,${uint8ToBase64(slice)}`);
        i = end;
        continue;
      }
    }

    i++;
  }
  return images;
}

// Full parser for legacy binary .ppt files (PowerPoint 97-2003 / OLE CFB format)
function parseBinaryPpt(buffer: ArrayBuffer): SlideData[] {
  const cfb = XLSX.CFB.read(new Uint8Array(buffer), { type: "array" });

  let pptDocBuf: Uint8Array | null = null;
  let picturesBuf: Uint8Array | null = null;

  for (const entry of cfb.FileIndex) {
    if (!entry.name) continue;
    const name = entry.name.toLowerCase();
    if (name.includes("powerpoint document") || name === "powerpoint") {
      pptDocBuf = entry.content as Uint8Array;
    } else if (name.includes("pictures")) {
      picturesBuf = entry.content as Uint8Array;
    }
  }

  if (!pptDocBuf) {
    throw new Error("Could not find PowerPoint presentation data in binary .ppt file.");
  }

  const extractedImages: string[] = picturesBuf ? extractImagesFromBuffer(picturesBuf) : [];
  const view = new DataView(pptDocBuf.buffer, pptDocBuf.byteOffset, pptDocBuf.byteLength);

  interface RawRecord {
    ver: number;
    inst: number;
    type: number;
    len: number;
    isContainer: boolean;
    start: number;
    end: number;
  }

  function readRecordHeader(offset: number): RawRecord | null {
    if (offset + 8 > pptDocBuf!.length) return null;
    const verInst = view.getUint16(offset, true);
    const ver = verInst & 0x0f;
    const inst = verInst >> 4;
    const type = view.getUint16(offset + 2, true);
    const len = view.getUint32(offset + 4, true);
    const isContainer = ver === 0x0f;
    const start = offset + 8;
    const end = Math.min(start + len, pptDocBuf!.length);
    return { ver, inst, type, len, isContainer, start, end };
  }

  interface SlideDraft {
    title: string;
    bullets: SlideItemText[];
    rawTexts: string[];
  }

  const slideListSlides: SlideDraft[] = [];
  const state: { currentSlide: SlideDraft | null; currentTextType: number } = {
    currentSlide: null,
    currentTextType: 1,
  };

  function walk(offset: number, endOffset: number) {
    let pos = offset;
    while (pos + 8 <= endOffset) {
      const rec = readRecordHeader(pos);
      if (!rec) break;

      // 4026: RT_SlidePersistAtom or 1006: RT_Slide
      if (rec.type === 4026 || rec.type === 1006) {
        if (state.currentSlide && (state.currentSlide.title || state.currentSlide.bullets.length > 0 || state.currentSlide.rawTexts.length > 0)) {
          slideListSlides.push(state.currentSlide);
        }
        state.currentSlide = { title: "", bullets: [], rawTexts: [] };
      }

      // 3998: RT_TextHeaderAtom
      if (rec.type === 3998 && rec.len >= 4) {
        state.currentTextType = view.getUint32(rec.start, true);
      }

      // 4000: RT_TextCharsAtom (UTF-16LE)
      if (rec.type === 4000 && rec.len > 0) {
        const textBytes = pptDocBuf!.subarray(rec.start, rec.end);
        const text = new TextDecoder("utf-16le").decode(textBytes).trim();
        if (text) {
          if (!state.currentSlide) state.currentSlide = { title: "", bullets: [], rawTexts: [] };
          state.currentSlide.rawTexts.push(text);

          if ((state.currentTextType === 0 || state.currentTextType === 6 || !state.currentSlide.title) && text.length < 140) {
            if (!state.currentSlide.title) {
              state.currentSlide.title = text;
            } else {
              state.currentSlide.bullets.push({ text });
            }
          } else {
            const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
            for (const line of lines) {
              state.currentSlide.bullets.push({ text: line });
            }
          }
        }
      }

      // 4008: RT_TextBytesAtom (Latin1/ASCII)
      if (rec.type === 4008 && rec.len > 0) {
        const textBytes = pptDocBuf!.subarray(rec.start, rec.end);
        const text = new TextDecoder("latin1").decode(textBytes).trim();
        if (text) {
          if (!state.currentSlide) state.currentSlide = { title: "", bullets: [], rawTexts: [] };
          state.currentSlide.rawTexts.push(text);

          if ((state.currentTextType === 0 || state.currentTextType === 6 || !state.currentSlide.title) && text.length < 140) {
            if (!state.currentSlide.title) {
              state.currentSlide.title = text;
            } else {
              state.currentSlide.bullets.push({ text });
            }
          } else {
            const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
            for (const line of lines) {
              state.currentSlide.bullets.push({ text: line });
            }
          }
        }
      }

      // Recurse inside container records
      if (rec.isContainer && rec.len > 0) {
        walk(rec.start, rec.end);
      }

      pos = rec.end;
    }
  }

  walk(0, pptDocBuf.length);
  if (state.currentSlide && (state.currentSlide.title || state.currentSlide.bullets.length > 0 || state.currentSlide.rawTexts.length > 0)) {
    slideListSlides.push(state.currentSlide);
  }

  // Scan PowerPoint Document buffer for images if none found in Pictures stream
  if (extractedImages.length === 0) {
    extractedImages.push(...extractImagesFromBuffer(pptDocBuf));
  }

  const finalSlides: SlideData[] = [];
  const slideCount = Math.max(slideListSlides.length, 1);

  for (let idx = 0; idx < slideCount; idx++) {
    const sData = slideListSlides[idx];
    const title = sData?.title || sData?.rawTexts?.[0] || `Slide ${idx + 1}`;
    const bullets = sData?.bullets?.filter((b) => b.text !== title) || [];

    const slideImages: string[] = [];
    if (extractedImages.length > 0) {
      if (slideCount === 1) {
        slideImages.push(...extractedImages);
      } else {
        const imgIdx = idx % extractedImages.length;
        if (extractedImages[imgIdx]) slideImages.push(extractedImages[imgIdx]);
      }
    }

    finalSlides.push({
      index: idx + 1,
      title,
      bullets,
      images: slideImages,
      tables: [],
      backgroundColor: "#FFFFFF",
      defaultTextColor: "#0F172A",
      rawTexts: sData?.rawTexts || [],
    });
  }

  return finalSlides;
}

export function PowerPointConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [activeSlideIdx, setActiveSlideIdx] = useState<number>(0);
  const [themeMode, setThemeMode] = useState<
    "preserve" | "modern-dark" | "clean-light" | "corporate-blue" | "slate-minimal"
  >("preserve");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "4:3">("16:9");
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const slidesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file) {
      setSlides([]);
      setActiveSlideIdx(0);
      setMessage("");
      setError("");
      return;
    }

    const parsePresentation = async () => {
      setBusy(true);
      setProgressText("Detecting presentation file format (.pptx or .ppt)…");
      setError("");
      setMessage("");

      try {
        const buffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(buffer.slice(0, 4));

        // Check format: ZIP-based modern .pptx (0x50 0x4B) vs Legacy binary .ppt (0xD0 0xCF)
        const isZip = uint8[0] === 0x50 && uint8[1] === 0x4b;
        const isLegacyBinary = uint8[0] === 0xd0 && uint8[1] === 0xcf;

        if (isLegacyBinary) {
          setProgressText("Parsing legacy binary .ppt presentation, slides, text & pictures…");
          const binarySlides = parseBinaryPpt(buffer);
          setSlides(binarySlides);
          setActiveSlideIdx(0);
          const totalImg = binarySlides.reduce((acc, s) => acc + s.images.length, 0);
          setMessage(
            `✓ Successfully converted legacy binary .ppt with ${binarySlides.length} slides and ${totalImg} pictures!`
          );
          return;
        }

        if (!isZip) {
          // Fallback attempt with binary parser
          try {
            const fallbackSlides = parseBinaryPpt(buffer);
            if (fallbackSlides.length > 0) {
              setSlides(fallbackSlides);
              setActiveSlideIdx(0);
              setMessage(`✓ Loaded ${fallbackSlides.length} slides from .ppt file.`);
              return;
            }
          } catch {}
        }

        // Parse modern OpenXML .pptx
        setProgressText("Parsing presentation theme, color scheme, images and tables…");
        const zip = await JSZip.loadAsync(buffer);

        // 1. Parse Theme Color Scheme
        const themeMap = new Map<string, string>();
        try {
          const themeXml = await zip.file("ppt/theme/theme1.xml")?.async("string");
          if (themeXml) {
            const themeDoc = new DOMParser().parseFromString(themeXml, "application/xml");
            const clrScheme =
              themeDoc.getElementsByTagName("a:clrScheme")[0] ||
              themeDoc.getElementsByTagName("clrScheme")[0];
            if (clrScheme) {
              for (let i = 0; i < clrScheme.children.length; i++) {
                const child = clrScheme.children[i];
                const role = child.localName || child.tagName.replace(/^.*:/, "");
                const hex = extractColor(child, new Map());
                if (hex) {
                  themeMap.set(role, hex);
                }
              }
            }
          }
        } catch (e) {
          console.warn("Could not parse theme1.xml:", e);
        }

        if (!themeMap.has("lt1")) themeMap.set("lt1", "#FFFFFF");
        if (!themeMap.has("dk1")) themeMap.set("dk1", "#1E293B");
        if (!themeMap.has("bg1")) themeMap.set("bg1", themeMap.get("lt1") || "#FFFFFF");
        if (!themeMap.has("tx1")) themeMap.set("tx1", themeMap.get("dk1") || "#1E293B");
        if (!themeMap.has("accent1")) themeMap.set("accent1", "#2563EB");

        // 2. Resolve true slide order via ppt/presentation.xml & relationships
        let slideKeys: string[] = [];
        try {
          const presXml = await zip.file("ppt/presentation.xml")?.async("string");
          const presRelsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
          if (presXml && presRelsXml) {
            const presDoc = new DOMParser().parseFromString(presXml, "application/xml");
            const relsDoc = new DOMParser().parseFromString(presRelsXml, "application/xml");

            const relMap = new Map<string, string>();
            const relElems = Array.from(relsDoc.getElementsByTagName("Relationship"));
            for (const rel of relElems) {
              const id = getXmlAttr(rel, "Id");
              const target = getXmlAttr(rel, "Target");
              if (id && target) relMap.set(id, target);
            }

            const sldIds = Array.from(presDoc.getElementsByTagName("p:sldId")).concat(
              Array.from(presDoc.getElementsByTagName("sldId"))
            );

            for (const sld of sldIds) {
              const rId = getXmlAttr(sld, "id") || getXmlAttr(sld, "r:id");
              if (rId && relMap.has(rId)) {
                let target = relMap.get(rId)!;
                if (!target.startsWith("ppt/")) {
                  target = "ppt/" + target.replace(/^(\.\.\/)+/, "").replace(/^\//, "");
                }
                if (zip.file(target)) {
                  slideKeys.push(target);
                }
              }
            }
          }
        } catch (e) {
          console.warn("Could not read presentation.xml slide order, falling back to file names", e);
        }

        if (!slideKeys.length) {
          slideKeys = Object.keys(zip.files)
            .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
            .sort((a, b) => {
              const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
              const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
              return numA - numB;
            });
        }

        if (!slideKeys.length) {
          setError("No slides found in this presentation. Please ensure it is a valid .pptx or .ppt file.");
          return;
        }

        const parsedSlides: SlideData[] = [];

        for (let i = 0; i < slideKeys.length; i += 1) {
          const slideKey = slideKeys[i];
          const xmlText = await zip.file(slideKey)?.async("string");
          if (!xmlText) continue;

          // 3. Parse slide relationships to discover all images
          const relsPath = slideKey.replace(/ppt\/slides\/([^\/]+)$/, "ppt/slides/_rels/$1.rels");
          const slideRelsXml = await zip.file(relsPath)?.async("string");
          const slideImageMap = new Map<string, string>();

          if (slideRelsXml) {
            const relDoc = new DOMParser().parseFromString(slideRelsXml, "application/xml");
            const rels = Array.from(relDoc.getElementsByTagName("Relationship"));
            for (const r of rels) {
              const id = getXmlAttr(r, "Id");
              const target = getXmlAttr(r, "Target");
              const type = getXmlAttr(r, "Type") || "";
              if (
                id &&
                target &&
                (type.includes("image") || /\.(png|jpe?g|gif|webp|bmp|svg|tiff?)$/i.test(target))
              ) {
                let normalizedPath = target.replace(/^(\.\.\/)+/, "").replace(/^\//, "");
                if (!normalizedPath.startsWith("ppt/")) normalizedPath = "ppt/" + normalizedPath;
                slideImageMap.set(id, normalizedPath);
              }
            }
          }

          const doc = new DOMParser().parseFromString(xmlText, "application/xml");

          // 4. Extract Slide Background Color or Gradient
          let slideBgColor: string | undefined = undefined;
          let slideBgGradient: string | undefined = undefined;

          const bgElem =
            doc.getElementsByTagName("p:bg")[0] || doc.getElementsByTagName("bg")[0];
          if (bgElem) {
            const solidFill =
              bgElem.getElementsByTagName("a:solidFill")[0] ||
              bgElem.getElementsByTagName("solidFill")[0];
            if (solidFill) {
              slideBgColor = extractColor(solidFill, themeMap) || undefined;
            }

            const gradFill =
              bgElem.getElementsByTagName("a:gradFill")[0] ||
              bgElem.getElementsByTagName("gradFill")[0];
            if (gradFill) {
              const gsList = Array.from(gradFill.getElementsByTagName("a:gs")).concat(
                Array.from(gradFill.getElementsByTagName("gs"))
              );
              const stops = gsList.map((gs) => {
                const pos = Number(getXmlAttr(gs, "pos") || "0") / 1000;
                const c = extractColor(gs, themeMap) || "#ffffff";
                return `${c} ${pos}%`;
              });
              if (stops.length >= 2) {
                slideBgGradient = `linear-gradient(135deg, ${stops.join(", ")})`;
              }
            }
          }

          // Fallback master background
          if (!slideBgColor && !slideBgGradient) {
            try {
              const masterXml = await zip.file("ppt/slideMasters/slideMaster1.xml")?.async("string");
              if (masterXml) {
                const masterDoc = new DOMParser().parseFromString(masterXml, "application/xml");
                const mBg =
                  masterDoc.getElementsByTagName("p:bg")[0] ||
                  masterDoc.getElementsByTagName("bg")[0];
                if (mBg) {
                  const sFill =
                    mBg.getElementsByTagName("a:solidFill")[0] ||
                    mBg.getElementsByTagName("solidFill")[0];
                  if (sFill) {
                    slideBgColor = extractColor(sFill, themeMap) || undefined;
                  }
                }
              }
            } catch {}
          }

          // 5. Extract ALL embedded slide pictures
          const slideImages: string[] = [];
          const blips = Array.from(doc.getElementsByTagName("a:blip")).concat(
            Array.from(doc.getElementsByTagName("blip"))
          );

          for (const blip of blips) {
            const rId =
              getXmlAttr(blip, "embed") ||
              getXmlAttr(blip, "link") ||
              getXmlAttr(blip, "r:embed") ||
              getXmlAttr(blip, "r:link");

            if (rId && slideImageMap.has(rId)) {
              const imgPath = slideImageMap.get(rId)!;
              const imgFile = zip.file(imgPath);
              if (imgFile) {
                const base64 = await imgFile.async("base64");
                const ext = imgPath.split(".").pop()?.toLowerCase() || "jpeg";
                const mime =
                  ext === "png"
                    ? "image/png"
                    : ext === "svg"
                    ? "image/svg+xml"
                    : ext === "gif"
                    ? "image/gif"
                    : ext === "webp"
                    ? "image/webp"
                    : "image/jpeg";
                const dataUrl = `data:${mime};base64,${base64}`;
                if (!slideImages.includes(dataUrl)) {
                  slideImages.push(dataUrl);
                }
              }
            }
          }

          // 6. Extract Complete Tables with Full Rows, Cell Colors, and Formats
          const slideTables: SlideTable[] = [];
          const tblElements = Array.from(doc.getElementsByTagName("a:tbl")).concat(
            Array.from(doc.getElementsByTagName("tbl"))
          );

          for (const tbl of tblElements) {
            const colWidths: number[] = [];
            const gridCols = Array.from(tbl.getElementsByTagName("a:gridCol")).concat(
              Array.from(tbl.getElementsByTagName("gridCol"))
            );
            const totalWidth = gridCols.reduce(
              (acc, c) => acc + Number(getXmlAttr(c, "w") || 0),
              0
            );
            if (totalWidth > 0) {
              for (const c of gridCols) {
                colWidths.push(Math.round((Number(getXmlAttr(c, "w") || 0) / totalWidth) * 100));
              }
            }

            const tableRows: SlideTableCell[][] = [];
            const trElems = Array.from(tbl.getElementsByTagName("a:tr")).concat(
              Array.from(tbl.getElementsByTagName("tr"))
            );

            for (const tr of trElems) {
              const row: SlideTableCell[] = [];
              const tcElems = Array.from(tr.getElementsByTagName("a:tc")).concat(
                Array.from(tr.getElementsByTagName("tc"))
              );

              for (const tc of tcElems) {
                const tcPr =
                  tc.getElementsByTagName("a:tcPr")[0] || tc.getElementsByTagName("tcPr")[0];
                let cellBgColor: string | undefined = undefined;
                if (tcPr) {
                  const sFill =
                    tcPr.getElementsByTagName("a:solidFill")[0] ||
                    tcPr.getElementsByTagName("solidFill")[0];
                  if (sFill) {
                    cellBgColor = extractColor(sFill, themeMap) || undefined;
                  }
                }

                const pElems = Array.from(tc.getElementsByTagName("a:p")).concat(
                  Array.from(tc.getElementsByTagName("p"))
                );
                let cellText = "";
                let cellTextColor: string | undefined = undefined;
                let cellBold = false;
                let cellAlign: "left" | "center" | "right" = "left";

                for (const p of pElems) {
                  const pPr =
                    p.getElementsByTagName("a:pPr")[0] || p.getElementsByTagName("pPr")[0];
                  if (pPr) {
                    const algn = getXmlAttr(pPr, "algn");
                    if (algn === "ctr") cellAlign = "center";
                    else if (algn === "r") cellAlign = "right";
                  }

                  const rElems = Array.from(p.getElementsByTagName("a:r")).concat(
                    Array.from(p.getElementsByTagName("r"))
                  );
                  for (const r of rElems) {
                    const rPr =
                      r.getElementsByTagName("a:rPr")[0] || r.getElementsByTagName("rPr")[0];
                    if (rPr) {
                      if (getXmlAttr(rPr, "b") === "1") cellBold = true;
                      const rFill =
                        rPr.getElementsByTagName("a:solidFill")[0] ||
                        rPr.getElementsByTagName("solidFill")[0];
                      if (rFill && !cellTextColor) {
                        cellTextColor = extractColor(rFill, themeMap) || undefined;
                      }
                    }
                    const t =
                      r.getElementsByTagName("a:t")[0]?.textContent ||
                      r.getElementsByTagName("t")[0]?.textContent ||
                      "";
                    cellText += t;
                  }
                }

                if (!cellText.trim()) {
                  const tNodes = Array.from(tc.getElementsByTagName("a:t")).concat(
                    Array.from(tc.getElementsByTagName("t"))
                  );
                  cellText = tNodes.map((n) => n.textContent?.trim()).filter(Boolean).join(" ");
                }

                row.push({
                  text: cellText.trim(),
                  bgColor: cellBgColor,
                  textColor: cellTextColor,
                  isBold: cellBold,
                  align: cellAlign,
                });
              }

              if (row.length > 0) tableRows.push(row);
            }

            if (tableRows.length > 0) {
              const headers = tableRows[0];
              const dataRows = tableRows.slice(1);
              slideTables.push({
                headers,
                rows: dataRows,
                colWidths: colWidths.length === headers.length ? colWidths : undefined,
              });
            }
          }

          // 7. Extract Titles, Subtitles, Text Colors, and Bullet Hierarchy
          let title = "";
          let titleColor: string | undefined = undefined;
          let subtitle = "";
          let subtitleColor: string | undefined = undefined;
          const bullets: SlideItemText[] = [];
          const rawTexts: string[] = [];

          const shapes = Array.from(doc.getElementsByTagName("p:sp"))
            .concat(Array.from(doc.getElementsByTagName("sp")))
            .concat(Array.from(doc.getElementsByTagName("p:cxnSp")));

          for (const sp of shapes) {
            const phElements = Array.from(sp.getElementsByTagName("p:ph")).concat(
              Array.from(sp.getElementsByTagName("ph"))
            );
            const ph = phElements[0];
            const phType = getXmlAttr(ph, "type") || "";

            const pElements = Array.from(sp.getElementsByTagName("a:p")).concat(
              Array.from(sp.getElementsByTagName("p"))
            );

            for (const p of pElements) {
              let pText = "";
              let pColor: string | undefined = undefined;
              let pBold = false;

              const rElems = Array.from(p.getElementsByTagName("a:r")).concat(
                Array.from(p.getElementsByTagName("r"))
              );

              for (const r of rElems) {
                const rPr =
                  r.getElementsByTagName("a:rPr")[0] || r.getElementsByTagName("rPr")[0];
                if (rPr) {
                  if (getXmlAttr(rPr, "b") === "1") pBold = true;
                  const sFill =
                    rPr.getElementsByTagName("a:solidFill")[0] ||
                    rPr.getElementsByTagName("solidFill")[0];
                  if (sFill && !pColor) {
                    pColor = extractColor(sFill, themeMap) || undefined;
                  }
                }
                const t =
                  r.getElementsByTagName("a:t")[0]?.textContent ||
                  r.getElementsByTagName("t")[0]?.textContent ||
                  "";
                pText += t;
              }

              if (!pText.trim()) {
                const tNodes = Array.from(p.getElementsByTagName("a:t")).concat(
                  Array.from(p.getElementsByTagName("t"))
                );
                pText = tNodes.map((n) => n.textContent || "").join("");
              }

              const cleanedText = pText.trim();
              if (!cleanedText) continue;
              rawTexts.push(cleanedText);

              if (
                (phType === "title" || phType === "ctrTitle" || (!title && phType === "")) &&
                cleanedText.length < 160 &&
                !title
              ) {
                title = cleanedText;
                titleColor = pColor;
                continue;
              }

              if (phType === "subTitle" && !subtitle) {
                subtitle = cleanedText;
                subtitleColor = pColor;
                continue;
              }

              if (cleanedText !== title && cleanedText !== subtitle) {
                bullets.push({
                  text: cleanedText,
                  color: pColor,
                  isBold: pBold,
                });
              }
            }
          }

          if (!title && rawTexts.length > 0) {
            title = rawTexts.find((t) => t.length < 120) || rawTexts[0];
          }

          parsedSlides.push({
            index: i + 1,
            title: title || `Slide ${i + 1}`,
            titleColor,
            subtitle: subtitle || undefined,
            subtitleColor,
            bullets: bullets.length > 0 ? bullets : rawTexts.filter((t) => t !== title).map((t) => ({ text: t })),
            images: slideImages,
            tables: slideTables,
            backgroundColor: slideBgColor,
            backgroundGradient: slideBgGradient,
            defaultTextColor: slideBgColor && slideBgColor.toLowerCase() === "#000000" ? "#FFFFFF" : undefined,
            rawTexts,
          });
        }

        setSlides(parsedSlides);
        setActiveSlideIdx(0);
        const totalImages = parsedSlides.reduce((acc, s) => acc + s.images.length, 0);
        const totalTables = parsedSlides.reduce((acc, s) => acc + s.tables.length, 0);
        setMessage(
          `✓ Loaded ${parsedSlides.length} slides with ${totalImages} ${
            totalImages === 1 ? "picture" : "pictures"
          }, ${totalTables} ${totalTables === 1 ? "table" : "tables"}, and original slide colors preserved!`
        );
      } catch (err) {
        console.error("PowerPoint parse error:", err);
        setError(
          "Failed to parse PowerPoint presentation. Please ensure the file is not corrupted."
        );
      } finally {
        setBusy(false);
        setProgressText("");
      }
    };

    void parsePresentation();
  }, [file]);

  const handleConvert = async () => {
    if (!file || !slidesContainerRef.current) return;

    setBusy(true);
    setError("");
    setMessage("");
    setProgressText("Rendering high-definition widescreen presentation slides…");

    try {
      const imgElements = Array.from(
        slidesContainerRef.current.querySelectorAll<HTMLImageElement>("img")
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
      await new Promise((r) => setTimeout(r, 80));

      const container = slidesContainerRef.current;
      const slideElements = Array.from(
        container.querySelectorAll<HTMLElement>(".ppt-slide-card")
      );
      const elementsToRender = slideElements.length > 0 ? slideElements : [container];

      await convertElementsToPdf(elementsToRender, {
        fileName: file.name,
        orientation: "landscape",
        onePagePerElement: true,
        onProgress: setProgressText,
      });

      setMessage(
        `✓ Downloaded "${file.name.replace(/\.[^.]+$/, "")}.pdf" (${slideElements.length} slides) in exact widescreen presentation format!`
      );
    } catch (err) {
      console.error("PowerPoint conversion error:", err);
      setError("An error occurred while generating the PDF slides.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  const handlePrint = () => {
    const styleId = "ppt-print-orientation-style";
    let styleTag = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = `@page { size: landscape; margin: 0; }`;
    window.print();
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
            accept=".pptx,.ppt"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <span className="upload-icon">▤</span>
          <strong>Drop PowerPoint presentation here</strong>
          <span className="upload-hint">
            or click to browse · Supports all .pptx and legacy .ppt files · Preserves pictures, colors & tables
          </span>
        </label>
      )}

      {file && (
        <div className="loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{file.name}</strong>
              <span className="page-count">
                {(file.size / 1024 / 1024).toFixed(2)} MB · {slides.length}{" "}
                {slides.length === 1 ? "slide" : "slides"}
              </span>
            </div>
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                setFile(null);
                setSlides([]);
                setMessage("");
                setError("");
              }}
              disabled={busy}
            >
              Choose another file
            </button>
          </div>

          <div className="word-fidelity-banner">
            <span className="fidelity-badge">✦ Universal Presentation Engine</span>
            <span>
              Supports both modern .pptx and legacy .ppt formats. Extracting pictures, presentation colors, fonts, and tables into widescreen PDF pages.
            </span>
          </div>

          {/* Controls */}
          <div className="advanced-toolbar" style={{ marginTop: 12, flexWrap: "wrap", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              Theme:
              <select
                value={themeMode}
                onChange={(e) => setThemeMode(e.target.value as any)}
                disabled={busy}
              >
                <option value="preserve">Preserve Presentation Colors (Original)</option>
                <option value="modern-dark">Modern Dark (Sleek Indigo)</option>
                <option value="clean-light">Clean Light (Minimalist White)</option>
                <option value="corporate-blue">Corporate Navy & Gold</option>
                <option value="slate-minimal">Slate Minimal</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              Aspect Ratio:
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as any)}
                disabled={busy}
              >
                <option value="16:9">16:9 Widescreen (Modern Standard)</option>
                <option value="4:3">4:3 Standard</option>
              </select>
            </label>

            {slides.length > 1 && (
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
                Jump to slide:
                <select
                  style={{ marginLeft: 6 }}
                  value={activeSlideIdx}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    setActiveSlideIdx(idx);
                    const el = document.getElementById(`slide-card-${idx}`);
                    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }}
                  disabled={busy}
                >
                  {slides.map((s, idx) => (
                    <option key={idx} value={idx}>
                      Slide {s.index}: {s.title.slice(0, 30)}...
                    </option>
                  ))}
                </select>
              </span>
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
              disabled={busy || slides.length === 0}
            >
              {busy ? "Generating PDF Slides…" : "Convert & download PDF ↓"}
            </button>

            <button
              type="button"
              className="download-button secondary print-button"
              onClick={handlePrint}
              disabled={busy || slides.length === 0}
              title="Print or save as vector PDF using browser print dialog"
            >
              Save as PDF (Vector Print) 🖨
            </button>
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          {/* Slide Deck Preview Area */}
          {slides.length > 0 && (
            <div className="docx-preview-section">
              <div className="docx-preview-header">
                <span className="docx-preview-title">
                  Presentation Slide Deck ({slides.length} slides)
                </span>
                <span className="docx-preview-hint">
                  Rendered with original pictures, slide colors & full table data
                </span>
              </div>

              <div className="docx-desk-wrapper">
                <div ref={slidesContainerRef} className="ppt-deck-container">
                  {slides.map((slide, sIdx) => {
                    const hasImages = slide.images.length > 0;
                    const hasTables = slide.tables.length > 0;
                    const hasBullets = slide.bullets.length > 0;
                    const isSplit = (hasImages || hasTables) && hasBullets;

                    const isCustomTheme = themeMode === "preserve";
                    const cardStyle: React.CSSProperties = {};
                    if (isCustomTheme) {
                      if (slide.backgroundGradient) {
                        cardStyle.background = slide.backgroundGradient;
                      } else if (slide.backgroundColor) {
                        cardStyle.backgroundColor = slide.backgroundColor;
                      } else {
                        cardStyle.backgroundColor = "#FFFFFF";
                      }
                      const isDark =
                        slide.backgroundColor &&
                        /^#(?:0[0-9a-f]{5}|1[0-9a-f]{5}|2[0-9a-f]{5})/i.test(slide.backgroundColor);
                      cardStyle.color = isDark ? "#F8FAFC" : "#0F172A";
                    }

                    return (
                      <div
                        key={slide.index}
                        id={`slide-card-${sIdx}`}
                        style={cardStyle}
                        className={`ppt-slide-card ${
                          isCustomTheme ? "theme-custom" : `theme-${themeMode}`
                        } ratio-${aspectRatio.replace(":", "-")}`}
                      >
                        <div className="ppt-slide-header">
                          <span
                            className="ppt-slide-badge"
                            style={
                              isCustomTheme
                                ? { background: "rgba(100, 116, 139, 0.15)", color: "inherit" }
                                : undefined
                            }
                          >
                            Slide {slide.index} of {slides.length}
                          </span>
                          <span className="ppt-slide-branding">SimplyPDF Deck</span>
                        </div>

                        <div className="ppt-slide-body">
                          <h2
                            className="ppt-slide-title"
                            style={slide.titleColor ? { color: slide.titleColor } : undefined}
                          >
                            {slide.title}
                          </h2>
                          {slide.subtitle && (
                            <p
                              className="ppt-slide-subtitle"
                              style={
                                slide.subtitleColor ? { color: slide.subtitleColor } : undefined
                              }
                            >
                              {slide.subtitle}
                            </p>
                          )}

                          <div
                            className={`ppt-slide-content-split ${
                              isSplit ? "" : "full-width"
                            }`}
                          >
                            {/* Left or Main: Bullets & Paragraphs */}
                            {hasBullets ? (
                              <ul className="ppt-bullet-list">
                                {slide.bullets.map((b, bIdx) => (
                                  <li
                                    key={bIdx}
                                    className="ppt-bullet-item"
                                    style={b.color ? { color: b.color } : undefined}
                                  >
                                    {b.isBold ? <strong>{b.text}</strong> : b.text}
                                  </li>
                                ))}
                              </ul>
                            ) : !hasImages && !hasTables ? (
                              <p className="ppt-empty-slide-note">
                                (Title or section divider slide)
                              </p>
                            ) : null}

                            {/* Right or Main: Pictures & Tables */}
                            {(hasImages || hasTables) && (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 16,
                                  width: "100%",
                                  overflow: "hidden",
                                }}
                              >
                                {hasImages && (
                                  <div className="ppt-slide-images-grid">
                                    {slide.images.map((imgUrl, imgIdx) => (
                                      <div key={imgIdx} className="ppt-slide-img-wrap">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={imgUrl}
                                          alt={`Slide ${slide.index} graphic ${imgIdx + 1}`}
                                          className="ppt-slide-img"
                                          loading="eager"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {hasTables &&
                                  slide.tables.map((tbl, tIdx) => (
                                    <table key={tIdx} className="ppt-slide-table">
                                      <thead>
                                        <tr>
                                          {tbl.headers.map((h, hIdx) => (
                                            <th
                                              key={hIdx}
                                              style={{
                                                width: tbl.colWidths
                                                  ? `${tbl.colWidths[hIdx]}%`
                                                  : undefined,
                                                backgroundColor: h.bgColor || undefined,
                                                color: h.textColor || undefined,
                                                textAlign: h.align || "left",
                                              }}
                                            >
                                              {h.text}
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {tbl.rows.map((r, rIdx) => (
                                          <tr key={rIdx}>
                                            {r.map((c, cIdx) => (
                                              <td
                                                key={cIdx}
                                                style={{
                                                  backgroundColor: c.bgColor || undefined,
                                                  color: c.textColor || undefined,
                                                  textAlign: c.align || "left",
                                                  fontWeight: c.isBold ? 700 : "normal",
                                                }}
                                              >
                                                {c.text}
                                              </td>
                                            ))}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="ppt-slide-footer">
                          <span>{file.name}</span>
                          <span>Page {slide.index}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
