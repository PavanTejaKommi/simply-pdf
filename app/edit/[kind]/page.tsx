import { notFound } from "next/navigation";
import { PdfToolWorkspace } from "../../../components/PdfToolWorkspace";
const kinds = ["edit", "annotate", "headers", "numbers", "stamps", "colors", "compare"] as const;
export default function Page({ params }: { params: { kind: string } }) { if (!kinds.includes(params.kind as (typeof kinds)[number])) notFound(); return <PdfToolWorkspace kind={params.kind as (typeof kinds)[number]} />; }