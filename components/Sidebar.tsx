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
      </nav>
      <div className="sidebar-bottom"><p className="sidebar-note">Files are processed locally<br />in your browser.</p></div>
    </aside>
  );
}
