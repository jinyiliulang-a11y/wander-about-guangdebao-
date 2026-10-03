"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CheckCircle2, Edit3, RefreshCw, Save, Trash2 } from "lucide-react";
import { isGameApiError, isUncertainResult } from "@/lib/game-api";
import type { MerchantProfileDraftForm } from "@/lib/merchant-profile-draft-types";
import { useMerchantProfileDraft } from "@/hooks/use-merchant-profile-draft";
import type { WorkbenchAction, WorkbenchData, WorkbenchStore } from "./workbench-pages";
import { StoreImage, StoreImagePicker } from "./store-image";
import { StoreIconField } from "./common/StoreIconField";
import "./merchant-profile-editor.css";

export type MerchantProfileEditorProps = {
  store: WorkbenchStore; operatorId: string; onAction: WorkbenchAction; busy?: boolean;
  onEditingChange?: (locked: boolean) => void;
  registerCloseGuard?: (guard: (() => Promise<boolean>) | null) => void;
  onBack?: () => void;
};
function fromStore(store: WorkbenchStore): MerchantProfileDraftForm {
  return { name: store.name, logo: store.logo || "", category: store.category, floor: store.floor, address: store.address || store.area,
    phone: store.phone || "", imageURL: store.imageURL || "", artwork: Number.isInteger(store.artwork) ? ((store.artwork % 3) + 3) % 3 : 0,
    expectedImageRevision: store.imageRevision || 0 };
}
type OfficialIntent = Readonly<{ form: Readonly<MerchantProfileDraftForm>; draftRevision: number }>;

