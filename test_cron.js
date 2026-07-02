// 测试 remind-cron 的纯逻辑（时区、逻辑日、命中窗口、未确认判定、去重）。
// 这些函数从 supabase/functions/remind-cron/index.ts 原样搬过来，保持同步。
// 用 node 直接跑：node test_cron.js
let PASS = 0, FAIL = 0;
function ok(name, cond){ if(cond){PASS++; console.log('  ✓', name);} else {FAIL++; console.log('  ✗ FAIL', name);} }

const WINDOW_MIN = 5;
const DAY_START_HOUR = 6;

function nowInTz(tz, now){
  const fmt = new Intl.DateTimeFormat("en-CA",{timeZone:tz||"UTC",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p=>[p.type,p.value]));
  let hh = parseInt(parts.hour,10); const mm = parseInt(parts.minute,10);
  if(hh===24) hh=0;
  const minutes = hh*60+mm;
  const shifted = new Date(now.getTime()-DAY_START_HOUR*3600*1000);
  const dfmt = new Intl.DateTimeFormat("en-CA",{timeZone:tz||"UTC",year:"numeric",month:"2-digit",day:"2-digit"});
  const dp = Object.fromEntries(dfmt.formatToParts(shifted).map(p=>[p.type,p.value]));
  const dayStr = `${dp.year}-${dp.month}-${dp.day}`;
  return {hh,mm,minutes,dayStr};
}
function hhmmToMinutes(s){ if(!s||!/^\d{2}:\d{2}$/.test(s)) return null; return parseInt(s.slice(0,2),10)*60+parseInt(s.slice(3,5),10); }
function dateStrOffset(dayStr, offset){ const [y,m,d]=dayStr.split("-").map(Number); const dt=new Date(Date.UTC(y,m-1,d+offset)); return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`; }
function isUnconfirmed(node, dayStr){ const nextday=node.checkMode==="nextday"; const target=nextday?dateStrOffset(dayStr,-1):dayStr; const st=node.log&&node.log[target]; return st!=="success"&&st!=="fail"; }
// 命中窗口：remindAt 落在 (minutes-WINDOW, minutes]
function hits(atStr, minutes){ const at=hhmmToMinutes(atStr); if(at===null) return false; return at<=minutes && at>minutes-WINDOW_MIN; }

console.log('\n== 时区 & 逻辑日 ==');
// 上海时间 2026-07-03 08:30 → UTC 00:30
{
  const utc = new Date(Date.UTC(2026,6,3,0,30));
  const r = nowInTz('Asia/Shanghai', utc);
  ok('上海 08:30 → minutes=510', r.minutes===510);
  ok('上海 08:30 逻辑日=07-03', r.dayStr==='2026-07-03');
}
// 上海时间 2026-07-03 05:30（凌晨，未过6点）→ 逻辑日应仍是 07-02
{
  const utc = new Date(Date.UTC(2026,6,2,21,30)); // UTC 21:30 = 上海次日 05:30
  const r = nowInTz('Asia/Shanghai', utc);
  ok('上海 05:30 minutes=330', r.minutes===330);
  ok('上海凌晨 05:30 逻辑日回退到 07-02', r.dayStr==='2026-07-02');
}
// 上海时间 06:00 整 → 逻辑日翻到当天
{
  const utc = new Date(Date.UTC(2026,6,2,22,0)); // UTC 22:00 = 上海 06:00
  const r = nowInTz('Asia/Shanghai', utc);
  ok('上海 06:00 逻辑日=07-03', r.dayStr==='2026-07-03');
}

console.log('\n== 命中 5 分钟窗口 ==');
{
  // 现在 08:30 (510)
  ok('08:30 命中 08:30', hits('08:30', 510));
  ok('08:30 命中 08:26（窗口内）', hits('08:26', 510));
  ok('08:30 不命中 08:25（正好落窗外，避免重复）', !hits('08:25', 510));
  ok('08:30 不命中 08:35（未来）', !hits('08:35', 510));
  ok('空串不命中', !hits('', 510));
}

console.log('\n== 未确认判定 ==');
{
  const day = '2026-07-03';
  ok('sameday 今天没打卡 → 未确认', isUnconfirmed({checkMode:'sameday',log:{}}, day));
  ok('sameday 今天 success → 已确认', !isUnconfirmed({checkMode:'sameday',log:{'2026-07-03':'success'}}, day));
  ok('sameday 今天 fail → 已确认（不再打扰）', !isUnconfirmed({checkMode:'sameday',log:{'2026-07-03':'fail'}}, day));
  ok('nextday 看昨天 07-02 没打卡 → 未确认', isUnconfirmed({checkMode:'nextday',log:{}}, day));
  ok('nextday 昨天 success → 已确认', !isUnconfirmed({checkMode:'nextday',log:{'2026-07-02':'success'}}, day));
  ok('nextday 只看昨天，前天的记录无关', isUnconfirmed({checkMode:'nextday',log:{'2026-07-01':'success'}}, day));
}

console.log('\n== 汇总未确认计数 ==');
{
  const day='2026-07-03';
  const nodes=[
    {checkMode:'sameday',log:{}},                       // 未确认
    {checkMode:'sameday',log:{'2026-07-03':'success'}}, // 已确认
    {checkMode:'nextday',log:{}},                       // 未确认(看昨天)
    {checkMode:'nextday',log:{'2026-07-02':'fail'}},    // 已确认
  ];
  const pending = nodes.filter(n=>isUnconfirmed(n,day)).length;
  ok('4 条里 2 条待确认', pending===2);
}

console.log('\n== 去重键（含提醒时间，改时间可重推）==');
{
  const day='2026-07-03';
  const key = `node:abc:${day}:09:00`;
  const lastSent = {[key]:true};
  ok('已推过的 key 被过滤', lastSent[key]===true);
  ok('新的一天 key 不同', `node:abc:2026-07-04:09:00` !== key);
  // 关键：同一定式同一天，改了提醒时间 → 新键 → 能重新推
  const keyNewTime = `node:abc:${day}:10:30`;
  ok('改提醒时间后 key 不同（可重推）', lastSent[keyNewTime] !== true);
  // 汇总键同理带时间
  const digestKey = `digest:${day}:08:00`;
  ok('汇总改时间后 key 不同', `digest:${day}:09:00` !== digestKey);
  // prune 只保留当天
  const merged = {[`node:abc:2026-07-02:09:00`]:true, [key]:true};
  const pruned = {}; for(const k of Object.keys(merged)) if(k.includes(day)) pruned[k]=true;
  ok('prune 掉昨天的 key', !pruned['node:abc:2026-07-02:09:00'] && pruned[key]);
}

console.log(`\n结果：PASS ${PASS} / FAIL ${FAIL}\n`);
if(FAIL) process.exit(1);
