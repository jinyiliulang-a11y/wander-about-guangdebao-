"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Gift,
  ImagePlus,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Store } from "@/lib/game-types";
import type { CreatorDraftOptions, CreatorDraftStatus } from "@/lib/creator-draft-types";
import "./creator-draft-status.css";

export type CreatorOptions = CreatorDraftOptions;
type CreatorTemplate = {
  id: string;
  storeId: string;
  title: string;
  status: string;
  remaining: number;
  validStart: number | string | null;
  validEnd: number | string | null;
};
type CreatorSettings = {
  dailyLimit: number;
  clueCosts: number[];
  contributionRatio: number;
  ugcReview: boolean;
};

type Props = {
  stores: Store[];
  storeId: string;
  title: string;
  clues: string[];
  busy: boolean;
  onStore: (id: string) => void;
  onTitle: (title: string) => void;
  onClues: (clues: string[]) => void;
  onExample: () => void;
  settings?: CreatorSettings;
  dailyQuota?: { used: number; limit: number; remaining: number };
  couponTemplates?: CreatorTemplate[];
  initialOptions?: Partial<CreatorOptions>;
  options?: CreatorOptions;
  onOptionsChange?: (options: CreatorOptions) => void;
  step?: 0 | 1 | 2;
  onStepChange?: (step: 0 | 1 | 2) => void;
  draftStatus?: CreatorDraftStatus;
  draftMessage?: string;
  onDraftRetry?: () => void;
  onDraftReload?: () => void;
  onSubmit: (options: CreatorOptions) => Promise<void | boolean>;
};

