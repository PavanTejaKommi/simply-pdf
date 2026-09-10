import { notFound } from "next/navigation";
import { PdfToolWorkspace } from "../../../components/PdfToolWorkspace";
import { FromPdfWorkspace, FromPdfKind } from "../../../components/from-pdf/FromPdfWorkspace";

const dedicatedKinds = ["word", "powerpoint", "excel", "audio"] as const;
const legacyKinds = ["office", "images", "text", "html", "pdfa"] as const;
const allKinds = [...dedicatedKinds, ...legacyKinds] as const;

export default function Page({ params }: { params: { kind: string } }) {
  if (!allKinds.includes(params.kind as (typeof allKinds)[number])) {
    notFound();
  }

  if (dedicatedKinds.includes(params.kind as (typeof dedicatedKinds)[number])) {
    return <FromPdfWorkspace kind={params.kind as FromPdfKind} />;
  }

  return <PdfToolWorkspace kind={params.kind as (typeof legacyKinds)[number]} />;
}