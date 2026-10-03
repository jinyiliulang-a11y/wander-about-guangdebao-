/** Persist WGS84; AMap's visual/selected coordinates are GCJ-02. */
export type MapCoordinate = { longitude: number; latitude: number };
const inChina = ({ longitude, latitude }: MapCoordinate) => longitude >= 72.004 && longitude <= 137.8347 && latitude >= 0.8293 && latitude <= 55.8271;
function offset(x: number, y: number, latitude: boolean) {
  let value = latitude ? -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x))
    : 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x));
  value += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI))*2/3;
  const z = latitude ? y : x;
  value += (20*Math.sin(z*Math.PI) + 40*Math.sin(z*Math.PI/3))*2/3;
  value += ((latitude ? 160 : 150)*Math.sin(z*Math.PI/12) + (latitude ? 320 : 300)*Math.sin(z*Math.PI/30))*2/3;
  return value;
}
export function wgs84ToGcj02(point: MapCoordinate): MapCoordinate {
  if (!inChina(point)) return { ...point };
  const radians = point.latitude*Math.PI/180;
  const magic = 1 - .00669342162296594323*Math.sin(radians)**2, root = Math.sqrt(magic);
  const dLat = offset(point.longitude-105, point.latitude-35, true)*180 / ((6378245*(1-.00669342162296594323))/(magic*root)*Math.PI);
  const dLng = offset(point.longitude-105, point.latitude-35, false)*180 / (6378245/root*Math.cos(radians)*Math.PI);
  return { latitude: point.latitude+dLat, longitude: point.longitude+dLng };
}
export function gcj02ToWgs84(point: MapCoordinate): MapCoordinate {
  if (!inChina(point)) return { ...point };
  let estimate = { ...point };
  for (let i=0; i<12; i++) {
    const projected = wgs84ToGcj02(estimate);
    const dLat = projected.latitude-point.latitude, dLng = projected.longitude-point.longitude;
    estimate = { latitude: estimate.latitude-dLat, longitude: estimate.longitude-dLng };
    if (Math.max(Math.abs(dLat), Math.abs(dLng)) < 1e-8) break;
  }
  return estimate;
}
