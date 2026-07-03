const fs=require('fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('/sessions/focused-laughing-meitner/mnt/self-discipline/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window;
function check(label,cond){ console.log((cond?'✓':'✗ FAIL')+' '+label); if(!cond) process.exitCode=1; }
const state=()=>JSON.parse(w.localStorage.getItem('rsip_ctdp_state_v1'));
const evalGlobal=(c)=>dom.window.eval(c);

setTimeout(()=>{
  const $=(s)=>w.document.querySelector(s);
  const $$=(s)=>Array.from(w.document.querySelectorAll(s));
  const resetDate=()=>evalGlobal('state.tree.lastAddedDate="2020-01-01"; save(); render();');

  check('初始空树', !!$('.empty'));
  check('canAddToday true', !$('#fabAdd').disabled);

  // ===== 逻辑日边界：6:00 翻天（日本30h制）=====
  // 5:59 仍算前一天，6:00 才是新一天
  check('凌晨2点算前一天', w.dayStrOf(new Date('2026-07-02T02:00:00'))==='2026-07-01');
  check('5:59 仍算前一天', w.dayStrOf(new Date('2026-07-02T05:59:00'))==='2026-07-01');
  check('6:00 翻到当天', w.dayStrOf(new Date('2026-07-02T06:00:00'))==='2026-07-02');
  check('中午算当天', w.dayStrOf(new Date('2026-07-02T12:00:00'))==='2026-07-02');
  check('23点算当天', w.dayStrOf(new Date('2026-07-02T23:00:00'))==='2026-07-02');

  // 加根定式（parentId 空）：不占每日名额、全树只一个
  $('#fabAdd').click();
  check('addSheet 打开', $('#addSheet').classList.contains('show'));
  check('默认手动模式', $('#paneManual').style.display!=='none' && $('#paneDiag').style.display==='none');
  $('#addParent').value='';                       // 根定式
  $('#addContent').value='每条定式失败当天必须复盘';
  $('#addName').value='治理总则';
  $('#addConfirm').click();
  check('根节点已加', state().tree.nodes.length===1);
  check('根节点 parentId 空', !state().tree.nodes[0].parentId);
  check('根不占每日名额(lastAddedDate 未变)', state().tree.lastAddedDate!==w.todayStr());
  check('加根后 fabAdd 仍可用(还能加子)', !$('#fabAdd').disabled);
  check('名字存进node', state().tree.nodes[0].name==='治理总则');
  check('无 problem 字段', state().tree.nodes[0].problem===undefined);
  check('名字作标题显示', $('.content').textContent.includes('治理总则'));
  check('内容作副行显示', $('.node-rule').textContent.includes('复盘'));

  // 已有根 → 不能再加第二个根
  $('#fabAdd').click();
  $('#addParent').value='';
  $('#addContent').value='第二个根';
  $('#addConfirm').click();
  check('第二个根被拒(仍1个节点)', state().tree.nodes.length===1);
  const rootId=state().tree.nodes[0].id;

  // 加子定式（受每日一个限制），设置 lastAddedDate
  $$('[data-addchild]')[0].click();
  check('加子面板打开', $('#addSheet').classList.contains('show'));
  $('#addParent').value=rootId;
  $('#addContent').value='进家门15分钟内必须洗澡';
  $('#addConfirm').click();
  check('子节点已加=2', state().tree.nodes.length===2);
  check('加子后 lastAddedDate=今天', state().tree.lastAddedDate===w.todayStr());
  check('加子且已有根 → fabAdd 禁用', $('#fabAdd').disabled);

  // 同一天不能再加子
  $$('[data-addchild]')[0].click();
  check('今天已加子→面板不开', !$('#addSheet').classList.contains('show'));

  // 改日后可加子
  resetDate();
  $$('[data-addchild]')[0].click();
  check('改日后开', $('#addSheet').classList.contains('show'));
  $('#addParent').value=rootId;
  $('#addContent').value='不带手机进卧室';
  $('#addConfirm').click();
  check('子节点3', state().tree.nodes.length===3);
  check('subtreeSize(root)=3', w.subtreeSize(rootId)===3);

  // 打卡
  $$('[data-check]').forEach(b=>{ if(b.dataset.check===rootId&&b.dataset.v==='success') b.click(); });
  check('打卡success', state().tree.nodes[0].log[w.todayStr()]==='success');

  // 删一个子 → 2
  const childId=state().tree.nodes[1].id;
  $$('[data-del]').find(b=>b.dataset.del===childId).click();
  $('#confirmOk').click();
  check('删子→2', state().tree.nodes.length===2);

  // 级联删根 → 0
  $$('[data-del]').find(b=>b.dataset.del===rootId).click();
  $('#confirmOk').click();
  check('级联删根→0', state().tree.nodes.length===0);

  // ===== 同天加了又删：只退当天刚加的 =====
  // 先建根(不占名额)，再改日加子(占今日名额)
  resetDate();
  $('#fabAdd').click(); $('#addParent').value=''; $('#addContent').value='退名额-根'; $('#addConfirm').click();
  const rfRoot=state().tree.nodes[0].id;
  resetDate();
  $$('[data-addchild]')[0].click(); $('#addParent').value=rfRoot; $('#addContent').value='今天刚加的子'; $('#addConfirm').click();
  check('加子后占用今日名额', state().tree.lastAddedDate===w.todayStr());
  check('占名额后不能再加子', !w.canAddChildToday());
  const rfChild=state().tree.nodes.find(n=>n.parentId===rfRoot).id;
  // 手动删掉今天刚加的这个子 → 应退还名额
  $$('[data-del]').find(b=>b.dataset.del===rfChild).click();
  $('#confirmOk').click();
  check('删今天刚加的→退名额', state().tree.lastAddedDate===null);
  check('退名额后可再加子', w.canAddChildToday());
  // 再验证：删“以前加的”不退名额。加子占名额，把它 createdAt 改到昨天，再删应不退
  $$('[data-addchild]')[0].click(); $('#addParent').value=rfRoot; $('#addContent').value='占位子'; $('#addConfirm').click();
  const oldChild=state().tree.nodes.find(n=>n.parentId===rfRoot && n.content==='占位子').id;
  w.eval(`findNode('${oldChild}').createdAt='2020-01-01T12:00:00'; save();`);
  check('删前占着今日名额', state().tree.lastAddedDate===w.todayStr());
  $$('[data-del]').find(b=>b.dataset.del===oldChild).click();
  $('#confirmOk').click();
  check('删以前的子→不退名额', state().tree.lastAddedDate===w.todayStr());
  // 清理
  $$('[data-del]').find(b=>b.dataset.del===rfRoot).click();
  $('#confirmOk').click();
  check('清理→0', state().tree.nodes.length===0);

  // ===== 次日回顾（checkMode=nextday）=====
  // 建一个 nextday 根定式
  $('#fabAdd').click();
  $('#addParent').value='';
  $('#addContent').value='上床不带手机';
  // 切到"次日回顾"
  $$('#checkModeTabs .tab').find(t=>t.dataset.cmode==='nextday').click();
  check('checkMode切到nextday', w.getCheckMode()==='nextday');
  $('#addConfirm').click();
  check('nextday节点已加', state().tree.nodes.length===1);
  check('checkMode存进node', state().tree.nodes[0].checkMode==='nextday');
  const ndId=state().tree.nodes[0].id;
  // 今天刚建 → 昨天不存在 → 不可回顾，按钮不出现
  check('今天建的nextday不可打卡(无check按钮)', $$(`[data-check="${ndId}"]`).length===0);
  // 把 createdAt 改到前天，使其可回顾昨天
  evalGlobal(`findNode('${ndId}').createdAt='2020-01-01T00:00:00.000Z'; save(); render();`);
  check('改早createdAt后出现打卡按钮', $$(`[data-check="${ndId}"]`).length>0);
  // 打卡成功 → 写进"昨天"这一格，不是今天
  $$('[data-check]').forEach(b=>{ if(b.dataset.check===ndId&&b.dataset.v==='success') b.click(); });
  check('nextday成功写进昨天', state().tree.nodes[0].log[w.yesterdayStr()]==='success');
  check('nextday未写进今天', !state().tree.nodes[0].log[w.todayStr()]);
  // 清掉这个节点，回到空树继续后续测试
  $$('[data-del]').find(b=>b.dataset.del===ndId).click();
  $('#confirmOk').click();
  check('清理nextday节点→0', state().tree.nodes.length===0);

  // 根节点免每日限制：即便 lastAddedDate=今天，仍能加根
  evalGlobal('state.tree.lastAddedDate=todayStr(); save(); render();');
  check('已用今日名额但树空→fabAdd 仍可用(可加根)', !$('#fabAdd').disabled);
  $('#fabAdd').click();
  $('#addParent').value='';
  $('#addContent').value='根A(管理要求)';
  $('#addConfirm').click();
  check('lastAddedDate=今天时仍能加根', state().tree.nodes.length===1);
  const rId=state().tree.nodes[0].id;

  // CTDP（v1.5：必须先预约，窗口内点开始=一次成功预约并进入专注；专注只能计时满自动完成，中途停止=失败）
  // 没预约时点开始：不进入专注、不加预约
  evalGlobal('state.ctdp.activeAux=null; state.ctdp.activeFocus=null; state.ctdp.aux.count=0; state.ctdp.main.count=0; save(); render();');
  $('#btnStart').click();
  check('没预约点开始→不进入专注', !state().ctdp.activeFocus);
  check('没预约点开始→预约链不加', state().ctdp.aux.count===0);
  check('没预约时开始按钮隐藏', $('#btnStart').style.display==='none');

  // 正常：打响指预约 → 开始
  $('#btnSnap').click();
  check('aux启动', !!state().ctdp.activeAux);
  check('aux 15:00', $('#auxDisplay').textContent==='15:00');
  check('预约后开始按钮显示', $('#btnStart').style.display==='');
  $('#btnStart').click();
  check('开始→focus启动', !!state().ctdp.activeFocus);
  check('开始→预约成功+1', state().ctdp.aux.count===1);
  check('开始→activeAux清空', !state().ctdp.activeAux);
  check('开始后无手动完成按钮', !w.document.getElementById('btnFinish'));
  // 专注中不能再打响指预约
  check('专注中打响指按钮隐藏', $('#btnSnap').style.display==='none');
  $('#btnSnap').click();
  check('专注中点响指→不新建预约', !state().ctdp.activeAux);

  // 中途停止 → 判失败，主链清零，不加节点
  $('#btnClear').click(); $('#confirmOk').click();
  check('中途停止→专注结束', !state().ctdp.activeFocus);
  check('中途停止→主链清零', state().ctdp.main.count===0);
  check('中途停止→不算成功专注(history空)', (state().ctdp.main.history||[]).length===0);

  // 计时满自动完成（模拟：startedAt 提前 60 分钟，触发 tick 的自动完成）→ 唯一成功路径
  $('#btnSnap').click(); $('#btnStart').click();
  evalGlobal('state.ctdp.activeFocus.startedAt = Date.now() - 61*60*1000; save(); tick();');
  check('计时满自动完成→主链#1', state().ctdp.main.count===1);
  check('自动完成→专注结束', !state().ctdp.activeFocus);
  check('自动完成→history记一次', (state().ctdp.main.history||[]).length===1);
  // 预约超时：activeAux 存在但已过 15 分钟 → 点开始应清零、不进入专注
  evalGlobal('state.ctdp.activeAux={triggeredAt: Date.now()-16*60*1000}; state.ctdp.aux.count=3; save(); render();');
  check('预约超时时开始按钮隐藏', $('#btnStart').style.display==='none');
  $('#btnStart').click();
  check('超时点开始→不进入专注', !state().ctdp.activeFocus);
  check('超时点开始→预约链清零', state().ctdp.aux.count===0);
  // 复位供后续用例
  evalGlobal('state.ctdp.activeAux=null; state.ctdp.activeFocus=null; state.ctdp.main.count=0; state.ctdp.main.history=[]; state.ctdp.main.breaks=[]; state.ctdp.aux.count=0; save(); render();');

  // ===== v1.5.1 价值曲线 =====
  // chainValue：单调递增 + 凸（每步增量越来越大）；const 声明用 evalGlobal 读
  check('chainValue(0)=0', evalGlobal('chainValue(0)')===0);
  check('chainValue 单调增', evalGlobal('chainValue(1)<chainValue(2) && chainValue(2)<chainValue(3)'));
  check('chainValue 凸(增量递增)', evalGlobal('(chainValue(3)-chainValue(2)) > (chainValue(2)-chainValue(1))'));
  check('chainValue(1)=1', evalGlobal('Math.abs(chainValue(1)-1)<1e-9'));
  // buildValueSeries：成功升值 + 断链归零，按时间归并
  evalGlobal(`state.ctdp.main.history=['2026-07-01T08:00:00Z','2026-07-01T10:00:00Z','2026-07-02T09:00:00Z']; state.ctdp.main.breaks=['2026-07-01T12:00:00Z']; save();`);
  const series = w.buildValueSeries();
  check('回放点数=成功3+断链1', series.length===4);
  check('第1点 k=1', series[0].k===1);
  check('第2点 k=2', series[1].k===2);
  check('断链点 k=0 value=0', series[2].k===0 && series[2].value===0);
  check('断链后重新从 k=1 起', series[3].k===1);
  check('断链点按时间插在成功之间', series[2].t < series[3].t && series[2].t > series[1].t);
  // 同一时刻：先升值后断链
  evalGlobal(`state.ctdp.main.history=['2026-07-01T08:00:00Z']; state.ctdp.main.breaks=['2026-07-01T08:00:00Z']; save();`);
  const tie = w.buildValueSeries();
  check('同刻先升后断：末点归零', tie[tie.length-1].value===0);
  // 空数据：曲线区显示占位、不报错
  evalGlobal('state.ctdp.main.history=[]; state.ctdp.main.breaks=[]; state.ctdp.main.count=0; save(); renderCTDP();');
  check('空数据显示占位', !!$('.vc-empty'));
  check('空数据无损失预览', $('#vcLoss').textContent==='');
  // 断链损失预览：有链时显示当前 #N 与价值数字
  evalGlobal('state.ctdp.main.count=5; save(); renderCTDP();');
  check('损失预览含 #5', $('#vcLoss').textContent.includes('#5'));
  check('损失预览含价值数字', /\d/.test($('#vcLoss').textContent));
  // btnClear 记断链：主链>0 放弃会 push 一条 break 并清零
  evalGlobal('state.ctdp.main.count=3; state.ctdp.main.breaks=[]; state.ctdp.activeFocus={startedAt:Date.now()}; save(); renderCTDP();');
  $('#btnClear').click(); $('#confirmOk').click();
  check('btnClear 记一条断链', state().ctdp.main.breaks.length===1);
  check('btnClear 后主链清零', state().ctdp.main.count===0);
  // 主链=0 放弃不记断链（没有链可断）
  evalGlobal('state.ctdp.main.count=0; state.ctdp.main.breaks=[]; state.ctdp.activeFocus={startedAt:Date.now()}; save(); renderCTDP();');
  $('#btnClear').click(); $('#confirmOk').click();
  check('主链0放弃不记断链', state().ctdp.main.breaks.length===0);
  // 复位
  evalGlobal('state.ctdp.activeAux=null; state.ctdp.activeFocus=null; state.ctdp.main.count=0; state.ctdp.main.history=[]; state.ctdp.main.breaks=[]; state.ctdp.aux.count=0; save(); render();');

  // ===== v1.5.1 价值曲线可点圆点·显示专注开始时间 =====
  // 两次成功专注（history 存的是完成时间），画曲线后应有 2 个可点热区
  evalGlobal(`state.ctdp.main.count=2; state.ctdp.main.history=['2026-07-01T09:00:00.000Z','2026-07-02T14:00:00.000Z']; state.ctdp.main.breaks=[]; save(); renderCTDP();`);
  const hits = $$('#vcChart .vc-hit');
  check('每个成功点生成一个可点热区', hits.length===2);
  check('热区带 data-k 链序号', hits[0].getAttribute('data-k')==='1' && hits[1].getAttribute('data-k')==='2');
  // data-start = 完成时间 − 60min（FOCUS_MIN）
  const start0 = +hits[0].getAttribute('data-start');
  check('开始时间=完成时间−60分钟', start0 === new Date('2026-07-01T09:00:00.000Z').getTime() - 60*60*1000);
  // 点击热区 → 出现气泡，含 #N 与开始时间
  hits[1].dispatchEvent(new w.Event('click',{bubbles:true}));
  const tip = $('#vcChart .vc-tip');
  check('点击圆点出现气泡', !!tip);
  check('气泡含链序号 #2', tip && tip.textContent.includes('#2'));
  // 期望开始时间按本地时区从"完成−60min"格式化（避免硬编码时区）
  const expStart = new Date(new Date('2026-07-02T14:00:00.000Z').getTime() - 60*60*1000);
  const p2=n=>String(n).padStart(2,'0');
  const expHM = `${p2(expStart.getHours())}:${p2(expStart.getMinutes())}`;
  check('气泡含开始时间(完成−60min)', tip && tip.textContent.includes(expHM));
  // 再次点同一点 → 关闭
  hits[1].dispatchEvent(new w.Event('click',{bubbles:true}));
  check('再次点同一点关闭气泡', !$('#vcChart .vc-tip'));
  // 复位
  evalGlobal('state.ctdp.activeAux=null; state.ctdp.activeFocus=null; state.ctdp.main.count=0; state.ctdp.main.history=[]; state.ctdp.main.breaks=[]; state.ctdp.aux.count=0; save(); render();');

  // ===== v1.5.1 同步冲突确认覆盖 =====
  // isPrefix：base 是 arr 前缀（只在末尾追加）才 true
  check('isPrefix 空base', w.isPrefix([], ['a','b']));
  check('isPrefix 追加', w.isPrefix(['a'], ['a','b']));
  check('isPrefix 相等', w.isPrefix(['a','b'], ['a','b']));
  check('isPrefix 变短→false', !w.isPrefix(['a','b'], ['a']));
  check('isPrefix 改写→false', !w.isPrefix(['a','b'], ['x','b']));
  // findSyncConflicts：只有“改写本地已有”才算冲突
  const L = {tree:{nodes:[
      {id:'a',content:'C1',name:'N1',parentId:null,checkMode:'sameday',remindAt:'',log:{'2026-07-01':'success'}},
      {id:'b',content:'C2',name:'',parentId:'a',checkMode:'sameday',remindAt:'',log:{}}
    ]}, ctdp:{main:{count:2,history:['t1','t2'],breaks:[]}}};
  // 1) 完全相同 → 无冲突
  check('相同数据无冲突', w.findSyncConflicts(L, JSON.parse(JSON.stringify(L))).length===0);
  // 2) 云端多一个新定式 + 主链末尾追加 → 无冲突（纯新增）
  const rAdd=JSON.parse(JSON.stringify(L));
  rAdd.tree.nodes.push({id:'c',content:'C3',name:'',parentId:'a',checkMode:'sameday',remindAt:'',log:{}});
  rAdd.ctdp.main.history.push('t3'); rAdd.ctdp.main.count=3;
  check('云端纯新增(加定式+主链变长)无冲突', w.findSyncConflicts(L, rAdd).length===0);
  // 3) 云端删了本地定式 b → 冲突
  const rDel=JSON.parse(JSON.stringify(L)); rDel.tree.nodes=rDel.tree.nodes.filter(n=>n.id!=='b');
  check('云端删本地定式→冲突', w.findSyncConflicts(L, rDel).length>0);
  // 4) 云端改了本地定式内容 → 冲突
  const rEdit=JSON.parse(JSON.stringify(L)); rEdit.tree.nodes[0].content='改了';
  check('云端改本地定式→冲突', w.findSyncConflicts(L, rEdit).length>0);
  // 5) 云端改了本地打卡 → 冲突
  const rLog=JSON.parse(JSON.stringify(L)); rLog.tree.nodes[0].log={'2026-07-01':'fail'};
  check('云端改本地打卡→冲突', w.findSyncConflicts(L, rLog).length>0);
  // 6) 云端主链记录被改写（非追加）→ 冲突
  const rHist=JSON.parse(JSON.stringify(L)); rHist.ctdp.main.history=['x','t2'];
  check('云端改写主链记录→冲突', w.findSyncConflicts(L, rHist).length>0);
  // 7) 本地空 → 云端任何数据都无冲突（首次同步/新设备）
  const empty={tree:{nodes:[]}, ctdp:{main:{count:0,history:[],breaks:[]}}};
  check('本地空→无冲突', w.findSyncConflicts(empty, rAdd).length===0);
  // stateBrief：摘要含定式数/主链/打卡
  const brief=w.stateBrief(L);
  check('stateBrief 含定式数', brief.includes('2 条定式'));
  check('stateBrief 含主链', brief.includes('#2'));
  check('stateBrief 含打卡次数', brief.includes('打卡 1'));
  // confirmAct 支持 onCancel + 自定义按钮文案
  evalGlobal('window.__ok2=0;window.__cancel=0;confirmAct("T","D",()=>{window.__ok=1},()=>{window.__cancel=1},"覆盖","保留")');
  check('确认弹窗打开', $('#confirmSheet').classList.contains('show'));
  check('确认按钮自定义文案', $('#confirmOk').textContent==='覆盖');
  check('取消按钮自定义文案', $('#confirmCancel').textContent==='保留');
  $('#confirmCancel').click();
  check('取消触发 onCancel 回调', w.__cancel===1);
  evalGlobal('confirmAct("T","D",()=>{window.__ok2=1})');
  check('无自定义时确认按钮复位为“确认”', $('#confirmOk').textContent==='确认');
  $('#confirmOk').click();
  check('确认触发 cb 回调', w.__ok2===1);

  // fail → cascade（子失败会连带删除；给根加个子再让子失败）
  resetDate();
  $$('[data-addchild]')[0].click();
  $('#addParent').value=rId; $('#addContent').value='子A'; $('#addConfirm').click();
  check('根A+子A=2', state().tree.nodes.length===2);
  $$('[data-check]').forEach(b=>{ if(b.dataset.check===rId&&b.dataset.v==='fail') b.click(); });
  $('#confirmOk').click();
  check('根失败级联删除→0', state().tree.nodes.length===0);

  // ===== 修改（白名单：放开名字+提醒时间）=====
  // 清空后建一个没名字的根定式
  $$('[data-del]').forEach(()=>{});
  evalGlobal('state.tree.nodes=[]; state.tree.lastAddedDate=null; save(); render();');
  $('#fabAdd').click();
  $('#addParent').value='';
  $('#addContent').value='忘了起名的定式';
  $('#addConfirm').click();
  check('建了无名定式', state().tree.nodes.length===1 && state().tree.nodes[0].name==='');
  const rnId=state().tree.nodes[0].id;
  // 点修改按钮
  check('节点上有修改按钮', $$(`[data-edit="${rnId}"]`).length>0);
  $$(`[data-edit="${rnId}"]`)[0].click();
  check('修改面板打开', $('#addSheet').classList.contains('show'));
  check('标题变为修改', $('#addTitle').textContent.includes('修改'));
  check('确认按钮变为保存', $('#addConfirm').textContent.includes('保存'));
  check('内容框预填当前内容', $('#addContent').value==='忘了起名的定式');
  // 白名单：名字/提醒字段不锁，内容/挂载被锁
  check('名字字段未锁', !$('#nameField').classList.contains('locked'));
  check('提醒字段未锁', !$('#remindField').classList.contains('locked'));
  const paneManualLi = $('#paneManual');
  check('挂载区被锁灰', paneManualLi.classList.contains('locked'));
  // 保存新名字
  $('#addName').value='终于起名了';
  $('#addConfirm').click();
  check('名字已更新', state().tree.nodes[0].name==='终于起名了');
  check('内容未被改动', state().tree.nodes[0].content==='忘了起名的定式');
  check('修改不新增节点', state().tree.nodes.length===1);
  // 重新打开新增面板 → 应还原（解锁、标题复位）
  evalGlobal('state.tree.lastAddedDate=null; save(); render();');
  $$('[data-addchild]')[0].click();
  check('新增面板标题已还原', $('#addTitle').textContent.includes('新增'));
  check('新增面板挂载区已解锁', !$('#paneManual').classList.contains('locked'));
  check('新增面板确认按钮已还原', $('#addConfirm').textContent.includes('加入'));
  $('#addCancel').click();
  // 清理
  $$('[data-del]').find(b=>b.dataset.del===rnId).click();
  $('#confirmOk').click();
  check('清理重命名测试→0', state().tree.nodes.length===0);

  check('export按钮', !!$('#btnExport'));
  check('import按钮', !!$('#btnImport'));
  check('无agent无AI建议按钮', $$('[data-aisuggest]').length===0);

  // v1.4.1：今日打卡列表显示名字，没名字回退内容
  evalGlobal(`
    state.tree.nodes=[
      {id:'k1',idx:1,content:'进门15分钟内洗澡',name:'洗澡令',parentId:null,checkMode:'sameday',status:'active',createdAt:'2020-01-01T00:00:00.000Z',log:{},remindAt:''},
      {id:'k2',idx:2,content:'上床不带手机',name:'',parentId:'k1',checkMode:'sameday',status:'active',createdAt:'2020-01-01T00:00:00.000Z',log:{},remindAt:''}
    ];
    state.tree.lastAddedDate=null; save(); render();
  `);
  const ciTexts = $$('#checkList .ci-content').map(e=>e.textContent);
  check('打卡列表显示名字(有名字)', ciTexts.some(t=>t.includes('洗澡令')));
  check('打卡列表不显示该条内容原文', !ciTexts.some(t=>t.includes('进门15分钟内洗澡')));
  check('打卡列表无名字回退内容', ciTexts.some(t=>t.includes('上床不带手机')));
  evalGlobal('state.tree.nodes=[]; save(); render();');

  console.log('\n✅ 全部通过');
  process.exit(process.exitCode||0);
},200);
