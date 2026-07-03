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
const FOCUS_MIN = 60;          // 专注时长（与前端 index.html 对齐）
const AUX_MIN = 15;            // 预约窗口时长（与前端对齐）
const AUX_REMIND_BEFORE = 13;  // 预约临期提醒：triggeredAt+此分钟之前的最后一个整5分刻度触发

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

// 把任意时刻按某时区算成 6:00 逻辑日 YYYY-MM-DD（与 nowInTz 的逻辑日算法一致）。
function dayStrOfInTz(date: Date, tz: string): string | null {
  if (isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() - DAY_START_HOUR * 3600 * 1000);
  const dfmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  const dp = Object.fromEntries(dfmt.formatToParts(shifted).map(p => [p.type, p.value]));
  return `${dp.year}-${dp.month}-${dp.day}`;
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
function isUnconfirmed(node: any, dayStr: string, tz: string): boolean {
  const nextday = node.checkMode === "nextday";
  // 次日回顾：今天刚建的节点，明天起才开始回顾昨天——当天不提醒、不计入汇总。
  // 与前端 checkReady 一致：nextday && createdAt 逻辑日 === 今天 → 尚未就绪。
  if (nextday && node.createdAt) {
    const created = dayStrOfInTz(new Date(node.createdAt), tz);
    if (created === dayStr) return false;
  }
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
    if (!isUnconfirmed(n, dayStr, tz)) continue; // 已确认就不打扰
    const label = n.name || n.content;
    dueItems.push({
      key: `node:${n.id}:${dayStr}:${n.remindAt}`,
      title: "定式提醒",
      body: `该确认「${label}」了`,
      tag: `rsip-node-${n.id}`,
    });
  }

  // 每日汇总：dailyDigestAt 命中窗口 → 统计未确认条数
  const digest = hhmmToMinutes((state.notify && state.notify.dailyDigestAt) || "");
  if (digest !== null && digest <= minutes && digest > minutes - WINDOW_MIN) {
    const pending = nodes.filter((n) => isUnconfirmed(n, dayStr, tz)).length;
    if (pending > 0) {
      dueItems.push({
        key: `digest:${dayStr}:${state.notify.dailyDigestAt}`,
        title: "今日待确认",
        body: `你还有 ${pending} 条定式待确认`,
        tag: "rsip-digest",
      });
    }
  }

  // CTDP 到点提醒（时间戳是绝对 epoch，直接与 now 比，不走当日分钟数）
  const ctdp = state.ctdp || {};
  const now = Date.now();

  // 专注完成：activeFocus 满 60 分钟即到期 → 推一次（已过期也推，App 关着回来才靠它；key 去重）。
  // 注意：用户在前台时前端 tick 会先判完成并清空 activeFocus 同步上云，这里就看不到、不会重复。
  const af = ctdp.activeFocus;
  if (af && typeof af.startedAt === "number" && now >= af.startedAt + FOCUS_MIN * 60 * 1000) {
    dueItems.push({
      key: `ctdp-focus:${dayStr}:${af.startedAt}`,
      title: "专注完成 🎉",
      body: "一小时专注达成，神圣座位 +1。",
      tag: "rsip-ctdp-focus",
    });
  }

  // 预约临期催促：取 triggeredAt+13min 之前（含）最后一个整 5 分钟刻度作为提醒时刻，
  // cron 恰在整 5 分钟醒来，命中 (now-5min, now] 窗口即推；且必须尚未超时（now < triggeredAt+15min）。
  const aa = ctdp.activeAux;
  if (aa && typeof aa.triggeredAt === "number") {
    const deadline = aa.triggeredAt + AUX_MIN * 60 * 1000;
    if (now < deadline) {
      const remindCutoff = aa.triggeredAt + AUX_REMIND_BEFORE * 60 * 1000;
      const FIVE = 5 * 60 * 1000; // 向下取整到最近的整 5 分钟 UTC 刻度
      const targetTick = Math.floor(remindCutoff / FIVE) * FIVE;
      // 仅当该刻度不早于预约开始，且落在当前扫描窗口 (now-5min, now] 内才推
      if (targetTick >= aa.triggeredAt && targetTick <= now && targetTick > now - WINDOW_MIN * 60 * 1000) {
        dueItems.push({
          key: `ctdp-aux:${dayStr}:${aa.triggeredAt}`,
          title: "预约就要超时了",
          body: "快坐上神圣座位，点「开始」进入专注。",
          tag: "rsip-ctdp-aux",
        });
      }
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
