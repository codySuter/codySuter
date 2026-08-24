// Reads an image file, downscales it to a sane width, and returns a data
// URL that lives inside the document file (no external references).
export async function loadImageScaled(file: File | Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const maxW = 1400;
    const scale = Math.min(1, maxW / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const isPng = file.type === 'image/png';
    return canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function isImageFile(file: File | DataTransferItem): boolean {
  return /^image\//.test(file.type);
}
