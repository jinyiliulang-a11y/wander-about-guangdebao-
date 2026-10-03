/** Small browser-only OOXML writer for the operational report. No data leaves the page. */
import { merchantCouponReportRows, type MerchantCouponStats } from "./merchant-stats";

export type ReportStats = {
  range: number; totalTasks: number; claims: number; redeemed: number;
  distinctPlayers: number; claimRate: number; consumption: number | null;
  registeredUsers?: number; publishedTasks?: number; merchantCount?: number;
  activeUsersToday?: number;
  merchantCoupons?: MerchantCouponStats;
  daily: { date: string; claims: number; redeemed: number }[];
};
export type PendingReview = {
  id: string; title: string; storeId: string; storeName: string;
  authorName: string; createdAt: number; kind: "task";
};
export type WorkbenchReport = {
  scope: { role: string; storeId: string | null };
  stats: ReportStats; store?: { name: string } | null;
  pendingReviews?: PendingReview[];
};
type Cell = { value: string | number; style?: number };
type Sheet = { name: string; rows: Cell[][]; widths: number[]; filter?: string; freeze?: number };
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const xml = (value: unknown) => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const col = (index: number) => {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
};
const c = (value: string | number, style = 0): Cell => ({ value, style });
const shanghaiDay = (now: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const excelDay = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86400000) + 25569;
const excelTimestamp = (ms: number) => (ms + 8 * 3600000) / 86400000 + 25569;
const unknown = (value?: number) => value === undefined ? "未采集" : value;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>
<fonts count="5"><font><sz val="11"/><color rgb="FF243C2E"/><name val="Arial"/></font><font><b/><sz val="17"/><color rgb="FF183B2B"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><i/><sz val="10"/><color rgb="FF65786A"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF315B43"/><name val="Arial"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF183B2B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F6EE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1DF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFDCE5D8"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function worksheet(sheet: Sheet): string {
  const last = `${col(sheet.widths.length - 1)}${sheet.rows.length}`;
  const rows = sheet.rows.map((row, i) => {
    const lines = i < 5 ? 1 : Math.max(1, ...row.map((cell, j) => typeof cell.value === "string" ? Math.ceil(Array.from(cell.value).reduce((n, char) => n + (char.charCodeAt(0) > 255 ? 2 : 1), 0) / Math.max(1, sheet.widths[j] - 2)) : 1));
    return `<row r="${i + 1}" ht="${i === 1 ? 34 : i === 2 ? 28 : Math.max(26, lines * 17 + 8)}" customHeight="1">${row.map((cell, j) => {
    const address = `${col(j)}${i + 1}`;
    if (typeof cell.value === "number" && Number.isFinite(cell.value)) return `<c r="${address}" s="${cell.style ?? 3}"><v>${cell.value}</v></c>`;
    // inlineStr is explicitly a literal, including strings beginning with =,+,-,@.
    return `<c r="${address}" s="${cell.style ?? 0}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
  }).join("")}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetPr><tabColor rgb="FF253047"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0">${sheet.freeze ? `<pane ySplit="${sheet.freeze}" topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sheet.freeze + 1}" sqref="A${sheet.freeze + 1}"/>` : ""}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="26"/><cols>${sheet.widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows}</sheetData>${sheet.filter ? `<autoFilter ref="${sheet.filter}"/>` : ""}<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.25" footer="0.25"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddHeader>&amp;L逛道宝&amp;R${xml(sheet.name)}</oddHeader><oddFooter>&amp;L北京时间统计&amp;R第 &amp;P 页 / 共 &amp;N 页</oddFooter></headerFooter></worksheet>`;
}

