import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, ArrowRight, X } from "lucide-react";
import { teamMembers, type TeamMember } from "@/data/team";
import { teamContacts, PRODUCT_URL } from "@/data/contacts";
import PageHeader from "@/components/layout/PageHeader";

function memberName(member: TeamMember) {
  return teamContacts.find(person => person.id === member.id)?.name || member.name;
}

function TeamPortrait({
  member,
  onOpen,
}: {
  member: TeamMember;
  onOpen: (member: TeamMember, opener: HTMLButtonElement) => void;
}) {
  const [failed, setFailed] = useState(false);
  const contact = teamContacts.find(person => person.id === member.id);
  const name = memberName(member);
  return (
    <article className="reveal self-start overflow-hidden rounded-3xl border border-navy-900/5 bg-white">
      <div className="aspect-[4/3] overflow-hidden bg-forest-100">
        {failed ? (
          <div className="flex h-full items-center justify-center font-display text-6xl text-forest-700">
            {name.slice(0, 1)}
          </div>
        ) : (
          <img
            src={`${import.meta.env.BASE_URL}${member.image.replace(/^[/]+/, "")}`}
            alt={name}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover object-top motion-safe:hover:scale-[1.025] motion-safe:transition-transform"
            style={member.id === "yao" ? { objectPosition: "50% 65%" } : undefined}
          />
        )}
      </div>
      <div className="p-7">
        <p className="text-xs text-forest-600">{member.title}</p>
        <h2 className="mt-2 font-display text-2xl font-bold text-navy-950">{name}</h2>
        <p className="mt-2 text-sm text-navy-800/60">{member.role}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {member.specialties.map(skill => (
            <span key={skill} className="rounded-full bg-forest-50 px-3 py-1 text-xs text-forest-700">
              {skill}
            </span>
          ))}
        </div>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`查看${name}的个人介绍`}
          onClick={event => onOpen(member, event.currentTarget)}
          className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-forest-700"
        >
          个人介绍 <ArrowRight className="h-4 w-4" />
        </button>
        {contact && (
          <a
            href={`mailto:${contact.email}`}
            className="mt-6 flex items-start gap-2 border-t border-navy-900/5 pt-5 text-sm text-forest-700 underline-offset-4 hover:underline"
          >
            <Mail className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-all">{contact.email}</span>
          </a>
        )}
      </div>
    </article>
  );
}

