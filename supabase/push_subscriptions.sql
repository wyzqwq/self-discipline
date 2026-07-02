-- 自控台 v1.4 阶段二：Web Push 订阅表
-- 在 Supabase 控制台 SQL Editor 里整段运行。

create table if not exists push_subscriptions (
  device_id   text primary key,          -- 一台设备一行；前端用 localStorage 里的 device_id upsert
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  updated_at  bigint not null default 0, -- 前端写入的毫秒时间戳
  created_at  timestamptz not null default now(),
  -- 记录每条提醒最近一次推送的“逻辑日+时间”，cron 用来去重，避免同一提醒 5 分钟窗口重复推
  last_sent   jsonb not null default '{}'::jsonb
);

-- 让前端用 publishable(anon) key 能读写自己的订阅（与 sync_state 一致的宽松策略：单用户自用 App）。
alter table push_subscriptions enable row level security;

drop policy if exists "anon all push_subscriptions" on push_subscriptions;
create policy "anon all push_subscriptions"
  on push_subscriptions
  for all
  to anon
  using (true)
  with check (true);
