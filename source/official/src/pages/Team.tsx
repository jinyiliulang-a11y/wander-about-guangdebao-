import { useState } from "react";
import { Mail, ArrowRight } from "lucide-react";
import { teamMembers, type TeamMember } from "@/data/team";
import { teamContacts, PRODUCT_URL } from "@/data/contacts";
import PageHeader from "@/components/layout/PageHeader";
function TeamPortrait({ member }: { member: TeamMember }) {
  const [failed, setFailed] = useState(false);
  const contact = teamContacts.find((person) => person.id === member.id);
  const name = contact?.name || member.name;
  return <article className="reveal overflow-hidden rounded-3xl border border-navy-900/5 bg-white">
    <div className="aspect-[4/3] overflow-hidden bg-forest-100">{failed ? <div className="flex h-full items-center justify-center font-display text-6xl text-forest-700">{name.slice(0, 1)}</div> : <img src={`${import.meta.env.BASE_URL}${member.image.replace(/^[/]+/, "")}`} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-cover object-top motion-safe:hover:scale-[1.025] motion-safe:transition-transform" />}</div>
    <div className="p-7"><p className="text-xs text-forest-600">{member.title}</p><h2 className="mt-2 font-display text-2xl font-bold text-navy-950">{name}</h2><p className="mt-2 text-sm text-navy-800/60">{member.role}</p><div className="mt-4 flex flex-wrap gap-2">{member.specialties.map((skill) => <span key={skill} className="rounded-full bg-forest-50 px-3 py-1 text-xs text-forest-700">{skill}</span>)}</div><details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-forest-700">个人介绍</summary><p className="mt-4 text-sm leading-relaxed text-navy-800/70">{member.bio}</p><dl className="mt-5 grid grid-cols-3 gap-2">{member.stats.map((stat) => <div key={stat.label}><dt className="text-xs text-navy-800/50">{stat.label}</dt><dd className="mt-1 text-sm font-semibold text-navy-950">{stat.value}</dd></div>)}</dl></details>{contact && <a href={`mailto:${contact.email}`} className="mt-6 flex items-start gap-2 border-t border-navy-900/5 pt-5 text-sm text-forest-700 underline-offset-4 hover:underline"><Mail className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 break-all">{contact.email}</span></a>}</div>
  </article>;
}
export default function Team() {
  return <><PageHeader dark eyebrow="逛道宝团队" title="一起探索，" highlight="一起创造。" description="产品与市场、技术开发、设计宣发、数据与运营。我们用不同的分工，完成同一场探索。" /><section id="contact" className="bg-cream-100 py-16 lg:py-24"><div className="container"><div className="reveal mb-9"><h2 className="font-display text-3xl font-bold text-navy-950">认识我们，也欢迎直接联系。</h2><p className="mt-4 text-navy-800/60">点击邮箱即可联系对应成员；个人介绍可展开阅读。</p></div><div className="grid gap-7 md:grid-cols-2 xl:grid-cols-4">{teamMembers.map((member) => <TeamPortrait key={member.id} member={member} />)}</div><div className="reveal mt-12 flex flex-wrap items-center justify-between gap-5 rounded-3xl bg-white p-8"><p className="font-display text-xl font-bold text-navy-950">让逛街，变成一场值得期待的冒险。</p><a href={PRODUCT_URL} className="product-cta inline-flex items-center gap-2 rounded-full bg-navy-950 px-6 py-3 font-semibold text-cream-100">体验产品 <ArrowRight className="h-4 w-4" /></a></div></div></section></>;
}
