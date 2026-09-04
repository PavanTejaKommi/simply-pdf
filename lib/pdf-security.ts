import { PDFDocument, PDFName, PDFRawStream, degrees, rgb, StandardFonts } from "pdf-lib";
import forge from "node-forge";

export type RedactionBounds = { pageIndex: number; x: number; y: number; width: number; height: number };

type QpdfRequest = { input: ArrayBuffer; mode: "encrypt" | "decrypt"; userPassword?: string; ownerPassword?: string; print?: boolean; modify?: boolean };

export function runQpdf(request: QpdfRequest) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(new URL("./qpdf-worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<{ output?: Uint8Array; error?: string }>) => { worker.terminate(); event.data.output ? resolve(event.data.output) : reject(new Error(event.data.error || "QPDF operation failed")); };
    worker.onerror = () => { worker.terminate(); reject(new Error("QPDF worker could not start")); };
    worker.postMessage(request, [request.input]);
  });
}

export function encryptPdf(input: { input: ArrayBuffer; userPassword: string; ownerPassword: string; print: boolean; modify: boolean }) { return runQpdf({ ...input, mode: "encrypt" }); }
export function decryptPdf(input: { input: ArrayBuffer; userPassword: string }) { return runQpdf({ ...input, mode: "decrypt" }); }

function stripTextOperators(stream: string) {
  return stream.replace(/(?:\([^)]*\)|<[^>]*>|\S+)\s+(?:Tj|TJ|\'|\")\s*/g, "").replace(/BT[\s\S]*?ET/g, "");
}

export async function redactPdf(input: ArrayBuffer, bounds: RedactionBounds[]) {
  const pdf = await PDFDocument.load(input);
  for (const bound of bounds) {
    const page = pdf.getPages()[bound.pageIndex];
    if (!page) continue;
    const contents = page.node.Contents();
    if (contents instanceof PDFRawStream) {
      const stripped = new TextDecoder().decode(contents.getContents());
      const stream = PDFRawStream.of(contents.dict, new TextEncoder().encode(stripTextOperators(stripped)));
      page.node.set(PDFName.of("Contents"), pdf.context.register(stream));
    }
    page.drawRectangle({ x: bound.x, y: bound.y, width: bound.width, height: bound.height, color: rgb(0, 0, 0), opacity: 1 });
  }
  return pdf.save({ useObjectStreams: true });
}

export async function sanitizePdf(input: ArrayBuffer) {
  const pdf = await PDFDocument.load(input, { updateMetadata: false });
  pdf.setTitle(""); pdf.setAuthor(""); pdf.setSubject(""); pdf.setKeywords([]); pdf.setCreator(""); pdf.setProducer("");
  return pdf.save({ useObjectStreams: true, addDefaultPage: false });
}

export async function stampSignature(input: ArrayBuffer, png: Uint8Array, pageIndex: number, x: number, y: number, width: number, height: number) {
  const pdf = await PDFDocument.load(input); const page = pdf.getPages()[pageIndex]; if (!page) throw new Error("Signature page does not exist");
  page.drawImage(await pdf.embedPng(png), { x, y, width, height }); return pdf.save({ useObjectStreams: true });
}

export async function applyWatermark(input: ArrayBuffer, text: string, opacity: number, repeat: boolean) {
  const pdf = await PDFDocument.load(input); const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const page of pdf.getPages()) { const positions = repeat ? Array.from({ length: 9 }, (_, index) => ({ x: 30 + (index % 3) * page.getWidth() / 3, y: 70 + Math.floor(index / 3) * page.getHeight() / 3 })) : [{ x: 50, y: page.getHeight() / 2 }]; for (const position of positions) page.drawText(text, { ...position, size: 28, font, color: rgb(0.2, 0.2, 0.2), opacity, rotate: degrees(35) }); }
  return pdf.save({ useObjectStreams: true });
}

export async function signWithP12(input: ArrayBuffer, certificateFile: ArrayBuffer, password: string) {
  const binary = (value: ArrayBuffer) => { const bytes = new Uint8Array(value); let result = ""; for (let index = 0; index < bytes.length; index += 1) result += String.fromCharCode(bytes[index]); return result; };
  const bytes = forge.util.createBuffer(binary(certificateFile), "raw");
  const asn1 = forge.asn1.fromDer(bytes.getBytes()); const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password); let key: forge.pki.PrivateKey | undefined; let certificate: forge.pki.Certificate | undefined;
  for (const safeContents of p12.safeContents) for (const bag of safeContents.safeBags) { if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag || bag.type === forge.pki.oids.keyBag) key = bag.key; if (bag.type === forge.pki.oids.certBag) certificate = bag.cert; }
  if (!key || !certificate) throw new Error("The certificate does not contain a private key and certificate");
  const signed = forge.pkcs7.createSignedData(); signed.content = forge.util.createBuffer(binary(input), "raw"); signed.addCertificate(certificate); signed.addSigner({ key: key as forge.pki.rsa.PrivateKey, certificate, digestAlgorithm: forge.pki.oids.sha256 }); signed.sign({ detached: true });
  const block = forge.asn1.toDer(signed.toAsn1()).getBytes(); const marker = new TextEncoder().encode(`\n% SimplyPDF-PKCS7 ${forge.util.bytesToHex(block)}\n`); const output = new Uint8Array(input.byteLength + marker.byteLength); output.set(new Uint8Array(input)); output.set(marker, input.byteLength); return output;
}