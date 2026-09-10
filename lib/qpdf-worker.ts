import createQpdf from "@neslinesli93/qpdf-wasm";

export type QpdfWorkerRequest = {
  id?: number;
  input: ArrayBuffer;
  mode: "encrypt" | "decrypt";
  userPassword?: string;
  ownerPassword?: string;
  keyLength?: 128 | 256;
  print?: "none" | "low" | "full" | boolean;
  modify?: "none" | "assembly" | "form" | "annotate" | "all" | boolean;
  extract?: boolean;
  annotate?: boolean;
  accessibility?: boolean;
};

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<QpdfWorkerRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

workerScope.onmessage = async (event: MessageEvent<QpdfWorkerRequest>) => {
  const request = event.data;
  const errorLogs: string[] = [];

  try {
    const qpdf = await createQpdf({
      locateFile: () => "/qpdf.wasm",
      printErr: (text: string) => {
        errorLogs.push(text);
      },
    } as any);

    const qpdfModule = qpdf as typeof qpdf & {
      FS: {
        writeFile: (path: string, data: Uint8Array) => void;
        readFile: (path: string) => Uint8Array;
        unlink: (path: string) => void;
      };
    };

    qpdfModule.FS.writeFile("/input.pdf", new Uint8Array(request.input));

    let args: string[] = [];

    if (request.mode === "encrypt") {
      const userPass = request.userPassword ?? "";
      const ownerPass = request.ownerPassword || request.userPassword || "";
      const bits = String(request.keyLength === 128 ? 128 : 256);

      args.push("--encrypt", userPass, ownerPass, bits);

      // Permissions: Printing
      if (request.print === "none" || request.print === false) {
        args.push("--print=none");
      } else if (request.print === "low") {
        args.push("--print=low");
      } else if (request.print === "full" || request.print === true) {
        args.push("--print=full");
      }

      // Permissions: Modifications
      if (request.modify === "none" || request.modify === false) {
        args.push("--modify=none");
      } else if (request.modify === "assembly") {
        args.push("--modify=assembly");
      } else if (request.modify === "form") {
        args.push("--modify=form");
      } else if (request.modify === "annotate") {
        args.push("--modify=annotate");
      } else if (request.modify === "all" || request.modify === true) {
        args.push("--modify=all");
      }

      // Permissions: Extract text/graphics
      if (request.extract === false) {
        args.push("--extract=n");
      } else if (request.extract === true) {
        args.push("--extract=y");
      }

      // Permissions: Annotations
      if (request.annotate === false) {
        args.push("--annotate=n");
      } else if (request.annotate === true) {
        args.push("--annotate=y");
      }

      // Permissions: Accessibility
      if (request.accessibility === false) {
        args.push("--accessibility=n");
      }

      args.push("--", "/input.pdf", "/output.pdf");
    } else {
      // Decrypt mode
      const pass = request.userPassword || request.ownerPassword || "";
      if (pass) {
        args.push(`--password=${pass}`);
      }
      args.push("--decrypt", "/input.pdf", "/output.pdf");
    }

    let code = 0;
    try {
      code = qpdfModule.callMain(args);
    } catch (execErr: any) {
      const fullLog = errorLogs.join(" ");
      if (
        fullLog.toLowerCase().includes("invalid password") ||
        fullLog.toLowerCase().includes("incorrect password")
      ) {
        throw new Error("Incorrect password. Please verify your password and try again.");
      }
      throw new Error(fullLog || execErr.message || "QPDF execution failed");
    }

    if (code !== 0) {
      const fullLog = errorLogs.join(" ");
      if (
        fullLog.toLowerCase().includes("invalid password") ||
        fullLog.toLowerCase().includes("incorrect password") ||
        code === 2
      ) {
        throw new Error("Incorrect password. Please verify your password and try again.");
      }
      throw new Error(fullLog || `QPDF exited with code ${code}`);
    }

    const output = qpdfModule.FS.readFile("/output.pdf");
    workerScope.postMessage({ id: request.id, output }, [output.buffer]);
  } catch (error) {
    workerScope.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : "QPDF operation failed",
    });
  }
};

export {};