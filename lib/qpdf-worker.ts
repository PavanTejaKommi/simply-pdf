import createQpdf from "@neslinesli93/qpdf-wasm";

type Request = { id: number; input: ArrayBuffer; mode: "encrypt" | "decrypt"; userPassword?: string; ownerPassword?: string; print?: boolean; modify?: boolean };

const workerScope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };

workerScope.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const qpdf = await createQpdf({ locateFile: () => "/qpdf.wasm" });
    const qpdfModule = qpdf as typeof qpdf & { FS: { writeFile: (path: string, data: Uint8Array) => void; readFile: (path: string) => Uint8Array } };
    qpdfModule.FS.writeFile("/input.pdf", new Uint8Array(request.input));
    const args = request.mode === "encrypt"
      ? ["--encrypt", request.userPassword || "", request.ownerPassword || request.userPassword || "", "--bits=256", request.print === false ? "--print=none" : "--print=full", request.modify === false ? "--modify=none" : "--modify=all", "--", "/input.pdf", "/output.pdf"]
      : [`--password=${request.userPassword || ""}`, "--decrypt", "/input.pdf", "/output.pdf"];
    const code = qpdfModule.callMain(args);
    if (code !== 0) throw new Error(`qpdf exited with ${code}`);
    const output = qpdfModule.FS.readFile("/output.pdf");
    workerScope.postMessage({ id: request.id, output }, [output.buffer]);
  } catch (error) {
    workerScope.postMessage({ id: request.id, error: error instanceof Error ? error.message : "QPDF operation failed" });
  }
};

export {};