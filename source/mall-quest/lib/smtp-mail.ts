import { env } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import { GameError } from "./game-error";

type MailPurpose = "login" | "register" | "bind";
type MailRole = "player" | "merchant" | "admin";
type MailConfig = { host: string; user: string; password: string; from: string };
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const FAILURE = "验证码邮件暂时无法发送，请稍后重试或使用账号密码登录";

function configuration(): MailConfig | null {
  const variables = env as unknown as Record<string, unknown>;
  const value = (name: string) => typeof variables[name] === "string" ? (variables[name] as string).trim() : "";
  const host = value("MAIL_HOST"), user = value("MAIL_USER"), from = value("MAIL_FROM") || user;
  const password = typeof variables.MAIL_PASS === "string" ? variables.MAIL_PASS : "";
  // Port 465 establishes TLS before authentication; never send credentials over
  // plaintext SMTP or use port 25, which is unsupported by Workers sockets.
  if (value("MAIL_PORT") !== "465" || value("MAIL_SECURE") !== "true" ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(host) || !host.includes(".") ||
      !ADDRESS.test(user) || !ADDRESS.test(from) || from.length > 254 || user.length > 254 ||
      !password || password.length > 512 || /[\r\n\0]/.test(password)) return null;
  return { host, user, password, from };
}

export function mailConfigured(): boolean { return configuration() !== null; }
function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** One bounded TLS SMTP delivery, with no console/response fallback for codes. */
export async function sendVerificationEmail(email: string, code: string, purpose: MailPurpose, role: MailRole): Promise<void> {
  const settings = configuration();
  if (!settings) throw new GameError("邮箱发信服务尚未配置，请联系运营或使用账号密码登录", 503);
  if (!ADDRESS.test(email) || email.length > 254 || !/^\d{6}$/.test(code) ||
      !["login", "register", "bind"].includes(purpose) || !["player", "merchant", "admin"].includes(role))
    throw new GameError("验证码邮件参数不正确");

  let socket: ReturnType<typeof connect> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let expired = false, accepted = false;
  try {
    socket = connect({ hostname: settings.host, port: 465 }, { secureTransport: "on", allowHalfOpen: false });
    void socket.closed.catch(() => {});
    const transport = socket;
    const timeout = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => { expired = true; void transport.close().catch(() => {}); reject(new Error("SMTP deadline")); }, 10_000);
    });
    const bounded = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, timeout]);
    await bounded(socket.opened);
    reader = socket.readable.getReader(); writer = socket.writable.getWriter();
    const input = reader, output = writer, decoder = new TextDecoder();
    let buffer = "", receivedBytes = 0;
    async function line(): Promise<string> {
      while (!buffer.includes("\r\n")) {
        if (expired || buffer.length > 4096) throw new Error("Invalid SMTP line");
        const next = await bounded(input.read());
        if (next.done) throw new Error("SMTP closed");
        receivedBytes += next.value.byteLength;
        if (receivedBytes > 65_536) throw new Error("SMTP reply exceeds limit");
        buffer += decoder.decode(next.value, { stream: true });
      }
      const end = buffer.indexOf("\r\n"), result = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (result.length > 4096) throw new Error("Invalid SMTP line");
      return result;
    }
    async function reply(expected: number): Promise<void> {
      for (let count = 0; count < 32; count++) {
        const current = await line(), match = /^(\d{3})([ -])/.exec(current);
        if (!match || Number(match[1]) !== expected) throw new Error("SMTP rejected command");
        if (match[2] === " ") return;
      }
      throw new Error("SMTP multiline exceeds limit");
    }
    async function command(value: string, expected: number): Promise<void> {
      if (expired) throw new Error("SMTP deadline");
      await bounded(output.write(new TextEncoder().encode(value + "\r\n")));
      await reply(expected);
    }
    await reply(220);
    await command("EHLO mail.wanderabout.local", 250);
    await command("AUTH LOGIN", 334);
    await command(base64(settings.user), 334);
    await command(base64(settings.password), 235);
    await command(`MAIL FROM:<${settings.from}>`, 250);
    await command(`RCPT TO:<${email}>`, 250);
    await command("DATA", 354);
    const roles = { player: "玩家", merchant: "商家", admin: "运营" };
    const purposes = { login: "登录", register: "注册", bind: "绑定邮箱" };
    const action = `${roles[role]}账号${purposes[purpose]}`;
    const body = base64(`逛道宝 wander about\n\n你正在进行${action}。\n验证码：${code}\n\n验证码5分钟内有效，只适用于这次邮箱与账号身份，不要转发给他人。\n如果不是你本人操作，请忽略此邮件。`);
    const encodedSubject = `=?UTF-8?B?${base64(`逛道宝 · ${action}验证码`)}?=`;
    const encodedName = `=?UTF-8?B?${base64("逛道宝")}?=`;
    const message = [`From: ${encodedName} <${settings.from}>`, `To: <${email}>`, `Subject: ${encodedSubject}`,
      `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@${settings.from.split("@")[1]}>`,
      "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
      body.match(/.{1,76}/g)!.join("\r\n"), "."].join("\r\n");
    await command(message, 250);
    accepted = true;
    // Delivery is complete after DATA's 250, even if the peer closes before QUIT.
    await bounded(output.write(new TextEncoder().encode("QUIT\r\n"))).catch(() => {});
  } catch {
    if (!accepted) throw new GameError(FAILURE, 503);
  } finally {
    if (deadline) clearTimeout(deadline);
    // A platform close promise may stall. Cleanup must not extend the SMTP
    // deadline indefinitely or undo an already accepted DATA response.
    if (socket) {
      let cleanupDeadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(() => socket!.close()).catch(() => {}),
          new Promise<void>(resolve => { cleanupDeadline = setTimeout(resolve, 500); }),
        ]);
      } finally { if (cleanupDeadline) clearTimeout(cleanupDeadline); }
    }
    try { reader?.releaseLock(); } catch { /* A timed-out read may still be closing. */ }
    try { writer?.releaseLock(); } catch { /* A timed-out write may still be closing. */ }
  }
}
