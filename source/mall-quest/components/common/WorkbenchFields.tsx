"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ToggleEvent } from "react";
import { CalendarDays, Check, ChevronDown, X } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import "./workbench-fields.css";

const subscribeSupport = () => () => {};
const hasPopover = () => typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;
const serverSupport = () => false;

// Keep dates as local calendar days. Parsing an ISO date through UTC can move it
// to the preceding day in another browser time zone.
function calendarDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(0);
  result.setFullYear(year, month - 1, day);
  result.setHours(12, 0, 0, 0);
  return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day ? result : undefined;
}
function calendarValue(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function focusInsideMenu(popover: HTMLElement, item: HTMLElement) {
  item.focus({ preventScroll: true });
  // Scroll this picker only; scrollIntoView can move its parent form or page.
  const viewport = popover.getBoundingClientRect(), rect = item.getBoundingClientRect();
  if (rect.top < viewport.top + 6) popover.scrollTop += rect.top - viewport.top - 6;
  else if (rect.bottom > viewport.bottom - 6) popover.scrollTop += rect.bottom - viewport.bottom + 6;
}

function useFieldPopover(disabled: boolean, matchTriggerWidth = false) {
  const native = useSyncExternalStore(subscribeSupport, hasPopover, serverSupport);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const position = useCallback(() => {
    const anchor = trigger.current, popover = panel.current;
    if (!anchor || !popover || !popover.matches(":popover-open")) return;
    const viewport = window.visualViewport;
    const leftEdge = (viewport?.offsetLeft || 0) + 8;
    const topEdge = (viewport?.offsetTop || 0) + 8;
    const rightEdge = leftEdge + (viewport?.width || window.innerWidth) - 16;
    const bottomEdge = topEdge + (viewport?.height || window.innerHeight) - 16;
    const anchorRect = anchor.getBoundingClientRect();
    if (matchTriggerWidth) popover.style.width = `${anchorRect.width}px`;
    popover.style.maxWidth = `${Math.max(1, rightEdge - leftEdge)}px`;
    popover.style.maxHeight = `${Math.max(1, bottomEdge - topEdge)}px`;
    const wantedHeight = popover.getBoundingClientRect().height;
    const below = Math.max(0, bottomEdge - anchorRect.bottom - 8);
    const above = Math.max(0, anchorRect.top - topEdge - 8);
    const upwards = below < wantedHeight && above > below;
    // The top layer may overlap its trigger: keep the whole calendar visible
    // whenever it fits in the viewport, rather than clipping it to one side.
    // Only a viewport shorter than the panel itself needs internal scrolling.
    const rect = popover.getBoundingClientRect();
    popover.style.left = `${Math.max(leftEdge, Math.min(anchorRect.left, rightEdge - rect.width))}px`;
    const wantedTop = upwards ? anchorRect.top - rect.height - 8 : anchorRect.bottom + 8;
    popover.style.top = `${Math.max(topEdge, Math.min(wantedTop, bottomEdge - rect.height))}px`;
  }, [matchTriggerWidth]);
  const close = useCallback((restoreFocus = true) => {
    const popover = panel.current;
    if (popover?.matches(":popover-open")) popover.hidePopover();
    if (restoreFocus && trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus({ preventScroll: true });
  }, []);
  const show = useCallback(() => {
    if (disabled || !native || !panel.current) return;
    if (panel.current.matches(":popover-open")) { close(); return; }
    panel.current.showPopover();
    position();
    const popover = panel.current;
    const initialFocus = popover.querySelector<HTMLElement>("button[aria-selected='true']:not(:disabled),.wb-calendar-selected button:not(:disabled)") ||
      popover.querySelector<HTMLElement>(".wb-calendar-today button:not(:disabled)") ||
      popover.querySelector<HTMLElement>(".wb-calendar-day-button:not(:disabled),button[tabindex='0']:not(:disabled)") ||
      popover.querySelector<HTMLElement>("button:not(:disabled)");
    if (initialFocus) focusInsideMenu(popover, initialFocus);
  }, [close, disabled, native, position]);
  const beforeToggle = useCallback((event: ToggleEvent<HTMLDivElement>) => {
    // allow-discrete keeps a closing popover in the top layer until the fade
    // finishes. Make it inert immediately, including the parent's Tab trap.
    event.currentTarget.inert = event.newState !== "open";
  }, []);

  useEffect(() => {
    if (!disabled || !native) return;
    close(false);
  }, [close, disabled, native]);
  useEffect(() => {
    if (!open || !native) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      // Prevent Escape from also cancelling the containing native FormDialog.
      if (event.key !== "Escape" || !panel.current?.matches(":popover-open")) return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    if (trigger.current) observer?.observe(trigger.current);
    if (panel.current) observer?.observe(panel.current);
    document.addEventListener("keydown", onEscape, true);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    position();
    return () => {
      observer?.disconnect();
      document.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [close, native, open, position]);
  return { native, id, trigger, panel, open, show, close, setOpen, beforeToggle };
}

export type DateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  disabled?: boolean;
};

export function DateField({ label, value, onChange, min, disabled = false }: DateFieldProps) {
  const { native, id, trigger: triggerRef, panel: panelRef, open, show, close, setOpen, beforeToggle } = useFieldPopover(disabled);
  const selected = calendarDate(value), minimum = calendarDate(min);
  const labelId = `${id}-label`, triggerId = `${id}-trigger`;
  const initialMonth = selected && (!minimum || selected >= minimum) ? selected : minimum || new Date();
  return <div className="field-label wb-field wb-date-field">
    <label id={labelId} htmlFor={triggerId}>{label}</label>
    {!native ? <input id={triggerId} type="date" value={value} min={min} disabled={disabled} onChange={event => onChange(event.target.value)} /> : <>
      <button id={triggerId} ref={triggerRef} type="button" className="wb-field-control" disabled={disabled}
        aria-labelledby={`${labelId} ${id}-value`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={show}>
        <span id={`${id}-value`} data-placeholder={!selected || undefined}>{selected ? `${value.slice(0, 4)}年${value.slice(5, 7)}月${value.slice(8)}日` : "请选择日期"}</span><CalendarDays size={19} aria-hidden="true" />
      </button>
      <div id={id} ref={panelRef} popover="auto" className="wb-field-popover wb-date-popover" role="dialog" aria-labelledby={labelId}
        onBeforeToggle={beforeToggle} onToggle={event => setOpen(event.newState === "open")}>
        <div className="wb-picker-heading"><strong>{label}</strong><button type="button" className="wb-picker-close" aria-label="关闭日期选择" onClick={() => close()}><X size={18} /></button></div>
        <DayPicker key={min || ""} mode="single" required locale={zhCN} weekStartsOn={1} showOutsideDays fixedWeeks
          selected={selected} defaultMonth={initialMonth} disabled={disabled ? true : minimum ? { before: minimum } : undefined}
          onSelect={date => {
            const next = calendarValue(date);
            // DayPicker may return midnight while parsing uses noon; compare
            // calendar-day strings so the minimum day itself remains valid.
            if (!disabled && (!minimum || next >= calendarValue(minimum))) { onChange(next); close(); }
          }}
          classNames={{ root: "wb-calendar", months: "wb-calendar-months", month: "wb-calendar-month", month_caption: "wb-calendar-caption", caption_label: "wb-calendar-caption-label",
            nav: "wb-calendar-nav", button_previous: "wb-calendar-nav-button", button_next: "wb-calendar-nav-button", chevron: "wb-calendar-chevron", month_grid: "wb-calendar-grid",
            weekdays: "wb-calendar-weekdays", weekday: "wb-calendar-weekday", weeks: "wb-calendar-weeks", week: "wb-calendar-week", day: "wb-calendar-day", day_button: "wb-calendar-day-button",
            today: "wb-calendar-today", selected: "wb-calendar-selected", disabled: "wb-calendar-disabled", outside: "wb-calendar-outside", hidden: "wb-calendar-hidden" }} />
        <div className="wb-picker-footer"><span>{minimum ? `${min} 起可选` : "点击日期完成选择"}</span><button type="button" className="wb-picker-clear" disabled={disabled || !value} onClick={() => { if (!disabled) { onChange(""); close(); } }}>清除日期</button></div>
      </div>
    </>}
  </div>;
}

export type ChoiceFieldProps = {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  describedBy?: string;
  ariaLabel?: string;
  matchTriggerWidth?: boolean;
};

export function ChoiceField({ label, value, options, onChange, disabled = false, describedBy, ariaLabel, matchTriggerWidth = false }: ChoiceFieldProps) {
  const { native, id, trigger: triggerRef, panel: panelRef, open, show, close, setOpen, beforeToggle } = useFieldPopover(disabled, matchTriggerWidth);
  const selected = options.find(option => option.value === value);
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const labelId = `${id}-label`, triggerId = `${id}-trigger`;
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='option']:not(:disabled)"));
    if (!items.length) return;
    event.preventDefault();
    const current = items.findIndex(item => item === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    focusInsideMenu(event.currentTarget, items[next]);
  };
  return <div className="field-label wb-field wb-choice-field">
    <label id={labelId} htmlFor={triggerId}>{label}</label>
    {!native ? <select id={triggerId} value={value} disabled={disabled} aria-label={ariaLabel} aria-describedby={describedBy} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select> : <>
      <button id={triggerId} ref={triggerRef} type="button" role="combobox" className="wb-field-control" disabled={disabled}
        aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : `${labelId} ${id}-value`} aria-describedby={describedBy} aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
        onClick={show} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); } }}>
        <span id={`${id}-value`}>{selected?.label || "请选择"}</span><ChevronDown size={19} aria-hidden="true" />
      </button>
      <div id={id} ref={panelRef} popover="auto" role="listbox" className="wb-field-popover wb-choice-popover" aria-labelledby={labelId}
        onBeforeToggle={beforeToggle} onToggle={event => setOpen(event.newState === "open")} onKeyDown={moveFocus}>
        {options.map((option, index) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} tabIndex={index === selectedIndex ? 0 : -1}
          disabled={disabled} className="wb-choice-option" onClick={() => { if (!disabled) { onChange(option.value); close(); } }}>
          <span>{option.label}</span><Check size={18} aria-hidden="true" data-checked={option.value === value || undefined} />
        </button>)}
      </div>
    </>}
  </div>;
}
