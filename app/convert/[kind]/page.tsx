import { notFound } from "next/navigation";
import { ConvertWorkspace } from "../../../components/ConvertWorkspace";

const kinds = ["word", "excel", "powerpoint", "images", "text", "html", "markdown", "audio"] as const;

export default async function ConvertPage({ params }: { params: { kind: string } }) {
  if (!kinds.includes(params.kind as (typeof kinds)[number])) notFound();
  return <ConvertWorkspace kind={params.kind as (typeof kinds)[number]} />;
}
