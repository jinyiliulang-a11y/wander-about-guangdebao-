// jsQR 1.4.0 is served locally; see vendor/jsQR-1.4.0.LICENSE.txt (Apache-2.0).
type QrReader = (data: Uint8ClampedArray, width: number, height: number, options: { inversionAttempts: string }) => { data: string } | null;
let readerPromise: Promise<QrReader> | null = null;
function softwareReader(): Promise<QrReader> {
  const environment = window as unknown as { jsQR?: QrReader };
  if (environment.jsQR) return Promise.resolve(environment.jsQR);
  if (!readerPromise) {
    readerPromise = new Promise<QrReader>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/jsQR-1.4.0.js";
      const timeout = window.setTimeout(() => { script.remove(); reject(new Error("二维码识别组件加载超时，请检查网站连接后重试")); }, 12_000);
      script.onload = () => {
        window.clearTimeout(timeout);
        if (environment.jsQR) resolve(environment.jsQR);
        else { script.remove(); reject(new Error("二维码识别组件加载失败，请重试")); }
      };
      script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error("二维码识别组件加载失败，请检查网站连接后重试")); };
      document.head.appendChild(script);
    }).catch(error => { readerPromise = null; throw error; });
  }
  return readerPromise;
}
export function parseCouponCode(raw: string): string | null {
  let code = raw.trim();
  if (/^https?:\/\//i.test(code)) {
    try {
      const url = new URL(code);
      // Hardware/check-in links open treasure tasks; they never authorize coupon redemption.
      if (/\/client\/(?:coin|task|nfc)(?:\/|$)/i.test(url.pathname) || url.searchParams.has("entry")) return null;
      if (url.searchParams.getAll("couponCode").length !== 1) return null;
      code = url.searchParams.get("couponCode")!.trim();
    } catch { return null; }
  }
  // Preserve legacy redemption codes; these are personal codes, not task URLs.
  return /^[A-Za-z0-9-]{4,80}$/.test(code) ? code.toUpperCase() : null;
}
export async function decodeCouponImage(source: CanvasImageSource, width: number, height: number, { maxDimension = 1600 }: { maxDimension?: number } = {}): Promise<string | null> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const reader = await softwareReader();
  const limit = Number.isFinite(maxDimension) ? Math.max(256, Math.min(1600, maxDimension)) : 1600;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法读取二维码图片，请手动输入券码");
  const decode = (left: number, top: number, cropWidth: number, cropHeight: number) => {
    const ratio = Math.min(1, limit / Math.max(cropWidth, cropHeight));
    canvas.width = Math.max(1, Math.round(cropWidth * ratio));
    canvas.height = Math.max(1, Math.round(cropHeight * ratio));
    context.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return reader(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data || null;
  };
  const full = decode(0, 0, width, height);
  if (full) return full;
  // Preserve more pixels around the aiming area when the QR occupies a small
  // part of a large camera frame or screenshot. jsQR handles rotation itself.
  const cropSize = Math.min(width, height) * .7;
  return decode((width - cropSize) / 2, (height - cropSize) / 2, cropSize, cropSize);
}
