"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { ChevronRight, MapPin, Settings2, Store as StoreIcon, Ticket } from "lucide-react";
import type { StaffState, Store } from "@/lib/game-types";
import { Drawer } from "./common/Drawer";
import { NfcEntry, type NfcEntryDevice } from "./nfc-entry";
import { StoreImage } from "./store-image";
import "./merchant-info.css";

type Props = {
  store: Store; data: StaffState; devices?: NfcEntryDevice[]; busy?: boolean;
  children?: ReactNode | ((onEditingChange: (editing: boolean) => void, registerCloseGuard: (guard: (() => Promise<boolean>) | null) => void, onBack: () => void) => ReactNode);
};
export function MerchantInfo(props: Props) { return <MerchantInfoContent key={props.store.id} {...props} />; }
function MerchantInfoContent({ store, data, devices, busy = false, children }: Props) {
  const [open, setOpen] = useState(false), [editing, setEditing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null), lockNoteRef = useRef<HTMLDivElement>(null);
  const closeGuard = useRef<(() => Promise<boolean>) | null>(null);
  const registerCloseGuard = useCallback((guard: (() => Promise<boolean>) | null) => { closeGuard.current = guard; }, []);
  const lockReasonId = useId();
  const remaining = Math.max(0, store.stockTotal - data.claims);
  const locked = busy || editing;
  const lockReason = busy ? "正在处理，请稍候再关闭。" : "正在处理图片或等待保存核对，请先完成当前操作。普通编辑可保存为草稿后退出。";
  const returnToEditor = () => {
    if (busy || !editing) return;
    const form = contentRef.current?.querySelector<HTMLFormElement>(".wb-form");
    const scroller = contentRef.current?.closest<HTMLElement>(".quest-drawer-body");
    if (!form || !scroller) return;
    const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const target = buttons.find(button => button.textContent?.trim() === "核对原保存结果")
      || buttons.find(button => button.textContent?.trim() === "核对原草稿请求");
    const destination = target || form;
    const reduceMotion = document.documentElement.dataset.questReduceMotion === "true"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = scroller.scrollTop + destination.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      - (lockNoteRef.current?.getBoundingClientRect().height || 0) - 12;
    scroller.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? "instant" : "smooth" });
    target?.focus({ preventScroll: true });
  };
  return <>
    <section className="surface merchant-info merchant-info-summary" aria-label="门店信息概览">
      <div className="merchant-info-summary-heading"><span className="merchant-info-summary-icon"><StoreIcon size={26} /></span><div><span className="pill">{store.status === "inactive" ? "门店已下线" : "活动门店"}</span><h2>{store.name}</h2><p>{store.category}</p></div></div>
      <p className="merchant-info-summary-location"><MapPin size={18} /><span>{store.floor} · {store.address || store.area}</span></p>
      <button type="button" className="merchant-info-manage" aria-haspopup="dialog" disabled={busy} onClick={() => setOpen(true)}><Settings2 size={22} /><span><strong>管理门店信息</strong><small>资料、展示图片、活动权益与 NFC 配置</small></span><ChevronRight size={20} /></button>
    </section>
    {open && <Drawer title="门店信息与设置" historyKey={"merchant-info:" + store.id} busy={locked} onBeforeClose={() => closeGuard.current?.() ?? true} onClose={() => { setOpen(false); setEditing(false); }}>{close => <div ref={contentRef} className="merchant-info-drawer-content">
      <div className="merchant-info-profile-toolbar-slot" data-merchant-profile-toolbar />
      {locked && <div ref={lockNoteRef} className="merchant-info-editing-note"><p id={lockReasonId} role="status">{lockReason}</p>{editing && !busy && <button type="button" className="outline-button merchant-info-editing-return" aria-describedby={lockReasonId} onClick={returnToEditor}>返回编辑表单</button>}</div>}
      {(typeof children === "function" ? children(setEditing, registerCloseGuard, close) : children) || <section className="merchant-info-detail"><h3>门店资料与图片</h3><StoreImage imageURL={store.imageURL} artwork={store.artwork} alt={store.name} className="merchant-info-detail-image" /><dl><div><dt>门店名称</dt><dd>{store.name}</dd></div><div><dt>门店类别</dt><dd>{store.category}</dd></div><div><dt>门店位置</dt><dd>{store.floor} · {store.address || store.area}</dd></div><div><dt>联系电话</dt><dd>{store.phone || "未填写"}</dd></div></dl><p className="muted">资料编辑功能正在读取，请刷新当前商家工作台。</p></section>}
      <section className="merchant-info-detail" aria-label="门店活动权益"><h3><Ticket size={20} />活动权益与额度</h3><dl><div><dt>当前奖励</dt><dd>{store.reward}</dd></div><div><dt>使用条件</dt><dd>{store.conditions}</dd></div><div><dt>活动总额度</dt><dd>{store.stockTotal} 份</dd></div><div><dt>当前剩余额度</dt><dd>{remaining} 份 · 已发 {data.claims} 份</dd></div></dl><p className="muted">正式领取后占用额度，核销不会恢复库存。调整优惠券与设备绑定，请进入“奖励与库存”。</p></section>
      <section className="merchant-info-detail merchant-info-nfc" aria-label="门店 NFC 配置"><NfcEntry store={store} data={data} devices={devices} /></section>
      <button type="button" className="outline-button merchant-info-drawer-return" disabled={busy} aria-describedby={locked ? lockReasonId : undefined} title={busy ? lockReason : undefined} onClick={editing ? returnToEditor : close}>{editing ? "返回编辑表单" : "返回门店概览"}</button>
    </div>}</Drawer>}
  </>;
}
