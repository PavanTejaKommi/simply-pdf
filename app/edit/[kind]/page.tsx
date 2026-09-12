import { notFound } from "next/navigation";
import { PdfToolWorkspace } from "../../../components/PdfToolWorkspace";
import { HeadersFootersWorkspace } from "../../../components/HeadersFootersWorkspace";
const kinds = ["edit", "annotate", "headers", "numbers", "stamps", "colors", "compare"] as const;
export default function Page({ params }: { params: { kind: string } }) {
  if (!kinds.includes(params.kind as (typeof kinds)[number])) notFound();
  if (params.kind === "headers") return <HeadersFootersWorkspace />;
  return <PdfToolWorkspace kind={params.kind as (typeof kinds)[number]} />;
}