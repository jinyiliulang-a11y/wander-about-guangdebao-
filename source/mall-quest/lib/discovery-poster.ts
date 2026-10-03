import type { Coupon } from "./game-types";
import { validateStoreImageURL } from "./store-image";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("门店素材暂时加载失败，请重试"));
    image.src = src;
  });
}

export async function createDiscoveryPoster(coupon: Coupon): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器暂不支持图片导出");
  const font = (size: number, weight = 400) => {
    ctx.font = `${weight} ${size}px "Microsoft YaHei", "Noto Sans SC", sans-serif`;
  };
  const text = (
    value: string,
    y: number,
    size: number,
    color: string,
    maxLines = 2,
  ) => {
    font(size);
    ctx.fillStyle = color;
    let line = "",
      row = 0;
    for (const char of Array.from(value)) {
      if (ctx.measureText(line + char).width > 880) {
        ctx.fillText(line, 96, y + row * size * 1.6);
        row++;
        line = "";
        if (row >= maxLines) return y + row * size * 1.6;
      }
      line += char;
    }
    if (line) ctx.fillText(line, 96, y + row * size * 1.6);
    return y + (row + 1) * size * 1.6;
  };
  ctx.fillStyle = "#f6f7f2";
  ctx.fillRect(0, 0, 1080, 1440);
  ctx.strokeStyle = "#315b43";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(112, 90, 25, 0, Math.PI * 2);
  ctx.stroke();
  font(35, 600);
  ctx.fillStyle = "#315b43";
  ctx.fillText("逛道宝 · 发现卡", 158, 103);
  font(24);
  ctx.fillStyle = "#68736c";
  ctx.fillText("wander about / A LITTLE DISCOVERY", 96, 160);
  let image: HTMLImageElement | undefined;
  try { if (coupon.imageURL && validateStoreImageURL(coupon.imageURL)) image = await loadImage(coupon.imageURL); } catch { /* Use the bundled sample if a saved image cannot be decoded. */ }
  const custom = !!image;
  image ||= await loadImage("/merchant-triptych.png");
  const width = custom ? image.naturalWidth : image.naturalWidth / 3;
  const artwork = Number.isInteger(coupon.artwork) ? ((coupon.artwork % 3) + 3) % 3 : 0;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(64, 206, 952, 430, 26);
  ctx.clip();
  const cropWidth = Math.min(width, image.naturalHeight * 952 / 430);
  const cropHeight = cropWidth * 430 / 952;
  ctx.drawImage(
    image,
    (custom ? 0 : width * artwork) + (width - cropWidth) / 2,
    (image.naturalHeight - cropHeight) / 2,
    cropWidth,
    cropHeight,
    64,
    206,
    952,
    430,
  );
  ctx.restore();
  font(28);
  ctx.fillStyle = "#315b43";
  ctx.fillText("这一次，我发现了", 96, 706);
  font(59, 600);
  ctx.fillStyle = "#172b20";
  ctx.fillText(coupon.storeName, 96, 798);
  text(`跟着 ${coupon.author} 的线索，收获一个小惊喜。`, 860, 28, "#68736c", 2);
  ctx.fillStyle = "#e6eddc";
  ctx.beginPath();
  ctx.roundRect(64, 950, 952, 238, 22);
  ctx.fill();
  text(coupon.reward, 1020, 38, "#315b43", 2);
  text(coupon.conditions, 1110, 24, "#4d6456", 2);
  const date = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(coupon.issuedAt);
  text(`星光里购物中心 · ${date}`, 1257, 26, "#68736c", 1);
  text("模拟发现卡 · 非真实消费权益", 1320, 25, "#315b43", 1);
  text("奖励码与使用状态请在个人卡包查看", 1371, 22, "#68736c", 1);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("图片导出失败，请重试")),
      "image/png",
    ),
  );
}

export async function downloadDiscoveryPoster(coupon: Coupon) {
  const blob = await createDiscoveryPoster(coupon);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `逛道宝_发现卡_${coupon.storeName}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