/** Exportable package parts make the browser writer independently verifiable. */
export function workbenchWorkbookParts(data: WorkbenchReport, now = new Date()): Record<string, string> {
  const s = data.stats, admin = data.scope.role === "admin", coupons = s.merchantCoupons;
  const title = admin ? "运营数据报告" : `${data.store?.name || "商家"}优惠券与库存报告`;
  const context = `近${s.range}天 · 截至 ${shanghaiDay(now)} · 北京时间`;
  const metrics: [string, string | number, string][] = admin ? [
    ...(admin ? [
      ["注册用户", unknown(s.registeredUsers), "演示手机号绑定的账户"] as [string, string | number, string],
      ["投放金币", unknown(s.publishedTasks), "当前已发布、未过期且门店营业的任务"] as [string, string | number, string],
      ["入驻商家", unknown(s.merchantCount), "本活动登记门店，含已下线"] as [string, string | number, string],
      ["今日活跃", unknown(s.activeUsersToday), "今日访问游戏或登录的去重玩家，排除后台身份"] as [string, string | number, string],
    ] : []),
    ["任务总数", s.totalTasks, "未删除任务，包括待审核、已发布与已撤回"],
    ["成功领奖", s.claims, "所选范围内成功领取奖励的次数"],
    ["已核销", s.redeemed, "所选范围领取奖励中当前已核销的份数"],
    ["参与玩家", s.distinctPlayers, "所选范围成功领奖的去重玩家"],
    ["核销率", s.claimRate / 100, "当前已核销 / 所选范围成功领奖"],
    ["实际消费金额（元）", s.consumption === null ? "未采集" : s.consumption, "核销不等同实际消费金额"],
  ] : [
    ...merchantCouponReportRows(coupons, s.range),
    ["实际消费金额（元）", "未采集", "核销不等同实际营业额或真实到店"],
  ];
  const sheets: Sheet[] = [{ name: "数据概览", widths: [25, 18, 3, 63], rows: [[], [c(title, 1)], [c(context, 9)], [], [c("指标", 2), c("数值", 2), c(""), c("统计口径", 2)], ...metrics.map(([label, value, note], i) => [c(label, i % 2 ? 5 : 0), c(value, label.endsWith("核销率") && typeof value === "number" ? 8 : typeof value === "number" ? (i % 2 ? 4 : 3) : (i % 2 ? 5 : 0)), c(""), c(note, i % 2 ? 5 : 0)])] }];
  const daily = admin ? s.daily : (coupons?.daily || []).map(day => ({date:day.date,claims:day.issued,redeemed:day.redeemed}));
  sheets.push({ name: "每日明细", widths: [20, 22, 22], freeze: 5, filter: `A5:C${Math.max(5, 5 + daily.length)}`, rows: [[], [c(admin ? "领奖与核销日报" : "发券与核销日报", 1)], [c(context, 9)], [], [c("日期", 2), c(admin ? "成功领奖（次）" : "发放优惠券（份）", 2), c("核销发生（次）", 2)], ...daily.map((day, i) => [c(excelDay(day.date), i % 2 ? 7 : 6), c(day.claims, i % 2 ? 4 : 3), c(day.redeemed, i % 2 ? 4 : 3)])] });
  if (admin) {
    const pending = data.pendingReviews || [];
    sheets.push({ name: "待处理事项", widths: [40, 24, 22, 23, 18], freeze: 5, filter: `A5:E${Math.max(5, 5 + pending.length)}`, rows: [[], [c("待审核的投放申请", 1)], [c(`截至 ${shanghaiDay(now)} · 共 ${pending.length} 条`, 9)], [], [c("标题", 2), c("门店", 2), c("提交人", 2), c("提交时间（北京时间）", 2), c("状态", 2)], ...pending.map((item, i) => [c(item.title, i % 2 ? 5 : 0), c(item.storeName, i % 2 ? 5 : 0), c(item.authorName, i % 2 ? 5 : 0), c(excelTimestamp(item.createdAt), 11), c("待审核", 10)])] });
  }
  const parts: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": styles,
  };
  sheets.forEach((sheet, i) => { parts[`xl/worksheets/sheet${i + 1}.xml`] = worksheet(sheet); });
  return parts;
}

function zip(parts: Record<string, string>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder(), files = Object.entries(parts).map(([name, text]) => ({ name: encoder.encode(name), bytes: encoder.encode(text) }));
  const size = files.reduce((n, file) => n + 30 + file.name.length + file.bytes.length + 46 + file.name.length, 22);
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer); let offset = 0;
  const u16 = (at: number, n: number) => view.setUint16(at, n, true), u32 = (at: number, n: number) => view.setUint32(at, n, true);
  const directory: { name: Uint8Array; size: number; crc: number; offset: number }[] = [];
  for (const file of files) {
    let crc = 0xffffffff;
    for (const byte of file.bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    directory.push({ name: file.name, size: file.bytes.length, crc, offset });
    u32(offset, 0x04034b50); u16(offset + 4, 20); u16(offset + 6, 0x800); u16(offset + 12, 33); u32(offset + 14, crc); u32(offset + 18, file.bytes.length); u32(offset + 22, file.bytes.length); u16(offset + 26, file.name.length);
    bytes.set(file.name, offset + 30); bytes.set(file.bytes, offset + 30 + file.name.length); offset += 30 + file.name.length + file.bytes.length;
  }
  const start = offset;
  for (const file of directory) {
    u32(offset, 0x02014b50); u16(offset + 4, 20); u16(offset + 6, 20); u16(offset + 8, 0x800); u16(offset + 14, 33); u32(offset + 16, file.crc); u32(offset + 20, file.size); u32(offset + 24, file.size); u16(offset + 28, file.name.length); u32(offset + 42, file.offset);
    bytes.set(file.name, offset + 46); offset += 46 + file.name.length;
  }
  u32(offset, 0x06054b50); u16(offset + 8, directory.length); u16(offset + 10, directory.length); u32(offset + 12, offset - start); u32(offset + 16, start);
  return bytes;
}

export function createWorkbenchXlsx(data: WorkbenchReport, now = new Date()): Uint8Array<ArrayBuffer> { return zip(workbenchWorkbookParts(data, now)); }
export function downloadWorkbenchXlsx(data: WorkbenchReport): void {
  const now = new Date(), bytes = createWorkbenchXlsx(data, now);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a"); anchor.href = url;
  const prefix = data.scope.role === "admin" ? "运营" : "商家";
  anchor.download = `逛道宝_${prefix}数据_近${data.stats.range}天_${shanghaiDay(now)}.xlsx`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
