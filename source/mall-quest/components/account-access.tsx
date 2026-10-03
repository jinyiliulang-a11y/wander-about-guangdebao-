"use client";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Compass, Eye, EyeOff, LocateFixed, MapPin, ShieldCheck, Store, UserPlus } from "lucide-react";
import { isUncertainResult } from "@/lib/game-api";
import { readBrowserLocation } from "@/lib/browser-location";
import { validCoordinates, validRadius, type StoreGeofence } from "@/lib/geofence";
import type { AccountRole, AccountRegistrationResult, AccountStatusResult } from "@/lib/account-types";
import { AmapGeofenceMap } from "./amap-geofence-map";
import { EmailCodeField, emailProofError, emptyEmailProof, normalizeEmail, validEmailAddress, type EmailProof } from "./email-login-access";
import { clearRegistration, pendingRegistration, registrationRetryable, rememberRegistration, type MerchantDraft } from "./account-registration-memory";
import "./account-access.css";

type Props = { accountRole: AccountRole; busy: boolean; onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>; onDone: () => void; onBack?: () => void; explorer?: boolean; recordingShortcutAllowed?: boolean; onRegistrationPendingChange?: (pending: boolean) => void };
type Unconfirmed = { payload: Record<string, unknown>; retryable: boolean };
const initialMerchant = (): MerchantDraft => ({ name: "", address: "", floor: "", area: "", category: "", phone: "", latitude: "", longitude: "", radius: "100", couponTitle: "", couponType: "gift", value: "", minAmount: "0", totalCount: "", conditions: "", validity: "always", start: "", end: "" });
const normalizedName = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const normalizedLogin = (value: string) => value.includes("@") ? normalizeEmail(value) : normalizedName(value);
const dateValue = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? Date.parse(`${value}:00+08:00`) : NaN;
const length = (value: string) => Array.from(value.trim()).length;
const roleName = (role: AccountRole) => role === "merchant" ? "商家" : role === "admin" ? "运营" : "探索";
const statusMessage = (status: string) => status === "pending" ? "注册申请已提交，等待运营审核。审核通过后可用邮箱和密码登录。" : status === "rejected" ? "申请已被退回，请查看审核说明并联系运营。" : "账号已注册，可用邮箱和密码登录。";
function newRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function AccountAccess({ accountRole, busy, onAction, onDone, onBack, explorer = false, recordingShortcutAllowed = false, onRegistrationPendingChange }: Props) {
  const [recovery] = useState(() => pendingRegistration(accountRole));
  const id = useId(), alive = useRef(true), locationSequence = useRef(0), requestLock = useRef(false), formRef = useRef<HTMLFormElement>(null), previousStage = useRef("login:0");
  const [mode, setMode] = useState<"login" | "register">(recovery ? "register" : "login"), [step, setStep] = useState(recovery?.snapshot.step || 0);
  const [username, setUsername] = useState(recovery?.snapshot.username || ""), [password, setPassword] = useState(recovery?.snapshot.password || "");
  const [confirmPassword, setConfirmPassword] = useState(recovery?.snapshot.confirmPassword || ""), [nickname, setNickname] = useState(recovery?.snapshot.nickname || ""), [phone, setPhone] = useState(recovery?.snapshot.phone || "");
  const [merchant, setMerchant] = useState(() => recovery?.snapshot.merchant || initialMerchant()), [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(recovery ? "已恢复原注册申请，请先核对结果；本页不会自动重复提交。" : ""), [notice, setNotice] = useState(""), [positionNotice, setPositionNotice] = useState("");
  const [submitting, setSubmitting] = useState(false), [locating, setLocating] = useState(false), [unconfirmed, setUnconfirmed] = useState<Unconfirmed | null>(() => recovery ? { payload: recovery.payload, retryable: recovery.retryable } : null);
  const [recordingBlocked, setRecordingBlocked] = useState(false);
  const [emailProof, setEmailProof] = useState<EmailProof>(() => ({ email: recovery?.snapshot.email || "", code: recovery?.snapshot.emailCode || "", challengeId: recovery?.snapshot.emailChallengeId || "", expiresAt: recovery?.snapshot.emailExpiresAt || 0 })), [emailBusy, setEmailBusy] = useState(false);
  const registration = useRef<{ signature: string; payload: Record<string, unknown> } | null>(null);
  const working = busy || submitting || locating || emailBusy, locked = working || !!unconfirmed;
  useEffect(() => { const sequence = locationSequence; alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  useEffect(() => { onRegistrationPendingChange?.((mode === "register" && (submitting || locating)) || emailBusy || !!unconfirmed); }, [mode, submitting, locating, emailBusy, unconfirmed, onRegistrationPendingChange]);
  useEffect(() => () => onRegistrationPendingChange?.(false), [onRegistrationPendingChange]);
  useEffect(() => {
    const stage = `${mode}:${step}`;
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    const frame = requestAnimationFrame(() => {
      const form = formRef.current, card = form?.closest(".account-access");
      const advanced = mode === "register" && accountRole === "merchant" && step > 0;
      const target = advanced ? form : card;
      const heading = target?.querySelector<HTMLElement>(advanced ? "h3" : "h2");
      if (!target || !heading) return;
      const reduce = !!document.querySelector('[data-reduce-motion="true"]') || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ block: "start", behavior: reduce ? "instant" : "smooth" });
      heading.tabIndex = -1; heading.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, step, accountRole]);
  const setMerchantField = <K extends keyof MerchantDraft>(key: K, value: MerchantDraft[K]) => { setMerchant(draft => ({ ...draft, [key]: value })); setError(""); };
  const centerValid = merchant.latitude.trim() !== "" && merchant.longitude.trim() !== "" && validCoordinates(Number(merchant.latitude), Number(merchant.longitude));
  const mapFence = useMemo<StoreGeofence | null>(() => centerValid && validRadius(Number(merchant.radius)) ? { storeId: "registration-location", storeName: merchant.name.trim() || "待注册门店", enabled: true, latitude: Number(merchant.latitude), longitude: Number(merchant.longitude), radiusMeters: Number(merchant.radius), revision: 0, updatedAt: null, coordinateSystem: "WGS84" } : null, [centerValid, merchant.latitude, merchant.longitude, merchant.radius, merchant.name]);
  const selectCenter = (point: { latitude: number; longitude: number }) => {
    if (locked || !validCoordinates(point.latitude, point.longitude)) return;
    setMerchant(draft => ({ ...draft, latitude: point.latitude.toFixed(7), longitude: point.longitude.toFixed(7) }));
    setPositionNotice("门店位置已选择，请核对地址、楼层和范围。"); setError("");
  };
  function accountError(register: boolean) {
    if (register) {
      const emailValidation = emailProofError(emailProof);
      if (emailValidation) return emailValidation;
    } else {
      const identifier = normalizedLogin(username);
      if (!validEmailAddress(identifier) && !/^[a-z0-9._-]{3,32}$/.test(identifier)) return "请填写注册邮箱；已有账号也可使用原账号名登录。";
    }
    if (password.length < 3 || password.length > 128 || !password.trim()) return "密码须为 3–128 个字符，不能全部为空格。";
    if (!register) return "";
    if (password !== confirmPassword) return "两次输入的密码不一致。";
    if (length(nickname) > 24) return "昵称最多 24 个字。";
    if (phone.trim() && !/^1\d{10}$/.test(phone.trim())) return "联系手机号须为 11 位号码；也可留空。";
    return "";
  }
  function merchantError(coupon: boolean) {
    const fields: [keyof MerchantDraft, string, number][] = [["name", "门店名称", 60], ["address", "真实街道地址", 200], ["floor", "楼层", 12], ["area", "门店区域", 80], ["category", "门店类别", 40]];
    for (const [field, label, max] of fields) if (!merchant[field].trim() || length(merchant[field]) > max) return `请填写${label}，最多 ${max} 个字。`;
    if (!centerValid || !validRadius(Number(merchant.radius))) return "请选定真实门店位置，并填写 20–5000 米的到店范围。";
    if (merchant.phone.trim() && !/^[0-9+()\-\s]{3,24}$/.test(merchant.phone.trim())) return "门店电话格式不正确，请填写号码、区号或留空。";
    if (!coupon) return "";
    if (!merchant.couponTitle.trim() || length(merchant.couponTitle) > 80) return "请填写优惠券名称，最多 80 个字。";
    const value = Number(merchant.value), amount = Number(merchant.minAmount), count = Number(merchant.totalCount);
    if (merchant.couponType === "cash" && (!merchant.value.trim() || !Number.isFinite(value) || value < .01 || value > 1_000_000)) return "代金券面额须为 0.01–1000000 元。";
    if (merchant.couponType === "discount" && (!merchant.value.trim() || !Number.isFinite(value) || value < .1 || value > 9.9)) return "折扣须为 0.1–9.9 折。";
    if (!merchant.minAmount.trim() || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return "最低消费须为 0–1000000 元。";
    if (merchant.couponType === "cash" && value > amount) return "代金券最低消费需大于或等于减免面额。";
    if (!merchant.totalCount.trim() || !Number.isSafeInteger(count) || count < 1 || count > 100_000) return "优惠券数量须为 1–100000 的整数。";
    if (!merchant.conditions.trim() || length(merchant.conditions) > 500) return "请填写优惠券使用条件，最多 500 个字。";
    if (merchant.validity === "dates") { const start = dateValue(merchant.start), end = dateValue(merchant.end); if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end > 253402271999999 || end <= start || end <= Date.now()) return "请填写有效的北京时间；结束时间须在未来且晚于开始时间。"; }
    return "";
  }
  function advance() {
    if (locked) return;
    const validation = step === 0 ? accountError(true) : merchantError(false);
    if (validation) { setError(validation); return; }
    setStep(value => value + 1); setError("");
  }
  function switchMode(next: "login" | "register") {
    if (locked) return;
    setMode(next); setStep(0); setError(""); setNotice(""); setPassword(""); setConfirmPassword(""); setShowPassword(false); setEmailProof(emptyEmailProof()); registration.current = null;
  }
  function completeRegistration(result: AccountRegistrationResult, requestId: unknown) {
    clearRegistration(accountRole, requestId);
    setUsername(result.username); setMode("login"); setStep(0); setPassword(""); setConfirmPassword(""); setShowPassword(false); setEmailProof(emptyEmailProof()); setUnconfirmed(null); registration.current = null;
    setNotice(result.message || statusMessage(result.status)); setError("");
  }
  async function sendRegistration(payload: Record<string, unknown>) {
    if (requestLock.current || busy) return;
    if (!rememberRegistration(accountRole, payload, { username: typeof payload.username === "string" ? payload.username : normalizeEmail(emailProof.email), password, confirmPassword, nickname, phone, merchant, step, email: emailProof.email, emailCode: emailProof.code, emailChallengeId: emailProof.challengeId, emailExpiresAt: emailProof.expiresAt })) { const original = pendingRegistration(accountRole); if (original) setUnconfirmed({ payload: original.payload, retryable: original.retryable }); setError("还有一份注册结果待核对，请先核对原申请。"); return; }
    requestLock.current = true;
    setSubmitting(true); setError("");
    try {
      const result = await onAction("accountRegister", payload) as AccountRegistrationResult | null;
      if (!alive.current) return;
      if (!result || result.registered !== true || result.username !== payload.username || !["pending", "approved", "rejected"].includes(result.status)) { setUnconfirmed({ payload, retryable: true }); setError("注册结果暂未确认，请先核对申请，再决定是否重试原提交。"); return; }
      completeRegistration(result, payload.requestId);
    } catch (cause) { if (alive.current) { setError((cause as Error).message || "注册未完成，请稍后重试。"); if (isUncertainResult(cause)) setUnconfirmed({ payload, retryable: true }); else { clearRegistration(accountRole, payload.requestId); setUnconfirmed(null); } } }
    finally { requestLock.current = false; if (alive.current) setSubmitting(false); }
  }
  async function checkStatus() {
    if (working || requestLock.current) return;
    const payload = unconfirmed?.payload, validation = payload ? "" : accountError(false);
    if (validation) { setError(validation); return; }
    requestLock.current = true; setSubmitting(true); setError("");
    try {
      const result = await onAction("accountApplicationStatus", { role: accountRole, username: payload?.username || normalizedLogin(username), password: payload?.password || password }) as AccountStatusResult | null;
      if (!alive.current) return;
      if (!result?.application || typeof result.application.username !== "string" || !result.application.username || (payload && result.application.username !== payload.username) || result.application.role !== accountRole || !["pending", "approved", "rejected"].includes(result.application.status)) { setError("暂时未能核对申请，请稍后重试。"); return; }
      const application = result.application;
      if (payload && application.requestId === payload.requestId) completeRegistration({ registered: true, status: application.status, username: application.username, message: `${statusMessage(application.status)}${application.reviewNote ? ` 审核说明：${application.reviewNote}` : ""}` }, payload.requestId);
      else if (payload) { registrationRetryable(accountRole, payload.requestId, false); setUnconfirmed({ payload, retryable: false }); setError("查到的是该账号的另一份申请，不能确认本次注册。已核对账号存在，请返回登录查询该账号状态。"); }
      else setNotice(`${result.message || statusMessage(application.status)}${application.reviewNote ? ` 审核说明：${application.reviewNote}` : ""}`);
    } catch (cause) { if (alive.current) setError(`${(cause as Error).message || "暂时未能核对申请。"}${payload ? " 查询失败不代表注册未保存，请稍后核对或重试原提交。" : ""}`); }
    finally { requestLock.current = false; if (alive.current) setSubmitting(false); }
  }
  async function recordingLogin() {
    if (!recordingShortcutAllowed || locked || recordingBlocked || requestLock.current) return;
    requestLock.current = true; setSubmitting(true); setError(""); setNotice("");
    try {
      const result = await onAction("recordingLogin", { role: accountRole, ...(accountRole === "merchant" ? { storeId: "tea" } : {}) }) as { authenticated?: boolean; role?: AccountRole } | null;
      if (!alive.current) return;
      if (result?.authenticated === true && result.role === accountRole) onDone();
      else { setRecordingBlocked(true); setError("演示登录身份暂未确认，请刷新页面核对登录状态。"); }
    } catch (cause) { if (alive.current) { const uncertain = isUncertainResult(cause); setError(uncertain ? "演示登录结果暂未确认，请刷新页面核对登录状态；本页不会重复发送快捷登录。" : (cause as Error).message || "演示登录未完成，请使用真实账号登录。"); if (uncertain) setRecordingBlocked(true); } }
    finally { requestLock.current = false; if (alive.current) setSubmitting(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked || requestLock.current) return;
    if (mode === "register" && accountRole === "merchant" && step < 2) { advance(); return; }
    const validation = accountError(mode === "register") || (mode === "register" && accountRole === "merchant" ? merchantError(true) : "");
    if (validation) { setError(validation); if (mode === "register" && accountRole === "merchant" && step > 0 && emailProofError(emailProof)) setStep(0); return; }
    if (mode === "login") {
      requestLock.current = true; setSubmitting(true); setError(""); setNotice("");
      try { const result = await onAction(accountRole === "player" ? "accountLogin" : "staffLogin", { role: accountRole, username: normalizedLogin(username), password }) as { authenticated?: boolean; role?: AccountRole } | null; if (alive.current && result?.authenticated === true && result.role === accountRole) onDone(); else if (alive.current) setError("登录身份未能确认，请重新核对账号和密码。"); }
      catch (cause) { if (alive.current) setError((cause as Error).message || "登录未完成，请重新核对账号和密码。"); }
      finally { requestLock.current = false; if (alive.current) setSubmitting(false); }
      return;
    }
    const email = normalizeEmail(emailProof.email);
    const body: Record<string, unknown> = { role: accountRole, username: email, email, emailCode: emailProof.code, emailChallengeId: emailProof.challengeId, password, confirmPassword, ...(nickname.trim() ? { nickname: nickname.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) };
    if (accountRole === "merchant") body.merchant = { name: merchant.name.trim(), address: merchant.address.trim(), floor: merchant.floor.trim(), area: merchant.area.trim(), category: merchant.category.trim(), phone: merchant.phone.trim(), latitude: Number(merchant.latitude), longitude: Number(merchant.longitude), radiusMeters: Number(merchant.radius), coupon: { title: merchant.couponTitle.trim(), type: merchant.couponType, value: merchant.couponType === "gift" ? 0 : Number(merchant.value), minAmount: Number(merchant.minAmount), totalCount: Number(merchant.totalCount), conditions: merchant.conditions.trim(), validStart: merchant.validity === "dates" ? dateValue(merchant.start) : null, validEnd: merchant.validity === "dates" ? dateValue(merchant.end) : null } };
    const signature = JSON.stringify(body);
    if (!registration.current || registration.current.signature !== signature) registration.current = { signature, payload: { ...body, requestId: newRequestId() } };
    await sendRegistration(registration.current.payload);
  }
  const input = (label: string, value: string, change: (value: string) => void, options: { required?: boolean; max?: number; placeholder?: string; type?: string; autoComplete?: string } = {}) => <label className="field-label">{label}<input className="ui-input" aria-label={label} type={options.type || "text"} required={options.required} maxLength={options.max} autoComplete={options.autoComplete} value={value} onChange={event => change(event.target.value)} placeholder={options.placeholder} /></label>;
  const merchantInput = (field: keyof MerchantDraft, label: string, max: number, placeholder?: string, required = true) => input(label, merchant[field], value => setMerchantField(field, value), { required, max, placeholder });
  const symbol = accountRole === "merchant" ? <Store size={30} /> : accountRole === "admin" ? <ShieldCheck size={30} /> : <Compass size={30} />;
  const title = mode === "register" ? `注册${roleName(accountRole)}账号` : accountRole === "merchant" ? "登录商家工作台" : accountRole === "admin" ? "登录运营后台" : explorer ? "登录，留下你的发现" : "登录，继续你的探索";
  return <section className="player-login-card panel account-access" aria-label={`${roleName(accountRole)}账号入口`} aria-busy={working}>
    <div className="login-symbol">{symbol}</div><div className="account-access-intro"><h2>{title}</h2><p>{accountRole === "player" ? "寻宝者与探索者共用一个玩家账号，登录后保存卡包、积分与投放记录。" : accountRole === "merchant" ? "商家账号需单独注册，不能用玩家或运营账号登录。注册时提交门店位置和优惠券，审核通过后管理本店。" : "运营账号需单独注册，不能用玩家或商家账号登录。注册申请由已有运营审核，通过后登录工作台。"}</p></div>
    <div className="account-access-tabs" role="group" aria-label="登录或注册"><button type="button" aria-pressed={mode === "login"} disabled={locked} onClick={() => switchMode("login")}>登录</button><button type="button" aria-pressed={mode === "register"} disabled={locked} onClick={() => switchMode("register")}>注册账号</button></div>
    {notice && <div className="account-access-feedback" role="status"><CheckCircle2 size={18} /><p>{notice}</p></div>}{error && <p className="account-access-error" role="alert">{error}</p>}
    {unconfirmed && <div className="account-access-pending"><strong>先核对注册结果</strong><p>原资料已锁定，请暂时留在此页面。查询失败不代表注册失败；重试只会提交同一申请编号和原资料。</p><div className="account-access-actions"><button type="button" className="outline-button" disabled={working} onClick={() => void checkStatus()}>核对申请状态</button><button type="button" className="outline-button" disabled={working || !unconfirmed.retryable} onClick={() => void sendRegistration(unconfirmed.payload)}>重试原提交</button>{!unconfirmed.retryable && <button type="button" className="text-button" disabled={working} onClick={() => { setUnconfirmed(null); registration.current = null; setMode("login"); setStep(0); setNotice("已查到该用户名的另一份申请；本次注册没有确认。请登录已有账号，或查询其审核状态。"); setError(""); }}>查看已存在的账号</button>}</div></div>}
    {mode === "register" && accountRole === "merchant" && <ol className="account-registration-steps" aria-label="商家注册步骤">{["账号资料", "门店位置", "优惠券"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>}
    <form ref={formRef} id={`${id}-form`} className="account-access-form" noValidate aria-label={mode === "register" ? `${roleName(accountRole)}注册表单` : `${roleName(accountRole)}登录表单`} onSubmit={submit}><fieldset disabled={locked}>
      {(mode === "login" || accountRole !== "merchant" || step === 0) && <div className="account-fields">
        {mode === "login" ? input("邮箱 / 账号", username, setUsername, { required: true, max: 254, autoComplete: "username", placeholder: "注册邮箱或已有账号" }) : <EmailCodeField key={`${accountRole}:register`} role={accountRole} purpose="register" value={emailProof} onChange={setEmailProof} onAction={onAction} busy={busy || submitting || locating || !!unconfirmed} onPendingChange={setEmailBusy} />}
        <label className="field-label">密码<div className="account-password-row"><input className="ui-input" aria-label="密码" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={3} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} placeholder="请输入密码" /><button type="button" className="outline-button account-password-toggle" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        {mode === "register" && <><p className="account-field-hint">邮箱就是你的登录账号；设置一个至少 3 个字符的密码。</p>{input("确认密码", confirmPassword, setConfirmPassword, { required: true, max: 128, type: showPassword ? "text" : "password", autoComplete: "new-password", placeholder: "再输入一次密码" })}{input("昵称（可选）", nickname, setNickname, { max: 24, autoComplete: "nickname", placeholder: "其他人看到的称呼" })}<p className="account-field-hint">留空时使用邮箱 @ 前面的部分作为昵称。</p>{input("联系手机号（可选）", phone, setPhone, { max: 11, type: "tel", autoComplete: "tel", placeholder: "仅用于联系" })}</>}
      </div>}
      {mode === "register" && accountRole === "merchant" && step === 1 && <div className="account-fields">
        <div className="account-section-intro"><h3><MapPin size={18} />门店位置</h3><p>填写实际地址，并在地图上选中门店。也可到店定位或手填真实经纬度。</p></div>
        {merchantInput("name", "门店名称", 60, "填写实际营业名称")}
        <label className="field-label">真实街道地址<textarea className="ui-input" aria-label="真实街道地址" required maxLength={200} rows={2} value={merchant.address} onChange={event => setMerchantField("address", event.target.value)} placeholder="城市、街道、门牌号及商场名称" /></label>
        <div className="account-field-pair">{merchantInput("floor", "楼层", 12, "例如 F1")}{merchantInput("area", "区域 / 铺位", 80, "例如 中庭东侧 101")}</div>
        <div className="account-field-pair">{merchantInput("category", "门店类别", 40, "例如 茶饮、手作")}{merchantInput("phone", "门店电话（可选）", 24, "手机或固定电话", false)}</div>
        <AmapGeofenceMap fence={mapFence} onPick={locked ? undefined : selectCenter} />
        <button type="button" className="outline-button account-location-button" disabled={locked} onClick={async () => { const sequence = ++locationSequence.current; setLocating(true); setError(""); setPositionNotice(""); try { const position = await readBrowserLocation(); if (alive.current && sequence === locationSequence.current) { setMerchant(draft => ({ ...draft, latitude: position.latitude.toFixed(7), longitude: position.longitude.toFixed(7) })); setPositionNotice(`已取得当前位置，定位精度约 ±${Math.ceil(position.accuracy)} 米。请核对是否为实际门店。`); } } catch (cause) { if (alive.current && sequence === locationSequence.current) setError((cause as Error).message); } finally { if (alive.current && sequence === locationSequence.current) setLocating(false); } }}><LocateFixed size={18} />{locating ? "正在定位…" : "使用门店当前位置"}</button>
        {positionNotice && <p className="account-field-hint" role="status">{positionNotice}</p>}
        <div className="account-field-pair"><label className="field-label">纬度（WGS84）<input className="ui-input" aria-label="门店纬度" type="number" inputMode="decimal" min={-90} max={90} step="any" required value={merchant.latitude} onChange={event => setMerchantField("latitude", event.target.value)} placeholder="点选地图、定位或填写" /></label><label className="field-label">经度（WGS84）<input className="ui-input" aria-label="门店经度" type="number" inputMode="decimal" min={-180} max={180} step="any" required value={merchant.longitude} onChange={event => setMerchantField("longitude", event.target.value)} placeholder="点选地图、定位或填写" /></label></div>
        <label className="field-label">到店范围半径（米）<input className="ui-input" aria-label="到店范围半径" type="number" min={20} max={5000} step={1} required value={merchant.radius} onChange={event => setMerchantField("radius", event.target.value)} /></label><p className="account-field-hint">地图点选会转换为 WGS84。范围用于到店确认；楼层信息需要另外核对。</p>
      </div>}
      {mode === "register" && accountRole === "merchant" && step === 2 && <div className="account-fields">
        <div className="account-section-intro"><h3>首张优惠券</h3><p>门店审核通过后，这张券会成为本店的奖励模板。请填写真实可提供的优惠。</p></div>{merchantInput("couponTitle", "优惠券名称", 80, "例如 饮品免费加料券")}
        <label className="field-label">优惠券类型<select className="ui-input" aria-label="优惠券类型" value={merchant.couponType} onChange={event => { setMerchantField("couponType", event.target.value as MerchantDraft["couponType"]); setMerchantField("value", ""); }}><option value="gift">赠礼券</option><option value="cash">代金券</option><option value="discount">折扣券</option></select></label>
        {merchant.couponType !== "gift" && <label className="field-label">{merchant.couponType === "cash" ? "面额（元）" : "折扣（折）"}<input className="ui-input" aria-label="优惠券面值" type="number" step={merchant.couponType === "cash" ? .01 : .1} min={merchant.couponType === "cash" ? .01 : .1} max={merchant.couponType === "cash" ? 1_000_000 : 9.9} required value={merchant.value} onChange={event => setMerchantField("value", event.target.value)} placeholder={merchant.couponType === "cash" ? "例如 10" : "例如 8.5，表示八五折"} /></label>}
        <div className="account-field-pair"><label className="field-label">最低消费（元）<input className="ui-input" aria-label="优惠券最低消费" type="number" min={0} max={1_000_000} step={.01} required value={merchant.minAmount} onChange={event => setMerchantField("minAmount", event.target.value)} /></label><label className="field-label">可发放数量<input className="ui-input" aria-label="优惠券数量" type="number" min={1} max={100_000} step={1} required value={merchant.totalCount} onChange={event => setMerchantField("totalCount", event.target.value)} placeholder="填写可提供的份数" /></label></div>
        <label className="field-label">使用条件<textarea className="ui-input" aria-label="优惠券使用条件" rows={4} required maxLength={500} value={merchant.conditions} onChange={event => setMerchantField("conditions", event.target.value)} placeholder="说明购买要求、适用品类及其他限制" /></label>
        <label className="field-label">有效期<select className="ui-input" aria-label="优惠券有效期" value={merchant.validity} onChange={event => setMerchantField("validity", event.target.value as MerchantDraft["validity"])}><option value="always">长期有效</option><option value="dates">指定开始和结束时间</option></select></label>
        {merchant.validity === "dates" && <div className="account-field-pair"><label className="field-label">开始时间（北京时间）<input className="ui-input" aria-label="优惠券开始时间" type="datetime-local" step={60} required value={merchant.start} onChange={event => setMerchantField("start", event.target.value)} /></label><label className="field-label">结束时间（北京时间）<input className="ui-input" aria-label="优惠券结束时间" type="datetime-local" step={60} required value={merchant.end} onChange={event => setMerchantField("end", event.target.value)} /></label></div>}
      </div>}
    </fieldset>{mode === "register" && accountRole !== "player" && <p className="account-field-hint">注册申请审核通过前，账号无法登录工作台。可在登录页查询审核状态。</p>}<div className="account-access-actions">{mode === "register" && accountRole === "merchant" && step > 0 && <button type="button" className="outline-button" disabled={locked} onClick={() => { setStep(value => value - 1); setError(""); }}>上一步</button>}{mode === "register" && accountRole === "merchant" && step < 2 ? <button type="button" className="gold-button" disabled={locked} onClick={event => { event.preventDefault(); advance(); }}>下一步</button> : <button type="submit" className="gold-button" disabled={locked}>{submitting ? "正在提交…" : mode === "register" ? <><UserPlus size={18} />{accountRole === "player" ? "注册账号" : "提交注册申请"}</> : accountRole === "player" ? "登录并继续" : "登录工作台"}</button>}</div></form>
    {mode === "login" && accountRole !== "player" && !unconfirmed && <button type="button" className="text-button account-status-button" disabled={working} onClick={() => void checkStatus()}>查询注册审核状态</button>}
    {mode === "login" && recordingShortcutAllowed && !unconfirmed && <div className="account-recording-shortcut"><p className="account-field-hint">录制演示入口；自己的账号请使用上方账号密码登录。</p><button type="button" className="outline-button" disabled={working || recordingBlocked} onClick={() => void recordingLogin()}>快捷演示登录</button></div>}
    {onBack && <div className="account-access-footer"><button type="button" className="text-button" disabled={locked} onClick={onBack}>返回角色入口</button></div>}
  </section>;
}
