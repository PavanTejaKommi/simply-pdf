import { PDFDocument } from "pdf-lib";

/**
 * Request payload sent from the React frontend to the Web Worker.
 */
export interface InterleaveWorkerRequest {
  id?: string | number;
  buffers: Uint8Array[];
}

/**
 * Success response sent from the Web Worker back to the React frontend.
 */
export interface InterleaveWorkerSuccessResponse {
  id?: string | number;
  success: true;
  result: Uint8Array;
}

/**
 * Error response sent from the Web Worker back to the React frontend.
 */
export interface InterleaveWorkerErrorResponse {
  id?: string | number;
  success: false;
  error: string;
}

export type InterleaveWorkerResponse =
  | InterleaveWorkerSuccessResponse
  | InterleaveWorkerErrorResponse;

/**
 * Core Dynamic Multi-File Interleave Utility Function.
 *
 * Requirements:
 * 1. Dynamic Multi-File Interleave: Accepts an array of multiple Uint8Array PDF buffers
 *    and loads all of them into PDFDocument instances.
 * 2. Calculate Maximum Depth: Determines the highest page count among all loaded documents.
 * 3. Matrix Iteration: Creates an empty PDFDocument, an outer loop from 0 to maxDepth,
 *    and an inner loop iterating through the loaded documents.
 * 4. Conditional Extraction: Checks if the current document has a page at the outer loop index.
 *    If so, uses copyPages to extract that page and addPage to append it to the new document.
 *    If the document has run out of pages, skips it and continues.
 * 5. Return: Returns the newly combined PDFDocument as a Uint8Array for Blob generation.
 *
 * @param pdfBuffers - Array of Uint8Array buffers representing individual PDF documents.
 * @returns Promise resolving to a Uint8Array of the interleaved PDF document.
 */
export async function interleavePdfBuffers(pdfBuffers: Uint8Array[]): Promise<Uint8Array> {
  if (!pdfBuffers || pdfBuffers.length === 0) {
    throw new Error("At least one PDF buffer is required to perform interleaving.");
  }

  // 1. Dynamic Multi-File Interleave: Load all buffers into PDFDocument instances in parallel
  const loadedDocs: PDFDocument[] = await Promise.all(
    pdfBuffers.map((buffer) => PDFDocument.load(buffer))
  );

  // 2. Calculate Maximum Depth: Determine the highest page count among all loaded documents
  const pageCounts = loadedDocs.map((doc) => doc.getPageCount());
  const maxDepth = Math.max(...pageCounts, 0);

  // 3. Matrix Iteration: Create a new, empty PDFDocument
  const outputDoc = await PDFDocument.create();

  // Outer loop: iterates across page indices from 0 up to the maximum depth
  for (let pageIdx = 0; pageIdx < maxDepth; pageIdx++) {
    // Inner loop: iterates through each loaded document in sequence
    for (let docIdx = 0; docIdx < loadedDocs.length; docIdx++) {
      const currentDoc = loadedDocs[docIdx];
      const currentDocPageCount = pageCounts[docIdx];

      // 4. Conditional Extraction:
      // If the current document has a page at the current index, copy and add it.
      // If it has run out of pages, skip it and continue to the next document.
      if (pageIdx < currentDocPageCount) {
        const [copiedPage] = await outputDoc.copyPages(currentDoc, [pageIdx]);
        outputDoc.addPage(copiedPage);
      }
    }
  }

  // 5. Return: Return the newly combined PDFDocument as a Uint8Array
  return outputDoc.save();
}

/**
 * Worker message event listener for standalone Web Worker execution.
 */
const workerScope = typeof self !== "undefined"
  ? (self as unknown as {
      onmessage: ((event: MessageEvent<InterleaveWorkerRequest>) => void) | null;
      postMessage: (message: unknown, transfer?: Transferable[]) => void;
    })
  : null;

if (workerScope && typeof workerScope.postMessage === "function") {
  workerScope.onmessage = async (event: MessageEvent<InterleaveWorkerRequest>) => {
    const { id, buffers } = event.data;
    try {
      const result = await interleavePdfBuffers(buffers);
      // Post result back with zero-copy transfer of the underlying ArrayBuffer
      workerScope.postMessage(
        { id, success: true, result } satisfies InterleaveWorkerSuccessResponse,
        [result.buffer]
      );
    } catch (error) {
      workerScope.postMessage({
        id,
        success: false,
        error: error instanceof Error ? error.message : "Failed to interleave PDF documents",
      } satisfies InterleaveWorkerErrorResponse);
    }
  };
}
