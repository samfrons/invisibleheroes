/** A QR code as an inline SVG string: one path, crisp at any size, no image file. */
import qrcode from 'qrcode-generator';

export function qrSvg(text: string, label: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  // Four modules of quiet margin all round, as scanners expect.
  const margin = 4;
  const size = count + margin * 2;
  let path = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      // Merge a run of dark modules in a row into one rectangle.
      let run = 1;
      while (col + run < count && qr.isDark(row, col + run)) run += 1;
      path += `M${col + margin} ${row + margin}h${run}v1h-${run}z`;
      col += run - 1;
    }
  }
  const safe = label.replace(/[&<>"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${safe}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#0c1638"/></svg>`;
}