function MemberDrawer({
  member,
  opener,
  onDismiss,
}: {
  member: TeamMember;
  opener: HTMLButtonElement;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropDown = useRef(false);
  const closingRef = useRef(false);
  const dismissedRef = useRef(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissRef = useRef(onDismiss);
  const [closing, setClosing] = useState(false);
  dismissRef.current = onDismiss;
  const name = memberName(member);
  const contact = teamContacts.find(person => person.id === member.id);

  const finishClose = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    if (closeTimeoutRef.current !== null) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
    dismissRef.current();
  }, []);

  const requestClose = () => {
    if (closingRef.current || dismissedRef.current) return;
    closingRef.current = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finishClose();
      return;
    }
    const dialog = dialogRef.current;
    const panel = dialog?.querySelector<HTMLElement>(".team-bio-panel");
    if (panel && dialog) {
      // Read the current entry frame once, then reverse from it without a jump.
      const style = getComputedStyle(panel);
      const transform = style.transform;
      const backdropOpacity = getComputedStyle(dialog, "::backdrop").opacity;
      panel.style.setProperty("--drawer-exit-transform", transform === "none" ? "translate(0, 0)" : transform);
      dialog.style.setProperty("--drawer-backdrop-exit-opacity", backdropOpacity || "1");
    }
    setClosing(true);
  };

  useEffect(() => {
    if (!closing) return;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMotion = () => { if (media?.matches) finishClose(); };
    const modernListener = typeof media?.addEventListener === "function" && typeof media?.removeEventListener === "function";
    if (modernListener) media?.addEventListener("change", onMotion);
    else media?.addListener?.(onMotion);
    closeTimeoutRef.current = setTimeout(finishClose, 400);
    onMotion();
    return () => {
      if (closeTimeoutRef.current !== null) clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
      if (modernListener) media?.removeEventListener("change", onMotion);
      else media?.removeListener?.(onMotion);
    };
  }, [closing, finishClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const root = document.documentElement;
    const body = document.body;
    const previousOverflow = root.style.overflow;
    const previousPadding = body.style.paddingRight;
    const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);

    root.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${padding + scrollbarWidth}px`;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-drawer-close]")?.focus({ preventScroll: true });
    // Also clear native focus scrolling in browsers that fall back to overflow:hidden.
    dialog.scrollLeft = 0;
    dialog.scrollTop = 0;

    return () => {
      if (closeTimeoutRef.current !== null) clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
      if (dialog.open) dialog.close();
      root.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
      if (opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`team-bio-drawer${closing ? " is-closing" : ""}`}
      data-state={closing ? "closing" : "open"}
      aria-labelledby="team-bio-title"
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]',
        )).filter(target => target.tabIndex >= 0 && !target.matches(":disabled") && target.getClientRects().length > 0);
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (!first || !last) {
          event.preventDefault();
          return;
        }
        const active = document.activeElement;
        if (event.shiftKey ? active === first || !targets.includes(active as HTMLElement) : active === last || !targets.includes(active as HTMLElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }}
      onCancel={event => {
        event.preventDefault();
        requestClose();
      }}
      onPointerDown={event => {
        backdropDown.current = event.target === event.currentTarget;
      }}
      onClick={event => {
        if (backdropDown.current && event.target === event.currentTarget) requestClose();
        backdropDown.current = false;
      }}
    >
      <section className="team-bio-panel" onAnimationEnd={event => {
        if (event.target !== event.currentTarget || !closingRef.current) return;
        if (event.animationName === "team-drawer-right-exit" || event.animationName === "team-drawer-bottom-exit") finishClose();
      }}>
        <header className="team-bio-header">
          <span>认识团队</span>
          <button
            type="button"
            data-drawer-close
            aria-label="关闭个人介绍"
            aria-disabled={closing || undefined}
            onClick={requestClose}
          >
            <X size={22} />
          </button>
        </header>
        <div className="team-bio-content">
          <img
            src={`${import.meta.env.BASE_URL}${member.image.replace(/^[/]+/, "")}`}
            alt={name}
            className="team-bio-photo"
            style={member.id === "yao" ? { objectPosition: "50% 65%" } : undefined}
          />
          <p className="mt-6 text-sm text-forest-600">{member.title}</p>
          <h2 id="team-bio-title" className="mt-2 font-display text-3xl font-bold text-navy-950">
            {name}
          </h2>
          <p className="mt-3 text-navy-800/60">{member.role}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {member.specialties.map(skill => (
              <span key={skill} className="rounded-full bg-forest-50 px-3 py-1 text-xs text-forest-700">
                {skill}
              </span>
            ))}
          </div>
          <p className="mt-7 whitespace-pre-line text-sm leading-7 text-navy-800/80">
            {member.bio}
          </p>
          <dl className="mt-7 grid grid-cols-3 gap-3">
            {member.stats.map(stat => (
              <div key={stat.label}>
                <dt className="text-xs text-navy-800/50">{stat.label}</dt>
                <dd className="mt-2 text-sm font-semibold text-navy-950">{stat.value}</dd>
              </div>
            ))}
          </dl>
          {contact && (
            <a href={`mailto:${contact.email}`} className="mt-8 flex items-start gap-2 border-t border-navy-900/10 pt-6 text-sm text-forest-700">
              <Mail className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-all">{contact.email}</span>
            </a>
          )}
        </div>
      </section>
    </dialog>,
    document.body,
  );
}

export default function Team() {
  const [selected, setSelected] = useState<{
    member: TeamMember;
    opener: HTMLButtonElement;
  } | null>(null);

  return (
    <>
      <PageHeader
        dark
        eyebrow="逛道宝团队"
        title="一起探索，"
        highlight="一起创造。"
        description="产品与市场、技术开发、设计宣发、数据与运营。我们用不同的分工，完成同一场探索。"
      />
      <section id="contact" className="bg-cream-100 py-16 lg:py-24">
        <div className="container">
          <div className="reveal mb-9">
            <h2 className="font-display text-3xl font-bold text-navy-950">认识我们，也欢迎直接联系。</h2>
            <p className="mt-4 text-navy-800/60">点击邮箱联系对应成员，点击个人介绍了解更多。</p>
          </div>
          <div className="grid items-start gap-7 md:grid-cols-2 xl:grid-cols-4">
            {teamMembers.map(member => (
              <TeamPortrait
                key={member.id}
                member={member}
                onOpen={(person, opener) => setSelected({ member: person, opener })}
              />
            ))}
          </div>
          <div className="reveal mt-12 flex flex-wrap items-center justify-between gap-5 rounded-3xl bg-white p-8">
            <p className="font-display text-xl font-bold text-navy-950">让逛街，变成一场值得期待的冒险。</p>
            <a href={PRODUCT_URL} className="product-cta inline-flex items-center gap-2 rounded-full bg-navy-950 px-6 py-3 font-semibold text-cream-100">
              体验产品 <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>
      {selected && (
        <MemberDrawer
          member={selected.member}
          opener={selected.opener}
          onDismiss={() => setSelected(null)}
        />
      )}
    </>
  );
}
