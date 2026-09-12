import { notFound } from "next/navigation";
import { AiToolWorkspace } from "../../../components/AiToolWorkspace";

const kinds = ["chat", "summarize", "extract", "translate", "redact-ai", "quiz", "rewrite"] as const;

export default function Page({ params }: { params: { kind: string } }) {
  if (!kinds.includes(params.kind as (typeof kinds)[number])) notFound();
  return <AiToolWorkspace kind={params.kind as (typeof kinds)[number]} />;
}
