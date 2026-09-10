import { notFound } from "next/navigation";
import { PdfToolWorkspace } from "../../../components/PdfToolWorkspace";
import { WatermarkWorkspace } from "../../../components/WatermarkWorkspace";
import { PasswordWorkspace } from "../../../components/PasswordWorkspace";
import { PermissionsWorkspace } from "../../../components/PermissionsWorkspace";
import { RedactWorkspace } from "../../../components/RedactWorkspace";
import { SanitizeWorkspace } from "../../../components/SanitizeWorkspace";

const kinds = ["password", "permissions", "redact", "sanitize", "sign", "certificate", "watermark"] as const;

export default function Page({ params }: { params: { kind: string } }) {
  if (!kinds.includes(params.kind as (typeof kinds)[number])) {
    notFound();
  }

  if (params.kind === "watermark") {
    return <WatermarkWorkspace />;
  }

  if (params.kind === "password") {
    return <PasswordWorkspace initialMode="lock" />;
  }

  if (params.kind === "permissions") {
    return <PermissionsWorkspace />;
  }

  if (params.kind === "redact") {
    return <RedactWorkspace />;
  }

  if (params.kind === "sanitize") {
    return <SanitizeWorkspace />;
  }

  return <PdfToolWorkspace kind={params.kind as (typeof kinds)[number]} />;
}