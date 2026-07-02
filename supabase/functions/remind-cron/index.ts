// 自控台 v1.4 阶段二：提醒定时扫描 + Web Push 发送（合二为一）
// 部署为 Supabase Edge Function 名 `remind-cron`，由 pg_cron 每 5 分钟触发。
//
// 逻辑：读 sync_state(id='main').data（就是前端的 state），按用户时区算出"现在这一分钟"，
// 命中的单条定式提醒(remindAt)与每日汇总(dailyDigestAt) → 给 push_subscriptions 里的所有设备发推。
// 用每设备 last_sent 去重：同一提醒同一天只推一次。
//
// 需要的 secret：
//   VAPID_PRIVATE_KEY  （沙箱生成的私钥，绝不进前端）
//   VAPID_PUBLIC_KEY   （与前端同一把公钥）
//   VAPID_SUBJECT      （形如 mailto:you@example.com，可选，默认占位）
// Supabase 自动注入：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const WINDOW_MIN = 5;          // 与 cron 频率一致：命中当前 5 分钟窗口
const DAY_START_HOUR = 6;      // 与前端一致：早上 6:00 翻天（日本 30h 制）

// 取某时区"现在"的 {hh, mm, minutes, dayStr}（dayStr 用 6:00 逻辑日）
function nowInTz(tz: string) {
  const now = new Date();
  // 用 en-CA 拿 YYYY-MM-DD，用 hourCycle 拿 24h
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  let hh = parseInt(parts.hour, 10);
  const mm = parseInt(parts.minute, 10);
  if (hh === 24) hh = 0; // 某些实现 midnight 报 24
  const minutes = hh * 60 + mm;
  // 逻辑日：把当前时区时间减 6 小时再取年月日
  const shifted = new Date(now.getTime() - DAY_START_HOUR * 3600 * 1000);
  const dfmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  const dp = Object.fromEntries(dfmt.formatToParts(shifted).map(p => [p.type, p.value]));
  const dayStr = `${dp.year}-${dp.month}-${dp.day}`;
  return { hh, mm, minutes, dayStr };
}

function hhmmToMinutes(s: string): number | null {
  if (!s || !/^\d{2}:\d{2}$/.test(s)) return null;
  return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10);
}

// 判断一条定式今天/昨天是否还“未确认”——与前端一致：nextday 看昨天，sameday 看今天。
function dateStrOffset(dayStr: string, offset: number): string {
  const [y, m, d] = dayStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offset));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function isUnconfirmed(node: any, dayStr: string): boolean {
  const nextday = node.checkMode === "nextday";
  const target = nextday ? dateStrOffset(dayStr, -1) : dayStr;
  const st = node.log && node.log[target];
  return st !== "success" && st !== "fail"; // 未打卡（成功/失败都算已确认）
}

async function sendTo(sub: any, payload: any): Promise<"ok" | "gone" | "err"> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return "ok";
  } catch (e: any) {
    const code = e?.statusCode;
    if (code === 404 || code === 410) return "gone"; // 订阅失效
    console.error("push err", code, e?.body || e?.message);
    return "err";
  }
}

Deno.serve(async () => {
  // 1) 读用户状态（单用户单行 id='main'）
  const { data: rows, error } = await admin.from("sync_state").select("data").eq("id", "main").maybeSingle();
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const state = rows?.data;
  if (!state) return new Response(JSON.stringify({ skip: "no state" }), { status: 200 });

  const tz = (state.notify && state.notify.tz) || "Asia/Shanghai";
  const { minutes, dayStr } = nowInTz(tz);

  // 2) 收集“此刻该推”的提醒
  const dueItems: { key: string; title: string; body: string; tag: string }[] = [];
  const nodes: any[] = (state.tree && state.tree.nodes) || [];

  // 单条定式提醒：remindAt 落在 [minutes-WINDOW, minutes] 且该定式未确认
  for (const n of nodes) {
    const rm = hhmmToMinutes(n.remindAt || "");
    if (rm === null) continue;
    if (rm > minutes || rm <= minutes - WINDOW_MIN) continue;
    if (!isUnconfirmed(n, dayStr)) continue; // 已确认就不打扰
    const label = n.name || n.content;
    dueItems.push({
      key: `node:${n.id}:${dayStr}`,
      title: "定式提醒",
      body: `该确认「${label}」了`,
      tag: `rsip-node-${n.id}`,
    });
  }

  // 每日汇总：dailyDigestAt 命中窗口 → 统计未确认条数
  const digest = hhmmToMinutes((state.notify && state.notify.dailyDigestAt) || "");
  if (digest !== null && digest <= minutes && digest > minutes - WINDOW_MIN) {
    const pending = nodes.filter((n) => isUnconfirmed(n, dayStr)).length;
    if (pending > 0) {
      dueItems.push({
        key: `digest:${dayStr}`,
        title: "今日待确认",
        body: `你还有 ${pending} 条定式待确认`,
        tag: "rsip-digest",
      });
    }
  }

  if (dueItems.length === 0) return new Response(JSON.stringify({ ok: true, due: 0 }), { status: 200 });

  // 3) 取所有订阅，逐个设备发（用 last_sent 去重）
  const { data: subs } = await admin.from("push_subscriptions").select("*");
  let sent = 0, cleaned = 0;
  for (const sub of subs || []) {
    const lastSent = sub.last_sent || {};
    const toSend = dueItems.filter((it) => lastSent[it.key] !== true);
    if (toSend.length === 0) continue;
    let gone = false;
    for (const it of toSend) {
      const r = await sendTo(sub, { title: it.title, body: it.body, tag: it.tag });
      if (r === "gone") { gone = true; break; }
      if (r === "ok") { lastSent[it.key] = true; sent++; }
    }
    if (gone) {
      await admin.from("push_subscriptions").delete().eq("device_id", sub.device_id);
      cleaned++;
    } else {
      // 只保留当天的去重键，避免 last_sent 无限膨胀
      const pruned: Record<string, boolean> = {};
      for (const k of Object.keys(lastSent)) if (k.includes(dayStr)) pruned[k] = true;
      await admin.from("push_subscriptions").update({ last_sent: pruned }).eq("device_id", sub.device_id);
    }
  }

  return new Response(JSON.stringify({ ok: true, due: dueItems.length, sent, cleaned }), { status: 200 });
});
