// The Shape Detection API is not in TypeScript's DOM lib yet (supported by Chromium/Android; not by iOS Safari).
interface DetectedBarcode { rawValue: string; format: string }
interface BarcodeDetectorOptions { formats?: string[] }
declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions)
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
  static getSupportedFormats(): Promise<string[]>
}
interface Window { BarcodeDetector?: typeof BarcodeDetector }
