const fs=require('fs');
const {JSDOM}=require('jsdom');
const htmlPath='/sessions/focused-laughing-meitner/mnt/self-discipline/RSIP.html';
function check(l,c){ console.log((c?'PASS':'FAIL')+' '+l); if(!c) process.exitCode=1; }

const dom=new JSDOM(fs.readFileSync(htmlPath,'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window;
const state=()=>w.eval('JSON.parse(JSON.stringify(state))');
setTimeout(()=>{
  const $=(s)=>w.document.querySelector(s);
  const $$=(s)=>Array.from(w.document.querySelectorAll(s));

  check('默认 state 有 notify', state().notify && state().notify.dailyDigestAt==='');

  // 旧的独立提醒面板/按钮已移除
  check('已无 remindSheet', !$('#remindSheet'));
  check('已无 data-remind 独立提醒按钮', $$('[data-remind]').length===0);

  // 建根（addSheet 里提醒开关默认关 → 新节点 remindAt 空）
  $('#fabAdd').click();
  check('新建时提醒开关默认关', $('#remindOn').checked===false);
  check('新建时时间选择器禁用态', $('#remindPicker').classList.contains('off'));
  check('小时选项 24 个', $('#remindHour').options.length===24);
  check('分钟选项 12 个(每5分)', $('#remindMin').options.length===12);
  $('#addContent').value='总则'; $('#addConfirm').click();
  const rootId=state().tree.nodes[0].id;
  check('新节点 remindAt 空(开关关)', state().tree.nodes[0].remindAt==='');

  // 节点操作区只有一个「修改」按钮
  check('节点有修改按钮', $$(`[data-edit="${rootId}"]`).length===1);
  check('修改按钮文案=修改', $$(`[data-edit="${rootId}"]`)[0].textContent.trim()==='修改');

  // 打开修改 → 开提醒 → 设 21:30
  $$(`[data-edit="${rootId}"]`)[0].click();
  check('修改面板复用 addSheet', $('#addSheet').classList.contains('show'));
  check('标题=修改定式', $('#addTitle').textContent==='修改定式');
  check('确认按钮=保存', $('#addConfirm').textContent==='保存');
  // 白名单：内容框锁灰、名字+提醒放开
  check('内容框被锁', w.document.querySelector('#paneManual').classList.contains('locked'));
  check('提醒栏未锁', !$('#remindField').classList.contains('locked'));
  check('名字栏未锁', !$('#nameField').classList.contains('locked'));
  // 开提醒
  $('#remindOn').checked=true; $('#remindOn').dispatchEvent(new w.Event('change'));
  check('开关后选择器启用', !$('#remindPicker').classList.contains('off'));
  $('#remindHour').value='21'; $('#remindMin').value='30';
  $('#addName').value='总纲';
  $('#addConfirm').click();
  check('remindAt 保存为 21:30', state().tree.nodes[0].remindAt==='21:30');
  check('同时保存名字', state().tree.nodes[0].name==='总纲');
  check('meta 显示提醒时间', $(`#li-${rootId} .meta`).textContent.includes('21:30'));

  // 重开修改 → 预填 21:30 → 关掉提醒
  $$(`[data-edit="${rootId}"]`)[0].click();
  check('重开开关为开', $('#remindOn').checked===true);
  check('重开预填小时21', $('#remindHour').value==='21');
  check('重开预填分钟30', $('#remindMin').value==='30');
  $('#remindOn').checked=false; $('#remindOn').dispatchEvent(new w.Event('change'));
  $('#addConfirm').click();
  check('关掉提醒后 remindAt 空', state().tree.nodes[0].remindAt==='');
  check('meta 不再显示⏰', !$(`#li-${rootId} .meta`).textContent.includes('⏰'));

  // 每日汇总时间（notifySheet 里的 digest 也用滚轮选择器）
  $('#btnNotify').click();
  check('提醒设置面板打开', $('#notifySheet').classList.contains('show'));
  check('digest 开关默认关', $('#digestOn').checked===false);
  check('digest 选择器禁用态', $('#digestPicker').classList.contains('off'));
  check('digest 小时选项 24 个', $('#digestHour').options.length===24);
  check('digest 分钟选项 12 个', $('#digestMin').options.length===12);
  // 开启 digest + 选 08:00
  $('#digestOn').checked=true; $('#digestHour').value='08'; $('#digestMin').value='00';
  $('#digestOn').dispatchEvent(new w.Event('change'));
  check('dailyDigestAt 已保存', state().notify.dailyDigestAt==='08:00');
  check('digest 选择器启用', !$('#digestPicker').classList.contains('off'));
  // 改分钟即时保存
  $('#digestMin').value='30'; $('#digestMin').dispatchEvent(new w.Event('change'));
  check('改分钟即时保存', state().notify.dailyDigestAt==='08:30');
  // 关闭 digest → 空
  $('#digestOn').checked=false; $('#digestOn').dispatchEvent(new w.Event('change'));
  check('关闭 digest → 空', state().notify.dailyDigestAt==='');
  // 重开预填
  $('#btnNotify').click();
  $('#digestOn').checked=true; $('#digestHour').value='08'; $('#digestMin').value='30';
  $('#digestOn').dispatchEvent(new w.Event('change'));
  w.closeSheets && w.closeSheets();
  $('#btnNotify').click();
  check('digest 重开预填开关开', $('#digestOn').checked===true);
  check('digest 重开预填小时08', $('#digestHour').value==='08');
  check('digest 重开预填分钟30', $('#digestMin').value==='30');
  // 清理：关掉
  $('#digestOn').checked=false; $('#digestOn').dispatchEvent(new w.Event('change'));

  // migrate 兼容旧数据 + 旧任意分钟对齐到5
  const old = {tree:{nodes:[{id:'x',content:'旧',parentId:null,createdAt:'2020-01-01T00:00:00.000Z',log:{},remindAt:'07:23'}],lastAddedDate:null,migratedDayBoundary:true},ctdp:{main:{count:0,history:[]},aux:{count:0}}};
  const migrated = w.migrate(JSON.parse(JSON.stringify(old)));
  check('migrate 补 notify', migrated.notify && migrated.notify.dailyDigestAt==='');
  // 旧节点带 07:23 → setRemindPicker 对齐到 07:25
  w.setRemindPicker('07:23');
  check('任意分钟对齐到5(23→25)', $('#remindMin').value==='25');

  console.log('\nremind done');
  process.exit(process.exitCode||0);
},250);
