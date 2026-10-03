"use client";

import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { GameApiError, isGameApiError, isUncertainResult } from "@/lib/game-api";
import type { AccountRole } from "@/lib/account-types";
import "./email-login-access.css";

type EmailPurpose = "register";
type Action = (action: string, payload: Record<string, unknown>) => Promise<unknown>;
export type EmailProof = { email: string; code: string; challengeId: string; expiresAt: number };
type SendIntent = { requestId: string; payload: Record<string, unknown>; retryAt: number; uncertain: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sendMemoryKey = Symbol.for("mall-quest.email-code-intent.v2334");
export const emptyEmailProof = (): EmailProof => ({ email: "", code: "", challengeId: "", expiresAt: 0 });
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const validEmailAddress = (value: string) => value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value);
export function emailProofError(value: EmailProof) {
  const email = normalizeEmail(value.email);
  if (!validEmailAddress(email)) return "请填写完整的邮箱地址。";
  if (!UUID.test(value.challengeId) || value.expiresAt <= Date.now()) return "请先获取新的邮箱验证码。";
  if (!/^\d{6}$/.test(value.code)) return "请填写邮件中的 6 位数字验证码。";
  return "";
}
function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function sendMemory() {
  if (typeof window === "undefined") return null;
  const target = window as unknown as Record<symbol, Map<string, SendIntent> | undefined>;
  if (!target[sendMemoryKey]) Object.defineProperty(window, sendMemoryKey, { value: new Map<string, SendIntent>(), configurable: true });
  return target[sendMemoryKey]!;
}

type CodeFieldProps = { role: AccountRole; purpose: EmailPurpose; value: EmailProof; onChange: (value: EmailProof) => void; onAction: Action; busy?: boolean; onPendingChange?: (pending: boolean) => void };
/** Required registration email verification. Credentials and codes stay in volatile page memory. */
export function EmailCodeField({ role, purpose, value, onChange, onAction, busy = false, onPendingChange }: CodeFieldProps) {
  const [sending, setSending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true), lock = useRef(false), sequence = useRef(0);
  const email = normalizeEmail(value.email), scope = `${role}:${purpose}:${email}`;
  const saved = sendMemory()?.get(scope), seconds = Math.max(0, Math.ceil(((saved?.retryAt || 0) - now) / 1000));
  useEffect(() => {
    const callSequence = sequence;
    alive.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => { alive.current = false; callSequence.current++; window.clearInterval(timer); };
  }, []);
  useEffect(() => { onPendingChange?.(sending); }, [sending, onPendingChange]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  useEffect(() => { sequence.current++; }, [scope]);
  async function send() {
    if (lock.current || sending || busy || seconds > 0) return;
    if (!validEmailAddress(email)) { setError("请填写完整的邮箱地址后获取验证码。"); return; }
    lock.current = true; setSending(true); setError(""); setNotice("");
    const callSequence = ++sequence.current, prior = sendMemory()?.get(scope);
    const original = prior?.uncertain ? prior : { requestId: requestId(), payload: {} as Record<string, unknown>, retryAt: 0, uncertain: false };
    const payload = prior?.uncertain ? prior.payload : Object.freeze({ role, email, purpose, requestId: original.requestId });
    const submitted = { ...original, payload, retryAt: Date.now() + 60_000, uncertain: true };
    sendMemory()?.set(scope, submitted); setNow(Date.now());
    try {
      const result = await onAction("emailCodeSend", payload) as { challengeId?: string; expiresAt?: number; retryAfter?: number; message?: string } | null;
      if (!result || result.challengeId !== submitted.requestId || !UUID.test(result.challengeId) || !Number.isFinite(result.expiresAt) || Number(result.expiresAt) <= Date.now() || !Number.isFinite(result.retryAfter) || Number(result.retryAfter) < 0 || Number(result.retryAfter) > 300)
        throw new GameApiError("发码结果暂未确认，请稍后重试原请求。", { kind: "invalid-response", method: "POST", requestSent: true, resultUncertain: true });
      sendMemory()?.set(scope, { ...submitted, uncertain: false, retryAt: Date.now() + Math.max(60, Number(result.retryAfter)) * 1000 });
      if (!alive.current || sequence.current !== callSequence) return;
      onChange({ email: value.email, code: "", challengeId: result.challengeId, expiresAt: Number(result.expiresAt) });
      setNotice(result.message || "验证码已发送，请查看收件箱及垃圾邮件。");
    } catch (failure) {
      const uncertain = isUncertainResult(failure) || !isGameApiError(failure);
      sendMemory()?.set(scope, { ...submitted, uncertain });
      if (alive.current && sequence.current === callSequence) setError(uncertain ? "发码结果暂未确认；一分钟后可重试原请求，本页不会自动重复发送。" : failure instanceof Error ? failure.message : "暂时无法发送邮件，请稍后再试。");
    } finally { lock.current = false; if (alive.current) { setSending(false); setNow(Date.now()); } }
  }
  const disabled = busy || sending;
  return <div className="email-code-fields" aria-busy={sending}>
    <label className="field-label">邮箱<input className="ui-input" type="email" aria-label="邮箱" required autoComplete="email" maxLength={254} disabled={disabled} value={value.email} onChange={event => { setError(""); setNotice(""); onChange({ email: event.target.value, code: "", challengeId: "", expiresAt: 0 }); }} placeholder="例如 name@example.com" /></label>
    <p className="account-field-hint">验证这个邮箱后，即可用邮箱和密码登录。</p>
    <div className="email-code-row"><label className="field-label">邮箱验证码<input className="ui-input" aria-label="邮箱验证码" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={disabled || !value.challengeId} value={value.code} onChange={event => onChange({ ...value, code: event.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="6 位数字" /></label><button type="button" className="outline-button email-code-send" disabled={disabled || seconds > 0} onClick={() => void send()}><Mail size={17} />{sending ? "正在发送…" : seconds > 0 ? `${seconds} 秒后重试` : saved?.uncertain ? "重试原发码请求" : "获取验证码"}</button></div>
    {value.challengeId && value.expiresAt <= now && <p className="account-field-hint" role="status">验证码已到期，请重新获取。</p>}
    {notice && <p className="email-code-notice" role="status">{notice}</p>}{error && <p className="email-code-error" role="alert">{error}</p>}
  </div>;
}
