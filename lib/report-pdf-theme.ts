import {
  rgb,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  clip,
  endPath,
} from 'pdf-lib';
import type { PDFPage, RGB } from 'pdf-lib';

/** sRGB equivalents of the slate/emerald/amber colors in the linked reports. */
export const reportColors = {
  ink: rgb(15 / 255, 23 / 255, 42 / 255),
  muted: rgb(100 / 255, 116 / 255, 139 / 255),
  rule: rgb(226 / 255, 232 / 255, 240 / 255),
  pale: rgb(241 / 255, 245 / 255, 249 / 255),
  white: rgb(1, 1, 1),
  navy: rgb(2 / 255, 6 / 255, 23 / 255),
  blue: rgb(23 / 255, 37 / 255, 84 / 255),
  emerald: rgb(4 / 255, 120 / 255, 87 / 255),
  green: rgb(5 / 255, 150 / 255, 105 / 255),
  cyan: rgb(8 / 255, 145 / 255, 178 / 255),
};
export const reportTones = {
  neutral: {
    fill: reportColors.pale,
    border: reportColors.rule,
    ink: reportColors.ink,
  },
  success: {
    fill: rgb(0.82, 0.98, 0.9),
    border: rgb(0.43, 0.91, 0.72),
    ink: rgb(0.02, 0.37, 0.27),
  },
  warning: {
    fill: rgb(1, 0.98, 0.92),
    border: rgb(0.99, 0.83, 0.3),
    ink: rgb(0.47, 0.21, 0.06),
  },
  shortage: {
    fill: rgb(1, 0.89, 0.9),
    border: rgb(0.99, 0.65, 0.69),
    ink: rgb(0.62, 0.07, 0.22),
  },
  excess: {
    fill: rgb(0.93, 0.91, 1),
    border: rgb(0.77, 0.71, 0.99),
    ink: rgb(0.36, 0.13, 0.71),
  },
};

/** Vector rounded cards and gradients: no screenshot or screen-resolution dependency. */
export function reportCard(
  page: PDFPage,
  x: number,
  top: number,
  width: number,
  height: number,
  fill: RGB = reportColors.white,
  border?: RGB,
  gradient?: readonly RGB[],
  radius = 9,
) {
  const r = Math.min(radius, width / 2, height / 2);
  const y = page.getHeight() - top;
  const path = `M ${r} 0 H ${width - r} Q ${width} 0 ${width} ${r} V ${height - r} Q ${width} ${height} ${width - r} ${height} H ${r} Q 0 ${height} 0 ${height - r} V ${r} Q 0 0 ${r} 0 Z`;
  page.drawSvgPath(path, {
    x,
    y,
    color: fill,
    borderColor: border,
    borderWidth: border ? 0.7 : 0,
  });
  if (!gradient || gradient.length < 2) return;
  const bottom = y - height,
    k = 0.55228475 * r;
  page.pushOperators(
    pushGraphicsState(),
    moveTo(x + r, bottom),
    lineTo(x + width - r, bottom),
    appendBezierCurve(
      x + width - r + k,
      bottom,
      x + width,
      bottom + r - k,
      x + width,
      bottom + r,
    ),
    lineTo(x + width, y - r),
    appendBezierCurve(
      x + width,
      y - r + k,
      x + width - r + k,
      y,
      x + width - r,
      y,
    ),
    lineTo(x + r, y),
    appendBezierCurve(x + r - k, y, x, y - r + k, x, y - r),
    lineTo(x, bottom + r),
    appendBezierCurve(x, bottom + r - k, x + r - k, bottom, x + r, bottom),
    closePath(),
    clip(),
    endPath(),
  );
  for (let i = 0; i < 96; i++) {
    const position = (i / 95) * (gradient.length - 1);
    const index = Math.min(gradient.length - 2, Math.floor(position));
    const t = position - index,
      a = gradient[index],
      b = gradient[index + 1];
    page.drawRectangle({
      x: x + (width * i) / 96,
      y: bottom,
      width: width / 96 + 0.2,
      height,
      color: rgb(
        a.red + (b.red - a.red) * t,
        a.green + (b.green - a.green) * t,
        a.blue + (b.blue - a.blue) * t,
      ),
    });
  }
  page.pushOperators(popGraphicsState());
}
