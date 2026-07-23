/* Font pipeline: ensures the single-weight sign families are loaded for
   preview/measurement, and registers the same TTFs with jsPDF so exported
   PDFs use identical embedded fonts. */
"use strict";

const SIGN_FONTS = [
  "RobotoRegular", "RobotoMedium", "RobotoBold", "RobotoBlack",
  "BarlowRegular", "BarlowMedium", "BarlowSemiBold", "BarlowBold",
  "BarlowCondensedMedium", "BarlowCondensedSemiBold", "BarlowCondensedBold",
  "BarlowSemiCondensedBoldItalic", "BarlowSemiCondensedExtraBoldItalic",
];

const FONT_FILES = {
  RobotoRegular: "fonts/Roboto-Regular.ttf",
  RobotoMedium: "fonts/Roboto-Medium.ttf",
  RobotoBold: "fonts/Roboto-Bold.ttf",
  RobotoBlack: "fonts/Roboto-Black.ttf",
  BarlowRegular: "fonts/BarlowRegular.ttf",
  BarlowMedium: "fonts/BarlowMedium.ttf",
  BarlowSemiBold: "fonts/BarlowSemiBold.ttf",
  BarlowBold: "fonts/BarlowBold.ttf",
  BarlowCondensedMedium: "fonts/BarlowCondensedMedium.ttf",
  BarlowCondensedSemiBold: "fonts/BarlowCondensedSemiBold.ttf",
  BarlowCondensedBold: "fonts/BarlowCondensedBold.ttf",
  BarlowSemiCondensedBoldItalic: "fonts/BarlowSemiCondensedBoldItalic.ttf",
  BarlowSemiCondensedExtraBoldItalic: "fonts/BarlowSemiCondensedExtraBoldItalic.ttf",
};

let _fontsReady = null;
function ensureFontsLoaded() {
  if (_fontsReady) return _fontsReady;
  _fontsReady = Promise.all(
    SIGN_FONTS.map((f) => document.fonts.load(`16px "${f}"`).catch(() => null))
  ).then(() => document.fonts.ready);
  return _fontsReady;
}

/* Fonts embedded into exported/printed PDFs. Ace signs only use Roboto;
   the Barlow families are STIHL-only — add them back here when the STIHL
   module is re-enabled. Registering all 13 TTFs ballooned every PDF to
   ~5.7 MB; Roboto-only keeps exports lean. */
const PDF_FONTS = ["RobotoRegular", "RobotoMedium", "RobotoBold", "RobotoBlack"];

/* jsPDF registration (lazy, once). */
let _pdfFontsReady = null;
function ensurePdfFonts(doc) {
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
    })();
  }
  return _pdfFontsReady.then((entries) => {
    for (const [family, b64] of entries) {
      const file = family + ".ttf";
      doc.addFileToVFS(file, b64);
      doc.addFont(file, family, "normal");
    }
  });
}
