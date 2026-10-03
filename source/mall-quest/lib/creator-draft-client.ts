import { apiRequest, isGameApiError } from "./game-api";
import { browserRequestId } from "./browser-id";
import type { CreatorDraft, CreatorDraftState, CreatorDraftStatus } from "./creator-draft-types";

export function emptyCreatorDraft(storeId = "tea"): CreatorDraft {
  return { storeId, title: "", clues: ["", "", "", "", ""], step: 0, submissionId: null,
    options: { difficulty: 3, expiresAt: null, rewardType: "points", rewardValue: 50,
      rewardCouponId: null, photoURLs: ["", "", "", "", ""] } };
}
export type DraftSnapshot = {
  value: CreatorDraft; status: CreatorDraftStatus; message: string;
  loaded: boolean; dirty: boolean; revision: number; updatedAt: number | null;
};
type Operation = { method: "PUT" | "DELETE"; requestId: string; expectedRevision: number; draft?: CreatorDraft };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const signature = (value: CreatorDraft | null) => value === null ? "null" : JSON.stringify([
  value.storeId, value.title, value.clues, value.step, value.submissionId,
  value.options.difficulty, value.options.expiresAt, value.options.rewardType,
  value.options.rewardValue, value.options.rewardCouponId, value.options.photoURLs,
]);

/** One serialized writer per mounted player scope; uncertain requests retain their ID. */
export class CreatorDraftClient {
  private value = emptyCreatorDraft();
  private status: CreatorDraftStatus = "idle";
  private message = "草稿会自动保存到当前账号";
  private loaded = false;
  private dirty = false;
  private revision = 0;
  private updatedAt: number | null = null;
  private saved = signature(this.value);
  private paused = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reading: Promise<void> | undefined;
  private writing: Promise<void> | undefined;
  private operation: Operation | undefined;
  private editGeneration = 0;