export function CreatorWizard({
  stores,
  storeId,
  title,
  clues,
  busy,
  onStore,
  onTitle,
  onClues,
  onExample,
  onSubmit,
  settings,
  dailyQuota,
  couponTemplates = [],
  initialOptions,
  options: controlledOptions,
  onOptionsChange,
  step: controlledStep,
  onStepChange,
  draftStatus,
  draftMessage,
  onDraftRetry,
  onDraftReload,
}: Props) {
  const [localStep, setLocalStep] = useState<0 | 1 | 2>(0);
  const step = controlledStep ?? localStep;
  function setStep(value: number) {
    const next = Math.max(0, Math.min(2, value)) as 0 | 1 | 2;
    if (onStepChange) onStepChange(next);
    else setLocalStep(next);
  }
  const [error, setError] = useState("");
  const [localOptions, setLocalOptions] = useState<CreatorOptions>(() => ({ difficulty: initialOptions?.difficulty ?? 3, rewardType: initialOptions?.rewardType ?? "points", rewardValue: initialOptions?.rewardValue ?? 50, rewardCouponId: initialOptions?.rewardCouponId ?? null, expiresAt: initialOptions?.expiresAt ?? null, photoURLs: initialOptions?.photoURLs ?? ["", "", "", "", ""] }));
  const options = controlledOptions ?? localOptions;
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; }, [options]);
  function updateOptions(patch: Partial<CreatorOptions>) {
    const next = { ...optionsRef.current, ...patch };
    optionsRef.current = next;
    if (onOptionsChange) onOptionsChange(next);
    else setLocalOptions(next);
  }
  const { difficulty, rewardType, rewardValue, photoURLs } = options;
  const rewardCouponId = options.rewardCouponId ?? "";
  const expiryDate = options.expiresAt === null ? null : new Date(options.expiresAt);
  const localExpiryDate = expiryDate && Number.isFinite(expiryDate.getTime()) ? new Date(expiryDate.getTime() - expiryDate.getTimezoneOffset() * 60_000) : null;
  const invalidExpiry = options.expiresAt !== null && (!localExpiryDate || !Number.isFinite(localExpiryDate.getTime()) || localExpiryDate.getUTCFullYear() < 1 || localExpiryDate.getUTCFullYear() > 9999);
  const expiry = localExpiryDate && !invalidExpiry ? localExpiryDate.toISOString().slice(0, 16) : "";
  const setDifficulty = (difficulty: number) => updateOptions({ difficulty });
  const setRewardType = (rewardType: "points" | "coupon") => updateOptions({ rewardType });
  const setRewardValue = (rewardValue: number) => updateOptions({ rewardValue });
  const setRewardCouponId = (rewardCouponId: string) => updateOptions({ rewardCouponId: rewardCouponId || null });
  const setExpiry = (expiry: string) => {
    const timestamp = expiry ? new Date(expiry).getTime() : null;
    if (timestamp !== null && !Number.isFinite(timestamp)) { setError("截止时间需重新选择"); return; }
    updateOptions({ expiresAt: timestamp });
    setError("");
  };
  const setPhotoURLs = (photoURLs: string[]) => updateOptions({ photoURLs });
  const photoValues = useRef(photoURLs);
  const photoReads = useRef([0, 0, 0, 0, 0]);
  useEffect(() => {
    if (photoValues.current.length !== photoURLs.length || photoValues.current.some((value, index) => value !== photoURLs[index])) {
      photoReads.current = photoReads.current.map(value => value + 1);
    }
    photoValues.current = photoURLs;
  }, [photoURLs]);
  useEffect(() => () => { photoReads.current = photoReads.current.map(value => value + 1); }, []);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const store = stores.find((s) => s.id === storeId);
  const dailyLimit = dailyQuota?.limit ?? settings?.dailyLimit ?? 5;
  const clueCosts = settings?.clueCosts || [0, 0, 10, 20, 30];
  const ratio = settings?.contributionRatio ?? 0.2;
  const reviewRequired = settings?.ugcReview !== false;
  const templates = couponTemplates.filter(template => {
    const start = template.validStart ? new Date(template.validStart).getTime() : 0;
    const end = template.validEnd ? new Date(template.validEnd).getTime() : Infinity;
    return template.storeId === storeId && template.status === "active" && template.remaining > 0 && start <= now && end > now;
  });
  const coupon = templates.find(template => template.id === rewardCouponId);
  const quotaEmpty = dailyQuota?.remaining === 0;

  function readPhoto(index: number, file?: File) {
    const sequence = ++photoReads.current[index];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 190 * 1024) {
      setError("请选择不超过190KB的JPEG、PNG或WebP照片");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (photoReads.current[index] !== sequence || typeof reader.result !== "string") return;
      const url = reader.result;
      const next = photoValues.current.map((value, i) => i === index ? url : value);
      if (url.length > 256 * 1024 || next.reduce((sum, value) => sum + value.length, 0) > 768 * 1024) {
        setError("照片总量过大，请缩小图片或移除一张再试");
        return;
      }
      photoValues.current = next;
      setPhotoURLs(next);
      setError("");
    };
    reader.onerror = () => { if (photoReads.current[index] === sequence) setError("照片读取失败，请重新选择"); };
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (invalidExpiry) return setError("截止时间需重新选择");
    if (!store || store.status === "inactive") return setError("原门店当前不可用，请返回选择活动门店");
    if (title.trim().length < 4 || title.trim().length > 40 || clues.length !== 5 || clues.some(clue => clue.trim().length < 4 || clue.trim().length > 160)) return setError("请返回编写线索，检查标题与五条线索");
    const expiresAt = expiry ? new Date(expiry).getTime() : null;
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) return setError("请选择未来的任务截止时间");
    if (rewardType === "coupon" && !coupon) return setError("请选择本店当前可发放的优惠券");
    if (quotaEmpty) return setError("今日投稿额度已用完，请明天再试");
    setError("");
    await onSubmit({ difficulty, expiresAt, rewardType, rewardValue: rewardType === "points" ? rewardValue : 50, rewardCouponId: rewardType === "coupon" ? rewardCouponId : null, photoURLs });
  }
  function next() {
    if (!store || store.status === "inactive") return setError("先选一个活动门店吧");
    if (
      step === 1 &&
      (title.trim().length < 4 ||
        title.trim().length > 40 ||
        clues.some((c) => c.trim().length < 4 || c.trim().length > 160))
    )
      return setError("请填写4至40字的标题，以及五条4至160字的线索");
    setError("");
    setStep(step + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return (
    <div className="creator-layout reference-creator">
      <form
        className="surface creator-form wizard-form drop-form drop-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (step < 2) return next();
          await submit();
        }}
      >
        <div className="creator-drop-topline">
          <p className="eyebrow">CREATE A SURPRISE</p>
          {dailyQuota && <span className="balance">今日剩余 {dailyQuota.remaining} 次</span>}
        </div>
        {draftStatus && draftStatus !== "idle" && <div className="creator-draft-status" data-state={draftStatus} role={draftStatus === "error" || draftStatus === "conflict" ? "alert" : "status"}>
          <span>{draftMessage || ({ loading: "正在加载你的草稿…", saving: "正在保存草稿，请等待保存完成后再刷新", saved: "草稿已保存，刷新或返回后可继续编辑", error: "草稿暂未保存，内容仍在当前页面，请重试", conflict: "草稿已在其他页面更新，请加载服务器草稿后继续" } as const)[draftStatus]}</span>
          {draftStatus === "error" && onDraftRetry && <button type="button" className="outline-button" disabled={busy} onClick={onDraftRetry}>重试保存</button>}
          {draftStatus === "conflict" && onDraftReload && <button type="button" className="outline-button" disabled={busy} onClick={onDraftReload}>加载服务器草稿</button>}
        </div>}
        <div className="wizard-progress stepper" aria-label="投放进度">
          {["选择店铺", "编写线索", "设置奖励"].map((label, i) => (
            <div
              key={label}
              className={`stepper-step${i <= step ? " active" : ""}${i < step ? " completed" : ""}`}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="step-circle">{i < step ? <Check size={15} /> : String(i + 1).padStart(2, "0")}</span>
              <b className="step-label">{label}</b>
            </div>
          ))}
        </div>
        <fieldset className="creator-input-fields" disabled={busy}>
        {step === 0 && (
          <section className="wizard-step drop-step" aria-label="选择门店">
            <div className="form-section-label form-title">
              <span>01</span>
              <div>
                <b role="heading" aria-level={2}>选一个值得发现的地方</b>
                <small>从活动门店中，挑一个你想推荐的角落。</small>
              </div>
            </div>
            <div className="store-options drop-store-options">
              {stores.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className={`drop-store-option${storeId === s.id ? " selected" : ""}`}
                  onClick={() => onStore(s.id)}
                  aria-pressed={storeId === s.id}
                >
                  <div
                    className="store-art"
                    style={{ backgroundPosition: `${s.artwork * 50}% center` }}
                    role="img"
                    aria-label={s.category}
                  />
                  <span>
                    <b>{s.name}</b>
                    <small>
                      {s.floor} · {s.category}
                    </small>
                  </span>
                  <span className="radio-check">
                    {storeId === s.id && <Check size={13} />}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {step === 1 && (
          <section className="wizard-step drop-step" aria-label="编写线索">
            <div className="form-section-label form-title">
              <span>02</span>
              <div>
                <b role="heading" aria-level={2}>用五条线索，把发现留给别人</b>
                <small>从大致方向，慢慢引向场景细节。</small>
              </div>
            </div>
            <div className="wizard-store-chip">
              <span className="pill">
                {store?.name} · {store?.floor}
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => setStep(0)}
              >
                更换门店
              </button>
            </div>
            <label className="field-label drop-field">
              宝藏标题
              <input
                minLength={4}
                maxLength={40}
                value={title}
                onChange={(e) => onTitle(e.target.value)}
                placeholder="例如：一封写给未来的信"
              />
            </label>
            <div className="clue-form-heading drop-clue-heading">
              <span>五条线索 · 照片可选</span>
              <button type="button" className="text-button" onClick={onExample}>
                填入示例再修改
              </button>
            </div>
            {clues.map((c, i) => (
              <div className="clue-input drop-clue-card" key={i}>
                <span className="drop-clue-number">{String(i + 1).padStart(2, "0")}</span>
                <textarea
                  minLength={4}
                  maxLength={160}
                  rows={2}
                  value={c}
                  aria-label={`线索${i + 1}`}
                  onChange={(e) =>
                    onClues(clues.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  placeholder={
                    [
                      "给一个大方向，保留一点悬念",
                      "缩小范围，例如楼层或区域",
                      "引导观察店铺的一个特征",
                      "提醒注意商品或环境细节",
                      "引导用户找到观察题答案",
                    ][i]
                  }
                />
                <div className="creator-photo drop-photo-field">
                  <small>{clueCosts[i] ? `${clueCosts[i]}积分解锁` : "免费线索"}</small>
                  <label className="field-label"><ImagePlus size={16} /> 添加照片（可选）<input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`线索${i + 1}照片`} disabled={busy} onChange={event => { readPhoto(i, event.target.files?.[0]); event.target.value = ""; }} /></label>
                  {photoURLs[i] && <><Image src={photoURLs[i]} unoptimized width={640} height={480} alt={`线索${i + 1}照片预览`} /><button type="button" className="text-button" disabled={busy} onClick={() => { photoReads.current[i]++; const next = photoValues.current.map((value, index) => index === i ? "" : value); photoValues.current = next; setPhotoURLs(next); }}>移除照片</button></>}
                </div>
              </div>
            ))}
          </section>
        )}
        {step === 2 && (
          <section className="wizard-step drop-step" aria-label="设置奖励">
            <div className="form-section-label form-title">
              <span>03</span>
              <div>
                <b role="heading" aria-level={2}>确认这次发现的奖励</b>
                <small>设置奖励与截止时间，提交前再检查一次。</small>
              </div>
            </div>
            <p className="muted">
              选择积分奖励或本店可用优惠券。奖励为比赛演示资源，仍须遵守每店一券和库存规则。
            </p>
            <div className="creator-options drop-options">
              <label className="field-label">寻宝难度<select aria-label="寻宝难度" value={difficulty} onChange={event => setDifficulty(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}星</option>)}</select></label>
              <label className="field-label">任务截止时间（可选）<input type="datetime-local" aria-label="任务截止时间" value={expiry} onChange={event => setExpiry(event.target.value)} /><small>{invalidExpiry ? "截止时间需重新选择" : "按当前设备时间填写，留空则不设置截止时间。"}</small></label>
              <div className="choice-row drop-reward-types" aria-label="奖励类型"><button type="button" className={`outline-button${rewardType === "points" ? " active" : ""}`} aria-pressed={rewardType === "points"} onClick={() => setRewardType("points")}>积分奖励</button><button type="button" className={`outline-button${rewardType === "coupon" ? " active" : ""}`} aria-pressed={rewardType === "coupon"} onClick={() => setRewardType("coupon")}>本店优惠券</button></div>
              {rewardType === "points" ? <div className="drop-amount-field"><div className="form-title"><span><Gift size={16} /></span><div><b>选择积分数量</b><small>每次投放10至500积分，可用滑块调整。</small></div></div><div className="amount-options" aria-label="快捷选择积分奖励">{[10, 20, 50, 100].map(value => <button type="button" key={value} className={rewardValue === value ? "active" : ""} aria-pressed={rewardValue === value} disabled={busy} onClick={() => setRewardValue(value)}>{value}</button>)}</div><label className="field-label">积分奖励：{rewardValue}<input type="range" min={10} max={500} step={10} aria-label="积分奖励" value={rewardValue} onChange={event => setRewardValue(Number(event.target.value))} /></label></div> : <label className="field-label">本店优惠券<select aria-label="奖励优惠券" value={rewardCouponId} onChange={event => setRewardCouponId(event.target.value)}><option value="">请选择优惠券</option>{templates.map(template => <option key={template.id} value={template.id}>{template.title} · 剩余{template.remaining}</option>)}</select>{!templates.length && <small>本店暂没有可发放的优惠券，可选择积分奖励。</small>}</label>}
              <p className="muted">预计每次成功领奖贡献：{Math.floor((rewardType === "points" ? rewardValue : 50) * ratio)}积分，以实际发放记录为准。</p>
            </div>
            <div className="creator-reward drop-reward-preview">
              <Gift size={24} />
              <div>
                <strong>{rewardType === "points" ? `${rewardValue}积分` : coupon?.title || "请选择优惠券"}</strong>
                <p>{store?.conditions}</p>
              </div>
              <span className="pill">{rewardType === "points" ? "积分奖励" : "门店券"}</span>
            </div>
            <div className="wizard-review drop-review">
              <h3>{title}</h3>
              <p>{store?.name} · 五条线索已完成 · {difficulty}星</p>
              <ol>
                {clues.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ol>
              <div>
                <Sparkles size={17} />
                <span>每有一位玩家首次成功领奖，贡献按奖励与活动系数计算。</span>
              </div>
            </div>
          </section>
        )}
        </fieldset>
        {error && (
          <p className="wizard-error" role="alert">
            {error}
          </p>
        )}
        <div className="wizard-actions drop-actions">
          <button
            type="button"
            className="outline-button"
            disabled={step === 0 || busy}
            onClick={() => {
              setStep(step - 1);
              setError("");
            }}
          >
            <ArrowLeft size={16} />
            上一步
          </button>
          <span>{step + 1} / 3</span>
          {step < 2 ? (
            <button type="submit" className="gold-button primary-button" disabled={busy}>
              下一步
              <ArrowRight size={16} />
            </button>
          ) : (
            <button type="submit" className="gold-button primary-button" disabled={busy || quotaEmpty}>
              {busy ? "正在提交…" : "提交宝藏"}
              <Send size={16} />
            </button>
          )}
        </div>
        <p className="wizard-safety">
          <ShieldCheck size={15} />
          {reviewRequired ? "审核通过后，才会出现在公开地图上。" : "当前活动关闭人工审核，符合条件的投稿直接发布。"}
        </p>
      </form>
      <aside className="creator-tips surface drop-tips">
        <Sparkles size={27} />
        <h2>好线索，让人想多看一眼</h2>
        {[
          ["先留悬念", "第一条别直接报出店名，让寻找保留乐趣。"],
          ["指向真实细节", "招牌、菜单和陈列，都能成为新的发现。"],
          ["不要求消费", "观察题无需购买商品，奖励条件提前说明。"],
        ].map(([h, p], i) => (
          <div key={h}>
            <span>0{i + 1}</span>
            <h3>{h}</h3>
            <p>{p}</p>
          </div>
        ))}
        <div className="tips-footer">
          每个自然日（北京时间）最多提交{dailyLimit}条任务。{dailyQuota && `今天剩余${dailyQuota.remaining}条。`}投稿表单返回上一步也不会丢失。
        </div>
      </aside>
    </div>
  );
}
