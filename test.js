const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/build/pdf.js');

async function main() {
  const data = new Uint8Array(fs.readFileSync('test.pdf')); // we need a test pdf
}
main();
