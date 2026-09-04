"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const links = [
    { href: "/merge", label: "Merge PDF", icon: "▦" },
    { href: "/split", label: "Split PDF", icon: "✂" },
    
  ];
  const tools = [
    { id: "rotate", label: "Rotate pages", icon: "⟳" },
    { id: "delete", label: "Delete pages", icon: "×" },
    { id: "insert", label: "Insert blank pages", icon: "＋" },
    { id: "reverse", label: "Reverse page order", icon: "⇅" },
    { id: "extract", label: "Extract pages", icon: "⇥" },
    { id: "interleave", label: "Interleave PDFs", icon: "≋" },
    { id: "n-up", label: "N-up layouts", icon: "⊞" },
    { id: "booklet", label: "Booklet formatting", icon: "▤" }
  ];
  const fromPdf = [
    ["office", "PDF to Office", "W"], ["images", "PDF to Images", "▧"], ["text", "PDF to Text / Markdown", "T"], ["html", "PDF to HTML", "<>"], ["pdfa", "PDF to PDF/A", "A"]
  ];
  const editTools = [
    ["edit", "Edit text & images", "✎"], ["annotate", "Annotate & draw", "✦"], ["headers", "Headers & footers", "H"], ["numbers", "Page numbers", "#"], ["stamps", "Add stamps", "S"], ["colors", "Replace colors", "◐"], ["compare", "Compare PDFs", "⇄"]
  ];
  const secureTools = [
    ["password", "Add / remove password", "⌑"], ["permissions", "Manage permissions", "⚿"], ["redact", "Redact content", "■"], ["sanitize", "Sanitize metadata", "⌫"], ["sign", "Sign PDF", "✓"], ["certificate", "Digital certificates", "◆"], ["watermark", "Watermark", "◇"]
  ];
  const optimizeTools = [
    ["compress", "Compress PDF", "↓"], ["ocr", "OCR scanned PDF", "◎"], ["repair", "Repair PDF", "⌁"], ["flatten", "Flatten PDF", "▰"], ["linearize", "Web optimize", "↝"], ["assets", "Extract assets", "⇩"]
  ];
  const selectTool = (tool: string) => {
    if (pathname !== "/organize") {
      router.push(`/organize#${tool}`);
    } else {
      window.dispatchEvent(new CustomEvent("organize-tool", { detail: tool }));
    }
  };
  return (
    <aside className="sidebar">
      <Link href="/merge" className="brand"><span className="brand-mark">▤</span><span>Simply<span className="brand-accent">PDF</span></span></Link>
      <div className="privacy-badge"><span className="status-dot" /> Your files stay private</div>
      <nav>
        <p className="nav-heading">Organize</p>
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={`nav-link ${pathname === link.href ? "active" : ""}`}>
            <span className="nav-icon">{link.icon}</span>{link.label}
          </Link>
        ))}
        <div className="organize-tools" aria-label="Organize tools">
          <button className="nav-link tool-link" onClick={() => selectTool("organize")}>
            <span className="nav-icon">↕</span>Organize PDF
          </button>
          {tools.map((tool) => (
            <button key={tool.id} className="nav-link tool-link" onClick={() => selectTool(tool.id)}>
              <span className="nav-icon">{tool.icon}</span>{tool.label}
            </button>
          ))}
        </div>
        <p className="nav-heading convert-heading">Convert to PDF</p>
        {[
          ["word", "Word to PDF", "W"],
          ["excel", "Excel to PDF", "X"],
          ["powerpoint", "PowerPoint to PDF", "P"],
          ["images", "Images to PDF", "▧"],
          ["text", "Text to PDF", "T"],
          ["html", "HTML to PDF", "<>"],
          ["markdown", "Markdown to PDF", "M"],
          ["audio", "Audio to PDF", "♫"]
        ].map(([id, label, icon]) => (
          <Link key={id} href={`/convert/${id}`} className={`nav-link ${pathname === `/convert/${id}` ? "active" : ""}`}>
            <span className="nav-icon">{icon}</span>{label}
          </Link>
        ))}
        <p className="nav-heading tool-heading">Convert from PDF</p>
        {fromPdf.map(([id, label, icon]) => <Link key={id} href={`/from-pdf/${id}`} className={`nav-link ${pathname === `/from-pdf/${id}` ? "active" : ""}`}><span className="nav-icon">{icon}</span>{label}</Link>)}
        <p className="nav-heading tool-heading">Edit & modify</p>
        {editTools.map(([id, label, icon]) => <Link key={id} href={`/edit/${id}`} className={`nav-link ${pathname === `/edit/${id}` ? "active" : ""}`}><span className="nav-icon">{icon}</span>{label}</Link>)}
        <p className="nav-heading tool-heading">Secure & sign</p>
        {secureTools.map(([id, label, icon]) => <Link key={id} href={`/secure/${id}`} className={`nav-link ${pathname === `/secure/${id}` ? "active" : ""}`}><span className="nav-icon">{icon}</span>{label}</Link>)}
        <p className="nav-heading tool-heading">Optimize & repair</p>
        {optimizeTools.map(([id, label, icon]) => <Link key={id} href={`/optimize/${id}`} className={`nav-link ${pathname === `/optimize/${id}` ? "active" : ""}`}><span className="nav-icon">{icon}</span>{label}</Link>)}
      </nav>
      <div className="sidebar-bottom"><p className="sidebar-note">Files are processed locally<br />in your browser.</p></div>
    </aside>
  );
}