export function MerchantStoreProfileEditor({ store, operatorId, onAction, busy = false, onEditingChange, registerCloseGuard, onBack }: MerchantProfileEditorProps) {
  const [editing, setEditing] = useState<boolean | null>(null), [imageBusy, setImageBusy] = useState(false), [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [deleteConfirm, setDeleteConfirm] = useState(false);
  const [unresolved, setUnresolved] = useState<OfficialIntent | null>(null), [checked, setChecked] = useState(false), [checking, setChecking] = useState(false);
  const officialLock = useRef(false), checkLock = useRef(false), alive = useRef(true);
  const formId = useId(), formElement = useRef<HTMLFormElement>(null);
  const sectionElement = useRef<HTMLElement>(null), [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const draft = useMerchantProfileDraft({ storeId: store.id, operatorId, initialForm: fromStore(store), enabled: editing !== false && !saving && !preparing && !unresolved && !checking });
  const isEditing = editing ?? !!(draft.state.draft || draft.pending);
  const locked = busy || saving || preparing || imageBusy || !!unresolved || checking;
  const unknownDraft = !!draft.pending && !draft.writing;
  const fieldLocked = locked || draft.loading || !draft.ready || unknownDraft || !!draft.conflict;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setToolbarSlot(sectionElement.current?.closest(".merchant-info-drawer-content")?.querySelector<HTMLElement>("[data-merchant-profile-toolbar]") || null); }, []);
  useEffect(() => { onEditingChange?.(locked || unknownDraft); }, [locked, unknownDraft, onEditingChange]);
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);
  const closeGuard = useCallback(async () => {
    // A read-only open has nothing new to persist. A failed initial read must
    // not trap the user; an unresolved previous write still blocks dismissal.
    if (!locked && !draft.ready && !draft.pending && !draft.dirty) return true;
    if (locked || !draft.ready || unknownDraft || draft.conflict) {
      setError(locked ? "请等待图片或正式保存完成，未知结果需先核对。" : "草稿尚未保存，请先核对草稿状态再退出。"); return false;
    }
    const saved = await draft.flush();
    if (!saved && alive.current) setError("草稿尚未确认保存，当前表单已保留。请核对或重试后再退出。");
    return saved;
  }, [locked, unknownDraft, draft]);
  useEffect(() => { registerCloseGuard?.(closeGuard); return () => registerCloseGuard?.(null); }, [closeGuard, registerCloseGuard]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!unresolved && !saving && !imageBusy) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [unresolved, saving, imageBusy]);

  const finishOfficial = async (intent: OfficialIntent, text: string) => {
    if (!alive.current) return;
    setUnresolved(null); setChecked(false); setEditing(false); setNotice(text); setError("");
    draft.resetBase({ ...intent.form, expectedImageRevision: intent.form.expectedImageRevision + 1 });
    if (!await draft.remove(intent.draftRevision) && alive.current) setNotice(text + " 原资料草稿尚未清理，请核对；其他窗口的新草稿不会被覆盖或删除。");
  };
  const submitOfficial = async (intent: OfficialIntent) => {
    if (!alive.current || saving || busy) return;
    setSaving(true); setError(""); setNotice(""); setChecked(false);
    try {
      const result = await onAction("merchantProfileSave", { ...intent.form });
      if (result === null || result === undefined) throw new Error("正式保存结果尚未确认，请先核对原保存。");
      if (alive.current) await finishOfficial(intent, "门店资料与图片已保存。");
    } catch (cause) {
      if (!alive.current) return;
      if (isUncertainResult(cause) || !isGameApiError(cause)) setUnresolved(intent);
      else setUnresolved(null);
      setError(cause instanceof Error ? cause.message : "正式保存结果尚未确认。");
    } finally { if (alive.current) setSaving(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (officialLock.current || fieldLocked || draft.busy) return;
    const form = draft.form;
    if (form.name.trim().length < 2 || !form.logo.trim() || !form.category.trim() || !form.floor.trim() || form.address.trim().length < 2) { setError("请填写门店图标、类别和楼层；门店名称与地址至少两字。"); return; }
    if (form.phone.trim() && !/^[+\d\s()-]+$/.test(form.phone.trim())) { setError("联系电话只接受数字、空格、括号、加号和短横线。"); return; }
    officialLock.current = true; setPreparing(true);
    try {
      if (!await draft.flush()) { setError("请先确认草稿保存状态，再正式保存资料。"); return; }
      if (!alive.current) return;
      const latest = draft.snapshot(), form = latest.form;
      const intent = Object.freeze({ form: Object.freeze({ ...form, name: form.name.trim(), logo: form.logo, category: form.category.trim(), floor: form.floor.trim(), address: form.address.trim(), phone: form.phone.trim() }), draftRevision: latest.state.revision });
      await submitOfficial(intent);
    } finally { officialLock.current = false; if (alive.current) setPreparing(false); }
  };
  const checkSaved = async () => {
    if (!unresolved || checkLock.current || busy || saving) return;
    checkLock.current = true; setChecking(true);
    try {
      const current = await onAction("workbenchState", {}) as WorkbenchData | null, saved = current?.store;
      if (!alive.current) return;
      if (!saved || saved.id !== store.id || current?.scope.role !== "merchant") throw new Error("门店身份或查询结果已改变，请回到原商家账号核对。");
      const payload = unresolved.form;
      const matches = (Object.keys(payload) as (keyof MerchantProfileDraftForm)[]).every(key => key === "expectedImageRevision" ? saved.imageRevision === payload.expectedImageRevision + 1
        : key === "imageURL" ? (saved.imageURL || "") === payload.imageURL : saved[key as Exclude<keyof MerchantProfileDraftForm, "expectedImageRevision">] === payload[key]);
      if (matches) await finishOfficial(unresolved, "原保存结果已核对，门店资料与图片已更新。");
      else { setChecked(true); setError("当前资料尚未匹配原保存。可再次核对，或明确重试原参数；不会自动覆盖新资料。"); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "原保存结果尚待核对。"); }
    finally { checkLock.current = false; if (alive.current) setChecking(false); }
  };
  const removeDraft = async () => {
    if (fieldLocked || draft.busy) return;
    if (await draft.remove()) { setDeleteConfirm(false); setEditing(false); setError(""); setNotice("未完成的资料草稿已删除，已发布门店资料不受影响。"); }
  };
  const startEdit = () => { if (!draft.ready || draft.pending || draft.conflict) return; if (!draft.state.draft) draft.resetBase(fromStore(store)); setEditing(true); setError(""); setNotice(""); };
  const draftStatus = draft.loading ? "正在读取草稿…" : draft.busy ? "正在保存或核对草稿…" : draft.pending ? "草稿结果待核对" : draft.conflict ? "草稿存在版本冲突" : draft.needsCorrection ? "草稿尚未保存，请修改提示中的内容" : draft.dirty ? "编辑中，将自动保存草稿" : draft.state.draft ? "草稿已保存，可退出后继续" : "尚未修改资料";
  const toolbar = <div className="merchant-profile-toolbar"><div><strong>门店资料</strong><span role="status">{draftStatus}</span></div><div>{onBack && <button type="button" className="outline-button" disabled={locked} onClick={onBack}><ArrowLeft size={16} />返回</button>}{isEditing ? <button key="save-profile" type="submit" form={formId} className="gold-button" disabled={fieldLocked || draft.busy}><Save size={16} />{saving ? "保存中…" : "保存资料"}</button> : <button key="edit-profile" type="button" className="gold-button" disabled={fieldLocked} onClick={event => { event.preventDefault(); startEdit(); }}><Edit3 size={16} />编辑资料</button>}</div></div>;
  return <section ref={sectionElement} className="surface wb-panel merchant-profile-editor">
    {toolbarSlot ? createPortal(toolbar, toolbarSlot) : toolbar}
    {error && <p className="wb-error" role="alert">{error}</p>}{notice && <p className="wb-notice" role="status"><CheckCircle2 size={16} />{notice}</p>}
    {draft.error && <p className="wb-error" role="alert">{draft.error}</p>}{draft.notice && <p className="merchant-profile-draft-notice" role="status">{draft.notice}</p>}
    {(draft.pending || draft.conflict || !draft.ready && !draft.loading) && <div className="merchant-profile-recovery">{draft.conflict ? <><p>其他窗口有更新。加载最新会替换当前表单；保留当前内容需要你明确选择。</p><button type="button" className="outline-button" disabled={draft.busy || locked} onClick={() => draft.resolveConflict(true)}>加载最新草稿</button><button type="button" className="outline-button" disabled={draft.busy || locked} onClick={() => draft.resolveConflict(false)}>保留当前内容</button></> : <><button type="button" className="outline-button" disabled={draft.busy || locked} onClick={() => void draft.recover()}><RefreshCw size={16} />核对原草稿请求</button>{draft.canRetry && <button type="button" className="outline-button" disabled={draft.busy || locked} onClick={() => void draft.retry()}>重试原草稿请求</button>}</>}</div>}
    {draft.state.draft && !draft.pending && <div className="merchant-profile-draft-banner"><p>已恢复未完成的资料草稿。它仅供当前商家继续编辑，尚未改变公开门店资料。</p><div>{!isEditing && <button type="button" className="outline-button" disabled={fieldLocked || draft.busy} onClick={() => { startEdit(); formElement.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }); }}>继续编辑</button>}<button type="button" className="text-button" disabled={fieldLocked || draft.busy} onClick={() => setDeleteConfirm(true)}><Trash2 size={16} />删除草稿</button></div></div>}
    {deleteConfirm && <div className="wb-confirm" role="alertdialog" aria-label="删除门店资料草稿"><p>删除未完成的资料草稿？已发布的资料和图片会保留。</p><div className="wb-actions"><button type="button" className="outline-button" disabled={draft.busy || locked} onClick={() => setDeleteConfirm(false)}>取消</button><button type="button" className="gold-button" disabled={fieldLocked || draft.busy} onClick={() => void removeDraft()}>确认删除草稿</button></div></div>}
    {isEditing ? <form ref={formElement} id={formId} className="wb-form" onSubmit={event => void save(event)}><fieldset disabled={fieldLocked}><div className="wb-fields">{([
      ["name", "门店名称", 40], ["category", "门店类别", 30], ["floor", "楼层", 10], ["address", "门店地址", 120], ["phone", "联系电话", 24],
    ] as const).map(([key, label, maxLength]) => <label key={key} className="field-label">{label}<input required={key !== "phone"} type={key === "phone" ? "tel" : "text"} maxLength={maxLength} value={draft.form[key]} onChange={event => draft.setForm(current => ({ ...current, [key]: event.target.value }))} /></label>)}<StoreIconField value={draft.form.logo} disabled={fieldLocked} onChange={logo => draft.setForm(current => ({ ...current, logo }))} /></div></fieldset>
      <StoreImagePicker imageURL={draft.form.imageURL} artwork={draft.form.artwork} disabled={fieldLocked} onBusyChange={setImageBusy} onChange={next => draft.setForm(previous => ({ ...previous, ...next }))} />
      <p className="wb-note">未完成的内容会自动保存为草稿；退出前会再确认最新草稿已保存。只有点击“保存资料”才更新公开资料。</p>
      {(unresolved || !toolbarSlot) && <div className="wb-actions">{unresolved ? <><button type="button" className="gold-button" disabled={busy || saving || checking} onClick={() => void checkSaved()}><RefreshCw size={16} />核对原保存结果</button>{checked && <button type="button" className="outline-button" disabled={busy || saving || checking} onClick={() => void submitOfficial(unresolved)}>重试原保存</button>}</> : <>{onBack && <button type="button" className="outline-button" disabled={locked} onClick={onBack}>保存草稿并退出</button>}<button type="submit" className="gold-button" disabled={fieldLocked || draft.busy}><Save size={16} />{saving ? "保存中…" : "保存资料"}</button></>}</div>}
    </form> : <><StoreImage imageURL={store.imageURL} artwork={store.artwork} alt={store.name} className="wb-store-image" /><dl className="wb-facts"><div><dt>门店名称</dt><dd>{store.name}</dd></div><div><dt>门店位置</dt><dd>{store.floor} · {store.address || store.area}</dd></div><div><dt>联系电话</dt><dd>{store.phone || "未填写"}</dd></div><div><dt>评分</dt><dd>{store.rating === null ? "未采集" : store.rating}</dd></div></dl></>}
  </section>;
}
