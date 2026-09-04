import { notFound } from "next/navigation";
import { PdfToolWorkspace } from "../../../components/PdfToolWorkspace";
const kinds = ["office", "images", "text", "html", "pdfa"] as const;
export default function Page({ params }: { params: { kind: string } }) { if (!kinds.includes(params.kind as (typeof kinds)[number])) notFound(); return <PdfToolWorkspace kind={params.kind as (typeof kinds)[number]} />; }