  constructor(private playerId: string, private publish: (state: DraftSnapshot) => void) {}
  snapshot(): DraftSnapshot {
    return { value: copy(this.value), status: this.status, message: this.message,
      loaded: this.loaded, dirty: this.dirty, revision: this.revision, updatedAt: this.updatedAt };
  }
  private emit() { if (!this.disposed) this.publish(this.snapshot()); }
  private checked(state: CreatorDraftState): CreatorDraftState {
    if (!state || state.eventId !== "mall-48h" || state.playerId !== this.playerId ||
      !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      (state.draft && (!Array.isArray(state.draft.clues) || state.draft.clues.length !== 5 ||
        !state.draft.options || !Array.isArray(state.draft.options.photoURLs) || state.draft.options.photoURLs.length !== 5))) {
      throw new Error("草稿身份或内容已变化，请重新加载后继续。");
    }
    return state;
  }
  private fail(error: unknown) {
    this.status = isGameApiError(error) && error.status === 409 ? "conflict" : "error";
    this.message = this.status === "conflict"
      ? "草稿已在其他页面更新。当前修改仍保留，加载服务器草稿会替换这些修改。"
      : `${error instanceof Error ? error.message : "暂时无法保存草稿"}；当前修改尚未确认保存。`;
    this.emit();
  }
  async load(replaceLocal = false): Promise<void> {
    if (this.disposed) throw new Error("草稿页面已经关闭。");
    if (this.reading) return this.reading;
    if (this.loaded && !replaceLocal) return;
    this.reading = (async () => {
      this.status = "loading"; this.message = "正在读取当前账号的草稿…"; this.emit();
      try {
        if (this.writing) await this.writing;
        const generation = this.editGeneration;
        const result = this.checked(await apiRequest<CreatorDraftState>("/api/creator-draft", { headers: { "X-Mall-Quest-Player": this.playerId } }));
        if (this.disposed) return;
        if (replaceLocal && generation !== this.editGeneration) {
          this.status = "conflict"; this.message = "读取草稿期间有新输入，当前修改已保留。请停止编辑后重新加载。";
          this.emit(); return;
        }
        if (this.dirty && result.draft && !replaceLocal) {
          this.status = "conflict";
          this.message = "服务器已有草稿，当前输入仍保留。加载服务器草稿会替换当前修改。";
          this.emit(); return;
        }
        this.revision = result.revision; this.updatedAt = result.updatedAt;
        this.loaded = true; this.operation = undefined;
        if (replaceLocal || !this.dirty) this.value = result.draft ? copy(result.draft) : emptyCreatorDraft();
        this.saved = signature(result.draft || emptyCreatorDraft());
        this.dirty = signature(this.value) !== this.saved;
        this.status = result.draft ? "saved" : "idle";
        this.message = result.draft ? "已恢复当前账号的草稿" : "草稿会自动保存到当前账号";
        this.emit(); if (this.dirty) this.schedule();
      } catch (error) { if (!this.disposed) this.fail(error); throw error; }
    })();
    try { await this.reading; } finally { this.reading = undefined; }
  }
  update(change: CreatorDraft | ((value: CreatorDraft) => CreatorDraft)) {
    if (this.disposed) return;
    this.editGeneration++;
    this.value = copy(typeof change === "function" ? change(copy(this.value)) : change);
    this.dirty = signature(this.value) !== this.saved;
    if (this.status !== "error" && this.status !== "conflict") {
      this.status = this.dirty ? "saving" : "saved";
      this.message = this.dirty ? "修改待保存…" : "草稿已保存";
    }
    this.emit(); this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.loaded || !this.dirty || this.paused || this.status === "error" || this.status === "conflict") return;
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 600);
  }
  pause() { this.paused = true; clearTimeout(this.timer); }
  resume() { this.paused = false; this.schedule(); }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.disposed) throw new Error("草稿页面已经关闭。");
    if (!this.loaded) await this.load();
    if (this.status === "conflict") throw new Error(this.message);
    if (this.writing) { await this.writing; if (!this.dirty) return; }
    this.writing = (async () => {
      while (this.dirty && !this.disposed) {
        if (this.operation?.method === "DELETE") {
          await this.send(this.operation); continue;
        }
        if (!this.operation) this.operation = { method: "PUT", requestId: browserRequestId(), expectedRevision: this.revision, draft: copy(this.value) };
        await this.send(this.operation);
      }
    })();
    try { await this.writing; } finally { this.writing = undefined; }
  }
  private async send(operation: Operation): Promise<void> {
    this.status = "saving"; this.message = operation.method === "DELETE" ? "正在清理已提交的草稿…" : "正在保存草稿…"; this.emit();
    const payload = { expectedRevision: operation.expectedRevision, requestId: operation.requestId,
      ...(operation.method === "PUT" ? { draft: operation.draft } : {}) };
    const body = JSON.stringify(payload);
    try {
      const result = this.checked(await apiRequest<CreatorDraftState>("/api/creator-draft", {
        method: operation.method, headers: { "Content-Type": "application/json", "X-Mall-Quest-Player": this.playerId }, body,
        keepalive: new TextEncoder().encode(body).byteLength < 60_000,
      }));
      if (this.disposed) return;
      if (result.revision !== operation.expectedRevision + 1 || signature(result.draft) !== signature(operation.draft || null)) {
        throw new Error("草稿保存结果不一致，请重新加载后核对。");
      }
      this.revision = result.revision; this.updatedAt = result.updatedAt;
      this.operation = undefined;
      if (operation.method === "DELETE") {
        this.value = emptyCreatorDraft(this.value.storeId);
        this.saved = signature(this.value); this.dirty = false;
      } else {
        this.saved = signature(operation.draft!); this.dirty = signature(this.value) !== this.saved;
      }
      this.status = this.dirty ? "saving" : "saved";
      this.message = this.dirty ? "正在保存最新修改…" : operation.method === "DELETE" ? "投稿已提交，草稿已清除" : "草稿已保存到当前账号";
      this.emit();
    } catch (error) { if (!this.disposed) this.fail(error); throw error; }
  }
  async prepareSubmission(): Promise<CreatorDraft> {
    this.pause();
    await this.flush();
    if (!this.value.submissionId) this.update(value => ({ ...value, submissionId: browserRequestId() }));
    await this.flush();
    return copy(this.value);
  }
  async cancelSubmission() {
    this.update(value => ({ ...value, submissionId: null })); this.resume();
  }
  async clear(): Promise<void> {
    this.pause();
    if (this.writing && this.operation?.method === "DELETE") { await this.writing; this.resume(); return; }
    if (this.operation?.method === "PUT" || this.dirty && this.operation?.method !== "DELETE") await this.flush();
    else if (this.writing) await this.writing;
    if (!this.loaded) await this.load();
    if (this.status === "conflict") throw new Error(this.message);
    // Keep a failed DELETE's request ID so a lost response can be safely retried.
    if (!this.operation || this.operation.method !== "DELETE") {
      this.operation = { method: "DELETE", requestId: browserRequestId(), expectedRevision: this.revision };
    }
    this.dirty = true;
    this.writing = this.send(this.operation);
    try { await this.writing; } finally { this.writing = undefined; }
    this.resume();
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); }
}
