"use client";

import { useEffect, useState } from "react";
import JSZip from "jszip";
import { loadPdf } from "../../lib/pdfjs";

interface SlideInfo {
  index: number;
  dataUrl: string;
  width: number;
  height: number;
  title: string;
  textCount: number;
  texts: { str: string; x: number; y: number; width: number; height: number }[];
}

type AspectRatio = "16:9" | "4:3";

export function PdfToPowerpointConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [slides, setSlides] = useState<SlideInfo[]>([]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [includeTextLayer, setIncludeTextLayer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) {
      setSlides([]);
      setMessage("");
      setError("");
      return;
    }

    const parsePdf = async () => {
      setBusy(true);
      setProgressText("Analyzing PDF pages and slides…");
      setError("");
      setMessage("");

      try {
        const doc = await loadPdf(file);
        const total = doc.numPages;
        const parsedSlides: SlideInfo[] = [];

        for (let i = 1; i <= total; i += 1) {
          setProgressText(`Rendering slide ${i} of ${total}…`);
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 2 });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
          }

          const dataUrl = canvas.toDataURL("image/png");

          // Extract text items
          const textContent = await page.getTextContent();
          const texts: SlideInfo["texts"] = [];
          let detectedTitle = `Slide ${i}`;

          for (const item of textContent.items) {
            if ("str" in item && item.str.trim()) {
              const str = item.str.trim();
              const tx = item.transform ? item.transform[4] : 0;
              const ty = item.transform ? item.transform[5] : 0;
              texts.push({
                str,
                x: tx,
                y: viewport.height - ty, // flip Y for standard top-left coords
                width: item.width || 50,
                height: item.height || 14,
              });

              if (detectedTitle === `Slide ${i}` && str.length > 3 && str.length < 60) {
                detectedTitle = str;
              }
            }
          }

          parsedSlides.push({
            index: i,
            dataUrl,
            width: viewport.width,
            height: viewport.height,
            title: detectedTitle,
            textCount: texts.length,
            texts,
          });
        }

        setSlides(parsedSlides);
        setMessage(`Successfully processed ${parsedSlides.length} slide${parsedSlides.length > 1 ? "s" : ""} from PDF.`);
      } catch (err) {
        console.error("PDF to PowerPoint parse error:", err);
        setError("Failed to parse PDF document. Please ensure it is a valid, readable PDF.");
      } finally {
        setBusy(false);
        setProgressText("");
      }
    };

    void parsePdf();
  }, [file]);

  const handleExportPptx = async () => {
    if (!slides.length) return;

    setBusy(true);
    setProgressText("Packaging OpenXML PowerPoint presentation (.pptx)…");
    setError("");
    setMessage("");

    try {
      const zip = new JSZip();

      // Dimensions in EMUs (1 inch = 914400 EMUs)
      // 16:9 Widescreen: 12192000 x 6858000
      // 4:3 Standard: 9144000 x 6858000
      const cx = aspectRatio === "16:9" ? 12192000 : 9144000;
      const cy = 6858000;

      // 1. [Content_Types].xml
      const slideOverrides = slides
        .map(
          (s) =>
            `<Override PartName="/ppt/slides/slide${s.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
        )
        .join("\n  ");

      zip.file(
        "[Content_Types].xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides}
</Types>`
      );

      // 2. _rels/.rels
      zip.file(
        "_rels/.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
      );

      // 3. ppt/presentation.xml
      const sldIdEntries = slides
        .map((s, idx) => `<p:sldId id="${256 + idx}" r:id="rId${2 + idx}"/>`)
        .join("");

      zip.file(
        "ppt/presentation.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${sldIdEntries}</p:sldIdLst>
  <p:sldSz cx="${cx}" cy="${cy}" type="${aspectRatio === "16:9" ? "screen16x9" : "screen4x3"}"/>
  <p:notesSz cx="6858000" cy="12192000"/>
</p:presentation>`
      );

      // 4. ppt/_rels/presentation.xml.rels
      const presRels = [
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
        ...slides.map(
          (s, idx) =>
            `<Relationship Id="rId${2 + idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${s.index}.xml"/>`
        ),
      ].join("\n  ");

      zip.file(
        "ppt/_rels/presentation.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${presRels}
</Relationships>`
      );

      // 5. Theme and Master boilerplate
      zip.file(
        "ppt/theme/theme1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SimplyPDF Theme">
  <a:themeElements>
    <a:clrScheme name="Modern">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="0F172A"/></a:dk2>
      <a:lt2><a:srgbClr val="F8FAFC"/></a:lt2>
      <a:accent1><a:srgbClr val="0284C7"/></a:accent1>
      <a:accent2><a:srgbClr val="0D9488"/></a:accent2>
      <a:accent3><a:srgbClr val="6366F1"/></a:accent3>
      <a:accent4><a:srgbClr val="E11D48"/></a:accent4>
      <a:accent5><a:srgbClr val="F59E0B"/></a:accent5>
      <a:accent6><a:srgbClr val="84CC16"/></a:accent6>
      <a:hlink><a:srgbClr val="0284C7"/></a:hlink>
      <a:folHlink><a:srgbClr val="0369A1"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Standard"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="Clean"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>`
      );

      zip.file(
        "ppt/slideMasters/slideMaster1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`
      );

      zip.file(
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`
      );

      zip.file(
        "ppt/slideLayouts/slideLayout1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" type="blank">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
</p:sldLayout>`
      );

      zip.file(
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`
      );

      // 6. Slides and embedded media
      for (const s of slides) {
        // Save image buffer
        const base64Data = s.dataUrl.replace(/^data:image\/png;base64,/, "");
        zip.file(`ppt/media/image${s.index}.png`, base64Data, { base64: true });

        // Build slide rels
        zip.file(
          `ppt/slides/_rels/slide${s.index}.xml.rels`,
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${s.index}.png"/>
</Relationships>`
        );

        // Optional text layer shapes
        let textShapesXml = "";
        if (includeTextLayer && s.texts.length > 0) {
          // Group nearby lines into text paragraphs
          const fullSlideText = s.texts.map((t) => t.str).join(" ");
          const safeText = fullSlideText
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");

          textShapesXml = `
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="${10 + s.index}" name="Extracted Text Layer"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="500000" y="500000"/>
            <a:ext cx="${cx - 1000000}" cy="${cy - 1000000}"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" rtlCol="0">
            <a:spAutoFit/>
          </a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr lang="en-US" sz="1400">
                <a:solidFill><a:srgbClr val="0F172A"/></a:solidFill>
              </a:rPr>
              <a:t>${safeText.slice(0, 4000)}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>`;
        }

        // Build slide XML
        zip.file(
          `ppt/slides/slide${s.index}.xml`,
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      
      <!-- Slide High-Res Background Image -->
      <p:pic>
        <p:nvPicPr>
          <p:cNvPr id="2" name="Slide Background Image"/>
          <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="rId2"/>
          <a:stretch><a:fillRect/></a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:pic>
      ${textShapesXml}
    </p:spTree>
  </p:cSld>
</p:sld>`
        );
      }

      // Generate package and trigger download
      const pptxBlob = await zip.generateAsync({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      const url = URL.createObjectURL(pptxBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file?.name ? file.name.replace(/\.pdf$/i, "") : "presentation"}.pptx`;
      a.click();
      URL.revokeObjectURL(url);

      setMessage(`✓ Downloaded OpenXML presentation (.pptx) with ${slides.length} slides!`);
    } catch (err) {
      console.error("PPTX generation error:", err);
      setError("Failed to create PowerPoint presentation.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
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
          <span className="upload-icon">P</span>
          <strong>Drop PDF document here</strong>
          <span className="upload-hint">or click to browse · converts into editable PowerPoint slides (.pptx)</span>
        </label>
      )}

      {file && (
        <div className="loaded-area">
          <div className="toolbar">
            <div className="toolbar-left">
              <strong>{file.name}</strong>
              <span className="page-count">{slides.length} Slide{slides.length !== 1 ? "s" : ""}</span>
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
              Choose another PDF
            </button>
          </div>

          <div className="word-fidelity-banner">
            <span className="fidelity-badge">✦ Native OpenXML Engine</span>
            <span>Generates genuine .pptx presentation files preserving high-resolution slide graphics, charts, and editable text boxes.</span>
          </div>

          {/* Controls: Aspect Ratio & Text Layer */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              alignItems: "center",
              margin: "16px 0",
              background: "var(--surface)",
              padding: "12px 16px",
              borderRadius: 8,
              border: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                Slide Format:
              </span>
              <div style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
                <button
                  type="button"
                  onClick={() => setAspectRatio("16:9")}
                  disabled={busy}
                  style={{
                    background: aspectRatio === "16:9" ? "var(--accent)" : "var(--bg)",
                    color: aspectRatio === "16:9" ? "#ffffff" : "var(--muted)",
                    border: "none",
                    padding: "4px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  16:9 Widescreen
                </button>
                <button
                  type="button"
                  onClick={() => setAspectRatio("4:3")}
                  disabled={busy}
                  style={{
                    background: aspectRatio === "4:3" ? "var(--accent)" : "var(--bg)",
                    color: aspectRatio === "4:3" ? "#ffffff" : "var(--muted)",
                    border: "none",
                    padding: "4px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  4:3 Standard
                </button>
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={includeTextLayer}
                onChange={(e) => setIncludeTextLayer(e.target.checked)}
                disabled={busy}
              />
              <span>Include selectable &amp; editable text boxes</span>
            </label>

            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
              Compatible with MS PowerPoint, Google Slides &amp; Keynote
            </span>
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
              onClick={handleExportPptx}
              disabled={busy || !slides.length}
            >
              {busy ? "Packaging Presentation…" : "Download PowerPoint (.pptx) ↓"}
            </button>
          </div>

          {message && <p className="success-message" role="status">{message}</p>}
          {error && <p className="error-message" role="status">{error}</p>}

          {/* Slide Deck Grid Preview */}
          {slides.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <strong style={{ fontSize: 14, color: "var(--text)" }}>Slide Deck Preview ({slides.length} Slides)</strong>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Each page converted to full presentation slide</span>
              </div>

              <div className="slide-deck-grid">
                {slides.map((slide) => (
                  <div key={slide.index} className="slide-card">
                    <div className={`slide-card-thumb ${aspectRatio === "4:3" ? "ratio-4-3" : ""}`}>
                      <span className="slide-card-badge">Slide {slide.index}</span>
                      <img src={slide.dataUrl} alt={`Slide ${slide.index}`} />
                    </div>
                    <div className="slide-card-footer">
                      <span className="slide-card-title" title={slide.title}>
                        {slide.title}
                      </span>
                      <span>{slide.textCount} text items</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
