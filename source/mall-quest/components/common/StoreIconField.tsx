"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { STORE_ICONS, isStoreIcon } from "@/lib/store-icons";
import "./store-icon-field.css";

export function StoreIconField({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const selected = STORE_ICONS.find(icon => icon.value === value);
  const choice = (icon: (typeof STORE_ICONS)[number], extra = false) => <label className="store-icon-choice" key={icon.value}>
    <input type="radio" name={id} value={icon.value} checked={value === icon.value} disabled={disabled || (extra && !expanded)} onChange={() => onChange(icon.value)} />
    <span className="store-icon-tile"><span aria-hidden="true">{icon.value}</span><span>{icon.label}</span></span>
  </label>;

  return <fieldset className="store-icon-field" disabled={disabled}>
    <legend>门店图标</legend>
    <p className="store-icon-current" aria-live="polite">{selected ? <>已选：<span aria-hidden="true">{selected.value}</span> {selected.label}</> : value ? <>当前图标：{value}（可保留）</> : "选择一个适合门店的图标"}</p>
    <div className="store-icon-grid">{STORE_ICONS.slice(0, 8).map(icon => choice(icon))}</div>
    <div id={`${id}-more`} className="store-icon-more" data-expanded={expanded} inert={!expanded} aria-hidden={!expanded}>
      <div><div className="store-icon-grid">{STORE_ICONS.slice(8).map(icon => choice(icon, true))}</div></div>
    </div>
    <button type="button" className="store-icon-expand" aria-expanded={expanded} aria-controls={`${id}-more`} disabled={disabled} onClick={() => setExpanded(current => !current)}>
      {expanded ? "收起图标" : "更多图标"}<ChevronDown size={16} aria-hidden="true" />
    </button>
    {!isStoreIcon(value) && value && <p className="store-icon-hint">原有图标可以保留，修改时请选择上面的图标。</p>}
  </fieldset>;
}
