import { validGeoLocation, type GeoLocation } from "./geofence";

/** Request only after a user action. Positions stay in memory, never storage. */
export function readBrowserLocation(): Promise<GeoLocation> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(new Error("定位需要安全连接，请通过 HTTPS 打开网站后再试。"));
    if (!navigator.geolocation) return reject(new Error("当前浏览器不支持定位，请换用支持定位的手机浏览器。"));
    navigator.geolocation.getCurrentPosition(position => {
      const location = { latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracy: position.coords.accuracy, timestamp: position.timestamp };
      if (!validGeoLocation(location)) reject(new Error("定位信息不完整，请重新定位。"));
      else resolve(location);
    }, error => reject(new Error(error.code === 1 ? "定位权限未开启，请在浏览器设置中允许本网站定位。"
      : error.code === 3 ? "定位超时，请靠近开阔区域后重试。" : "暂时无法取得位置，请检查手机定位是否开启后重试。")),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 });
  });
}
