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

  // CTDP
  $('#btnSnap').click();
  check('aux启动', !!state().ctdp.activeAux);
  check('aux 15:00', $('#auxDisplay').textContent==='15:00');
  $('#btnStart').click();
  check('focus启动', !!state().ctdp.activeFocus);
  $('#btnFinish').click();
  check('主链#1', state().ctdp.main.count===1);
  check('aux+1', state().ctdp.aux.count===1);
  $('#btnClear').click(); $('#confirmOk').click();
  check('主链清零', state().ctdp.main.count===0);

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
