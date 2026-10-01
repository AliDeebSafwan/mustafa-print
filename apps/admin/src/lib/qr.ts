import { renderSVG } from 'uqr'

/**
 * QR code as an SVG string, generated on the device (no network, no image files). The output is only <svg>, <rect> and
 * <path> elements; the encoded text never appears in it as markup, which is what makes it safe to insert as HTML.
 */
export const qrSvg = (text: string): string => renderSVG(text, { ecc: 'M', border: 1 })
