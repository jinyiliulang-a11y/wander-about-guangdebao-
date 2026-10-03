"use client";
import { useState } from "react";
import { Check, ShieldCheck, History, Star, Trash2 } from "lucide-react";
import type { Task } from "@/lib/game-types";
import { Empty } from "./common/Empty";

export function TaskReviewPanel({
  tasks,
  pending,
  busy,
  onAction,
  onHistory,
  onDelete,
}: {
  tasks: Task[];
  pending: Task[];
  busy: boolean;
  onAction: (
    action: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  onHistory: (task: Task) => void;
  onDelete?: (task: Task) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <div className="review-list">
      {pending.map((t) => (
        <article className="surface review-card" key={t.id}>
          <span className="pill gold">待审核</span>
          <h2>{t.title}</h2>
          <p>
            {t.author} · {t.storeName} · {t.floor}
          </p>
          <p className="task-meta">难度 {t.difficulty || 1} / 5 · {t.rewardType === "points" ? `${t.rewardValue || 0} 积分` : t.reward}{t.expiresAt ? ` · 截止 ${new Date(t.expiresAt).toLocaleString("zh-CN")}` : ""}</p>
          <ol>
            {t.clues.map((c, i) => (
              <li key={i}>
                <span>{i + 1}</span>
                {c}
                {t.photoURLs?.[i] && <img className="clue-photo" src={t.photoURLs[i]} alt={`待审核线索 ${i + 1} 的照片`} />}
              </li>
            ))}
          </ol>
          <label className="field-label">
            审核意见
            <textarea
              aria-label={`审核意见 ${t.title}`}
              maxLength={160}
              rows={2}
              placeholder="通过时可选；退回时说明如何修改"
              value={notes[t.id] || ""}
              onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })}
            />
          </label>
          <div className="review-actions">
            {onDelete && <button className="text-button danger-button" disabled={busy} aria-label={`删除审核内容 ${t.title}`} onClick={() => onDelete(t)}><Trash2 size={15} />删除</button>}
            <button className="text-button" onClick={() => onHistory(t)}>
              <History size={15} />
              审核历史
            </button>
            <button
              className="outline-button"
              disabled={busy}
              onClick={() =>
                onAction("review", {
                  taskId: t.id,
                  status: "rejected",
                  note: notes[t.id] || "",
                })
              }
            >
              退回修改
            </button>
            <button
              className="gold-button"
              disabled={busy}
              onClick={() =>
                onAction("review", {
                  taskId: t.id,
                  status: "published",
                  note: notes[t.id] || "",
                })
              }
            >
              <Check size={16} />
              通过并发布
            </button>
          </div>
        </article>
      ))}
      {!pending.length && (
        <Empty icon={ShieldCheck} title="待审核列表已清空" body="新提交的线索会出现在这里。" />
      )}
      <section className="surface published-list">
        <h2>已发布任务</h2>
        {tasks
          .filter((t) => t.status === "published")
          .map((t) => (
            <div className="log-row review-task-row" key={t.id}>
              <div>
                <strong>
                  {t.title}
                  {t.isFeatured && <span className="pill gold">优质线索</span>}
                </strong>
                <small>
                  {t.storeName} · {t.claimedCount || 0}次成功领奖
                </small>
                {t.reviewNote && <small>审核意见：{t.reviewNote}</small>}
              </div>
              <div className="review-task-actions">
                {onDelete && <button className="text-button danger-button" disabled={busy} aria-label={`删除已发布内容 ${t.title}`} onClick={() => onDelete(t)}><Trash2 size={15} />删除</button>}
                <button className="text-button" onClick={() => onHistory(t)}>
                  <History size={14} />
                  历史
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    onAction("feature", {
                      taskId: t.id,
                      featured: !t.isFeatured,
                    })
                  }
                >
                  <Star size={14} />
                  {t.isFeatured ? "取消优质" : "标记优质"}
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    onAction("review", {
                      taskId: t.id,
                      status: "offline",
                      note: "运营下架任务",
                    })
                  }
                >
                  下架
                </button>
              </div>
            </div>
          ))}
      </section>
      {tasks.some((t) => t.status === "rejected" || t.status === "offline") && (
        <section className="surface published-list">
          <h2>其他审核记录</h2>
          {tasks
            .filter((t) => t.status === "rejected" || t.status === "offline")
            .map((t) => (
              <div className="log-row" key={t.id}>
                <div>
                  <strong>{t.title}</strong>
                  <small>
                    {t.storeName} ·{" "}
                    {t.status === "rejected" ? "已退回" : "已下架"}
                  </small>
                  {t.reviewNote && <small>{t.reviewNote}</small>}
                </div>
                {onDelete && <button className="text-button danger-button" disabled={busy} aria-label={`删除审核记录 ${t.title}`} onClick={() => onDelete(t)}><Trash2 size={15} />删除</button>}
                <button className="text-button" onClick={() => onHistory(t)}>
                  <History size={14} />
                  审核历史
                </button>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
