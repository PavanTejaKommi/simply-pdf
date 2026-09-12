import { notFound } from "next/navigation";
import { PdfToolWorkspace } from "../../../components/PdfToolWorkspace";
import { FlattenWorkspace } from "../../../components/FlattenWorkspace";

const kinds = ["compress", "ocr", "repair", "flatten", "linearize", "assets"] as const;
export default function Page({ params }: { params: { kind: string } }) {
  if (!kinds.includes(params.kind as (typeof kinds)[number])) notFound();
  if (params.kind === "flatten") return <FlattenWorkspace />;
  return <PdfToolWorkspace kind={params.kind as (typeof kinds)[number]} />;
}