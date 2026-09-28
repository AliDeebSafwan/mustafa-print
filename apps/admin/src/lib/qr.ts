import { renderSVG } from 'uqr'

/** QR code as an SVG string, generated on the device (no network, no image files). */
export const qrSvg = (text: string): string => renderSVG(text, { ecc: 'M', border: 1 })
