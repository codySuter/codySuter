/* Font pipeline: ensures the single-weight sign families are loaded for
   preview/measurement, and registers the same TTFs with jsPDF so exported
   PDFs use identical embedded fonts. */
"use strict";

const SIGN_FONTS = [
  "RobotoRegular", "RobotoMedium", "RobotoBold", "RobotoBlack",
];

const FONT_FILES = {
  RobotoRegular: "fonts/Roboto-Regular.ttf",
  RobotoMedium: "fonts/Roboto-Medium.ttf",
  RobotoBold: "fonts/Roboto-Bold.ttf",
  RobotoBlack: "fonts/Roboto-Black.ttf",
};

let _fontsReady = null;
function ensureFontsLoaded() {
  if (_fontsReady) return _fontsReady;
  _fontsReady = Promise.all(
    SIGN_FONTS.map((f) => document.fonts.load(`16px "${f}"`).catch(() => null))
  ).then(() => document.fonts.ready);
  return _fontsReady;
}

/* Fonts embedded into exported/printed PDFs. Ace signs use Roboto only. */
const PDF_FONTS = ["RobotoRegular", "RobotoMedium", "RobotoBold", "RobotoBlack"];

/* PDF font data: fetched once and kept in memory. Prefetched at boot so a
   later print/export doesn't depend on live font fetches at click time.
   A failed prefetch clears the cache so the next call retries. */
let _pdfFontsReady = null;
function prefetchPdfFonts() {
  if (!_pdfFontsReady) {
    _pdfFontsReady = (async () => {
      const entries = await Promise.all(
        Object.entries(FONT_FILES).filter(([family]) => PDF_FONTS.includes(family)).map(async ([family, path]) => {
          const buf = await (await fetch(path)).arrayBuffer();
          let bin = "";
          const bytes = new Uint8Array(buf);
          const CHUNK = 0x8000;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
          }
          return [family, btoa(bin)];
        })
      );
      return entries;
    })().catch((e) => { _pdfFontsReady = null; throw e; });
  }
  return _pdfFontsReady;
}

function ensurePdfFonts(doc) {
  return prefetchPdfFonts().then((entries) => {
    for (const [family, b64] of entries) {
      const file = family + ".ttf";
      doc.addFileToVFS(file, b64);
      doc.addFont(file, family, "normal");
    }
  });
}
