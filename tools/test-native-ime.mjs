// 真实浏览器加载当前移动插件与两内核页面桥；不访问手机或模型服务。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {browserFixture} from './rc1-browser-fixture.mjs';
const fixture = await browserFixture();
const asset = name => fs.readFileSync('app/src/main/assets/web-integration/' + name, 'utf8');
const mobile = fs.readFileSync('app/src/main/assets/builtin-plugins/dsh-web-mobile/lib/client.js','utf8');
const results = [];
try {
  for (const transport of ['webview','gecko']) {
    const page = await fixture.browser.newPage({viewport:{width:360,height:800},hasTouch:true});
    await page.setContent('<!doctype html><html><head><style>html,body{margin:0;height:100%;overflow:hidden}.frame{height:100%;position:relative}header{position:absolute;top:0;height:50px}.abc_composerSeat{position:absolute;bottom:0;height:80px;width:100%}[data-composer-input]{height:40px}</style></head><body><div data-mobile-nav="frame" class="frame"><header>Header</header><div class="abc_composerSeat"><div data-composer-input contenteditable="true">fixture</div></div></div></body></html>');
    await page.evaluate(() => {
      window.__ModuleLoader__ = {load:({factory})=>factory(()=>({}))};
      window.reconciles = 0; window.resizes = 0; window.styleMutations = 0;
      window.disposers = []; window.acks = [];
      window.addEventListener('resize',()=>resizes++);
      new MutationObserver(records=>{styleMutations+=records.filter(row=>row.type==='attributes'&&['style','class'].includes(row.attributeName)).length;})
        .observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['style','class']});
      window.binding = {nonce:'1'.repeat(32),generation:7,instance:'actual-fixture'};
      window.DshaTheme = {postMessage:text=>acks.push(JSON.parse(text))};
      window.portListener = undefined;
      window.__dshaStartupPort = {onMessage:{addListener:fn=>{portListener=fn;}},postMessage:value=>{if(value.type==='presentation')acks.push(value.report);}};
      window.browser = {runtime:{connectNative:()=>__dshaStartupPort}};
    });
    await page.addScriptTag({content:mobile.replace('var __cache = {};','window.mobileRequire=__localRequire; var __cache = {};')});
    await page.evaluate(() => {
      const ctx = {effect:run=>disposers.push(run())};
      mobileRequire('./effects/phone-chrome.js').installPhoneChrome(ctx);
      const adapter = mobileRequire('./effects/reconciler-adapter.js');
      adapter.addReconcilerTask({name:'native-ime-observation',scopes:['*','style','class'],ensure:()=>reconciles++,dispose(){}});
      adapter.installReconciler(ctx);
    });
    await page.addScriptTag({content:asset('ime.js')});
    await page.addScriptTag({content:asset('page.js')});
    if (transport === 'gecko') await page.addScriptTag({content:asset('content.js')});
    await page.evaluate(transport => {
      if(transport==='gecko') portListener({type:'presentation-init',binding});
      else __dshaNativePresentation.install(binding);
      document.querySelector('[data-composer-input]').focus();
      window.frameId=0;
      window.send=(height,phase='frame',epoch=1,extra={})=>{
        const packet={...binding,frameId:++frameId,epoch,width:720,height:height*2,phase,...extra};
        if(transport==='gecko')portListener({type:'ime-frame',request:packet});
        else __dshaNativePresentation.ime(packet);
      };
      window.tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    },transport);
    await page.evaluate(async()=>{send(800);await tick();await tick();});
    const mechanism = await page.evaluate(async()=>{
      const seat=document.querySelector('.abc_composerSeat'),header=document.querySelector('header');
      let rectReads=0;const rect=seat.getBoundingClientRect.bind(seat);seat.getBoundingClientRect=()=>{rectReads++;return rect();};
      reconciles=styleMutations=resizes=0;
      const top=header.getBoundingClientRect().top;
      for(let height=795;height>=500;height-=5){send(height);await tick();}
      const value={frames:60,reconciles,styleMutations,resizes,rectReads,headerDelta:header.getBoundingClientRect().top-top,
        bottom:rect().bottom,inlineTransform:seat.style.transform,inlineTranslate:seat.style.translate};
      // 同一真实上游观察器的正控：inline style 每帧确会唤醒其任务。
      let before=reconciles;
      for(let i=0;i<5;i++){seat.style.setProperty('--fixture-inline-write',String(i));await tick();}
      value.inlineControlReconciles=reconciles-before;
      seat.style.removeProperty('--fixture-inline-write');
      return value;
    });
    assert.equal(mechanism.reconciles,0);assert.equal(mechanism.styleMutations,0);assert.equal(mechanism.resizes,0);
    assert.ok(mechanism.rectReads<=2,JSON.stringify(mechanism));assert.equal(mechanism.headerDelta,0);
    assert.ok(Math.abs(mechanism.bottom-500)<0.6);assert.equal(mechanism.inlineTransform,'');assert.equal(mechanism.inlineTranslate,'');
    assert.ok(mechanism.inlineControlReconciles>=5,'真实上游 observer 的 inline 属性负控应唤醒任务');
    // native 末态 resize 与 end 包两种先后顺序均按同一绝对坐标收敛。
    await page.evaluate(async()=>{send(500,'end');await tick();});
    await page.setViewportSize({width:360,height:500});
    await page.evaluate(async()=>{await tick();});
    assert.ok(await page.locator('.abc_composerSeat').evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-500)<0.6));
    assert.equal(await page.locator('.abc_composerSeat').getAttribute('data-dsha-ime-seat'),null);
    // hide 边界扩容仍保持旧绝对目标；随后只有 composer 随实际帧移动。
    await page.setViewportSize({width:360,height:800});
    await page.evaluate(async()=>{await tick();});
    assert.ok(await page.locator('.abc_composerSeat').evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-500)<0.6));
    await page.evaluate(async()=>{for(let h=520;h<=800;h+=20){send(h,'frame',2);await tick();}send(800,'end',2);await tick();});
    assert.equal(await page.locator('.abc_composerSeat').getAttribute('data-dsha-ime-seat'),null);
    // 忙 renderer 的 end 排队、旧 epoch、错误身份、取消后晚到帧、用户样式与新绑定。
    const safety = await page.evaluate(async()=>{
      send(650,'frame',3);send(500,'end',3);await tick();
      const bottom=document.querySelector('.abc_composerSeat').getBoundingClientRect().bottom;
      send(200,'frame',2);send(200,'frame',3,{nonce:'2'.repeat(32)});await tick();
      const unchanged=document.querySelector('.abc_composerSeat').getBoundingClientRect().bottom;
      send(0,'cancel',4);await tick();
      send(200,'frame',3);await tick();
      const canceled=document.querySelector('.abc_composerSeat').getAttribute('data-dsha-ime-seat')===null;
      const seat=document.querySelector('.abc_composerSeat');seat.style.transform='translateX(4px)';
      send(400,'frame',5);await tick();send(0,'cancel',6);await tick();
      const retained=seat.style.transform==='translateX(4px)';seat.style.transform='';
      send(400,'frame',7);await tick();window.dispatchEvent(new Event('blur'));await tick();
      const blur=seat.getAttribute('data-dsha-ime-seat')===null;
      __dshaNativePresentation.install({...binding,nonce:'3'.repeat(32),generation:8,instance:'replacement'});
      send(200,'frame',8);await tick();
      return {bottom,unchanged,canceled,retained,blur,oldBindingIgnored:seat.getAttribute('data-dsha-ime-seat')===null,
        ackSupported:acks.some(row=>row.type==='ime-ack'&&row.supported===true),ackUnsupported:acks.some(row=>row.type==='ime-ack'&&row.supported===false)};
    });
    assert.ok(Math.abs(safety.bottom-500)<0.6);assert.equal(safety.unchanged,safety.bottom);
    for(const key of ['canceled','retained','blur','oldBindingIgnored','ackSupported','ackUnsupported'])assert.equal(safety[key],true,key);
    // 同一保留文档旋转或重新认领后，新 epoch 可以从新的帧序号开始；旧宿主不能覆盖它。
    await page.evaluate(async()=>{
      binding={nonce:'3'.repeat(32),generation:8,instance:'replacement'};
      send(700,'frame',100,{frameId:1});await tick();
    });
    assert.ok(await page.locator('.abc_composerSeat').evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-700)<0.6));
    await page.setViewportSize({width:400,height:800});
    await page.evaluate(async()=>{send(0,'cancel',101);send(600,'frame',102,{width:800,frameId:1});await tick();});
    assert.ok(await page.locator('.abc_composerSeat').evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-600)<0.6));
    assert.equal(await page.locator('header').evaluate(el=>el.getBoundingClientRect().top),0);
    const fallback = await page.evaluate(async()=>{
      send(0,'cancel',103);await tick();
      const seat=document.querySelector('.abc_composerSeat');
      send(400,'frame',103);
      __dshaNativePresentation.install({...binding,generation:9,instance:'same-nonce-new-generation'});
      await tick();
      const fullBindingReset=!seat.hasAttribute('data-dsha-ime-seat');
      binding={...binding,generation:9,instance:'same-nonce-new-generation'};
      seat.querySelector('[data-composer-input]').blur();
      send(400,'frame',104);await tick();
      const noComposer=acks.at(-1).type==='ime-ack'&&acks.at(-1).supported===false
        &&!seat.hasAttribute('data-dsha-ime-seat');
      seat.querySelector('[data-composer-input]').focus();send(400,'frame',105);await tick();
      seat.style.translate='7px 9px';send(350,'frame',105);await tick();
      send(0,'cancel',106);await tick();
      return {fullBindingReset,noComposer,userTranslatePreserved:seat.style.translate==='7px 9px'};
    });
    assert.deepEqual(fallback,{fullBindingReset:true,noComposer:true,userTranslatePreserved:true});
    results.push({transport,mechanism,safety,fallback});
    await page.close();
  }
  // 首页 hero：官方 ConversationRoot 样式（scrollBody 居中）+ 当前移动插件；键盘开合不跳变、根不滚动。
  const runtime=process.env.DSHA_TEST_RUNTIME||JSON.parse(fs.readFileSync('app/build/test-runtimes/current.json','utf8')).raw;
  const conversation=fs.readFileSync(runtime+'/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js','utf8');
  const officialCss=[4,3].map(n=>JSON.parse(conversation.match(new RegExp('const css\\$'+n+' = ("(?:[^"\\\\]|\\\\.)*");'))[1])).join('');
  assert.match(officialCss,/data-phase=hero\] \.wSkVaW_scrollBody[^}]*justify-content:center/,'官方 hero 居中锚点变化');
  const heroPage=async({translate=true,reduce=false}={})=>{
    const page=await fixture.browser.newPage({viewport:{width:360,height:800},hasTouch:true});
    if(reduce)await page.emulateMedia({reducedMotion:'reduce'});
    page.on('pageerror',e=>fixture.errors.push(String(e)));
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;height:100%}#app{height:100%}${officialCss}</style></head><body><div id="app"><div data-mobile-nav="frame" style="height:100%;display:grid"><div class="wSkVaW_root" data-phase="hero"><header class="wSkVaW_header wSkVaW_headerBlank">H</header><div class="wSkVaW_viewArea"><div class="wSkVaW_body" data-content-phase="hero"><div class="wSkVaW_scrollBody" data-conversation-scroll><div class="wSkVaW_composerSeat" data-composer-seat><div class="wSkVaW_composerStack wSkVaW_composerHero"><div class="pXSMma_root"><div class="pXSMma_headline">探索未至之境 预览版</div></div><div class="wSkVaW_heroWorkspaceRow">默认工作区 标准模式</div><div class="card" style="height:120px"><div data-composer-input contenteditable="true">x</div></div></div></div></div></div></div></div></div></div></body></html>`);
    await page.evaluate(translate=>{
      window.__ModuleLoader__={load:({factory})=>factory(()=>({}))};window.disposers=[];window.acks=[];
      window.binding={nonce:'4'.repeat(32),generation:1,instance:'hero'};
      window.DshaTheme={postMessage:text=>acks.push(JSON.parse(text))};
      if(!translate){const supports=CSS.supports.bind(CSS);CSS.supports=(p,v)=>p==='translate'?false:v===undefined?supports(p):supports(p,v);}
    },translate);
    await page.addScriptTag({content:mobile.replace('var __cache = {};','window.mobileRequire=__localRequire; var __cache = {};')});
    await page.evaluate(()=>mobileRequire('./effects/phone-chrome.js').installPhoneChrome({effect:run=>disposers.push(run())}));
    await page.addScriptTag({content:asset('ime.js')});
    await page.addScriptTag({content:asset('page.js')});
    await page.evaluate(()=>{
      __dshaNativePresentation.install(binding);
      window.tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.frameId=0;window.send=(height,phase='frame',epoch=1)=>__dshaNativePresentation.ime({...binding,frameId:++frameId,epoch,width:720,height:height*2,phase});
      window.card=()=>document.querySelector('.card').getBoundingClientRect().bottom;
      document.querySelector('[data-composer-input]').focus();
    });
    return page;
  };
  {
    const page=await heroPage();
    const open=await page.evaluate(async()=>{
      const start=card(),bottoms=[];
      for(let h=800;h>=500;h-=25){send(h);await tick();bottoms.push(card());}
      send(500,'end');await tick();
      return {start,bottoms,end:card(),ack:acks.filter(a=>a.type==='ime-ack').at(-1)?.supported};
    });
    await page.setViewportSize({width:360,height:500});
    const resized=await page.evaluate(async()=>{await tick();return {card:card(),seat:document.querySelector('.wSkVaW_composerSeat').hasAttribute('data-dsha-ime-seat')};});
    assert.equal(open.ack,true);
    // 键盘未触及前 hero 不动；之后单调上移，卡片底边紧贴键盘上沿（8px）且从不低于键盘。
    assert.ok(Math.abs(open.bottoms[0]-open.start)<0.6&&Math.abs(open.bottoms[4]-open.start)<0.6,JSON.stringify(open));
    for(let i=1;i<open.bottoms.length;i++)assert.ok(open.bottoms[i]<=open.bottoms[i-1]+0.01,JSON.stringify(open));
    assert.ok(Math.abs(open.end-(500-8))<0.6,JSON.stringify(open));
    // native 末态 resize 后不再按半个键盘高度回落（原实现：-300 平移后回跳 150px）。
    assert.ok(Math.abs(resized.card-open.end)<0.6,JSON.stringify({open,resized}));
    assert.equal(resized.seat,true);
    await page.setViewportSize({width:360,height:800});
    const closed=await page.evaluate(async()=>{
      await tick();const expanded=card();
      for(let h=520;h<=800;h+=20){send(h,'frame');await tick();}
      send(800,'end');await tick();
      return {expanded,end:card(),seat:document.querySelector('.wSkVaW_composerSeat').hasAttribute('data-dsha-ime-seat')};
    });
    assert.ok(Math.abs(closed.expanded-(500-8))<0.6,JSON.stringify(closed));
    assert.ok(Math.abs(closed.end-open.start)<0.6,JSON.stringify({open,closed}));
    assert.equal(closed.seat,false);
    // 根滚动守卫：横向溢出与 scroll-into-view 都不能把整页推上/推左。
    const root=await page.evaluate(async()=>{
      const wide=document.createElement('div');wide.style.cssText='width:600px;height:1200px';document.body.appendChild(wide);
      window.scrollTo(120,300);await tick();
      document.querySelector('[data-composer-input]').scrollIntoView({block:'center',inline:'center'});await tick();
      const value={x:scrollX,y:scrollY,lock:document.documentElement.hasAttribute('data-dsha-root-lock'),
        overflowX:getComputedStyle(document.documentElement).overflowX};
      // 内部滚动容器不受影响。
      const inner=document.createElement('div');inner.style.cssText='position:fixed;top:0;left:0;width:100px;height:100px;overflow:auto';
      inner.appendChild(Object.assign(document.createElement('div'),{style:'height:2000px;width:900px'}));document.body.appendChild(inner);
      inner.scrollTop=100;inner.scrollLeft=50;await tick();value.inner=[inner.scrollTop,inner.scrollLeft,scrollX,scrollY];inner.remove();wide.remove();
      return value;
    });
    assert.deepEqual(root,{x:0,y:0,lock:true,overflowX:'hidden',inner:[100,50,0,0]});
    await page.close();
  }
  for(const reduce of [false,true]){
    // 旧 WebView（无 CSS translate）：桥 ack 不支持，原生末尾一次 resize；hero 用 FLIP 平滑，减弱动效时不动画。
    const page=await heroPage({translate:false,reduce});
    const before=await page.evaluate(async()=>{send(700);await tick();return {ack:acks.filter(a=>a.type==='ime-ack').at(-1)?.supported,card:card()};});
    await page.setViewportSize({width:360,height:500});
    const after=await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(r));
      const seat=document.querySelector('.wSkVaW_composerSeat');
      return {animations:seat.getAnimations().length,attr:seat.hasAttribute('data-dsha-ime-seat')};});
    assert.equal(before.ack,false);assert.equal(after.attr,false);
    assert.equal(after.animations,reduce?0:1,JSON.stringify({reduce,before,after}));
    await page.close();
  }
  {
    // 侧栏弹出菜单残留：真实宿主 Menu（primitives，portal 到 body、每帧按锚点夹回视口）。
    const page=fixture.page;
    await page.evaluate(()=>{
      document.body.innerHTML='<div data-mobile-nav="frame" style="position:fixed;inset:0"><div data-pane="sidebar" id="pane" style="position:absolute;left:0;top:0;width:280px;height:100%;transition:none"><div id="drawer-root" style="padding-top:300px"></div><div id="third"></div></div><main data-conversation-content data-conversation-session="s1" style="position:absolute;left:0;right:0;top:0;bottom:0;overflow:auto" id="main"><div style="height:3000px"></div></main></div>';
      const React=auditModules.react,{jsx}=auditModules['react/jsx-runtime'],{createRoot}=auditModules['react-dom/client'];
      const {Menu}=auditModules['@deepseek-ai/dsh-client-ui-primitives'];
      window.closes=0;
      function Item(){const [open,setOpen]=React.useState(false);window.openMenu=()=>setOpen(true);
        return jsx(Menu,{open,portal:true,items:[{id:'browse',label:'浏览更多插件'},{id:'create',label:'创建你的插件'}],
          onClose:()=>{closes++;setOpen(false);},anchor:jsx('button',{id:'plugins','aria-haspopup':'menu','aria-expanded':String(open),children:'插件'})});}
      createRoot(document.getElementById('drawer-root')).render(jsx(Item,{}));
      window.tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.collapse=async collapsed=>{const f=document.querySelector('[data-mobile-nav="frame"]'),pane=document.getElementById('pane');
        pane.style.transform=collapsed?'translateX(-110%)':'';collapsed?f.setAttribute('data-sidebar-collapsed',''):f.removeAttribute('data-sidebar-collapsed');await tick();await tick();};
      window.menu=()=>document.querySelector('[role="menu"]');
    });
    const control=await page.evaluate(async()=>{
      openMenu();await tick();const opened=!!menu();
      await collapse(true);
      const r=menu()?.getBoundingClientRect();
      const value={opened,orphan:!!menu(),left:r&&Math.round(r.left),top:r&&Math.round(r.top),closes};
      await collapse(false);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();
      return value;
    });
    // 负控：无守卫时抽屉经非指针路径关闭（返回键/导航），宿主菜单仍开着并被夹回到可见区（left≤12，primitives Menu 夹边）。
    assert.deepEqual({...control,left:undefined,top:undefined},{opened:true,orphan:true,left:undefined,top:undefined,closes:0},JSON.stringify(control));
    assert.ok(control.left>=0&&control.left<=12,JSON.stringify(control));
    await page.addScriptTag({content:asset('ime.js')});
    const guarded=await page.evaluate(async()=>{
      const out={},c0=closes;
      openMenu();await tick();await collapse(true);out.drawer=[!!menu(),closes-c0];
      // 抽屉开着时会话变化不发 Escape（否则会顺带关抽屉）。
      await collapse(false);openMenu();await tick();
      document.getElementById('main').setAttribute('data-conversation-session','s2');await tick();out.drawerOpenKept=!!menu();
      await collapse(true);out.afterCollapse=!menu();
      // 抽屉已关：会话切换、用户滚动都收起；程序化滚动（流式自动滚动）不收。
      openMenu();await tick();document.getElementById('main').setAttribute('data-conversation-session','s3');await tick();out.session=!menu();
      openMenu();await tick();document.getElementById('main').scrollTop=200;await tick();out.programmaticKept=!!menu();
      window.dispatchEvent(new TouchEvent('touchmove',{bubbles:true}));document.getElementById('main').scrollTop=400;await tick();out.userScroll=!menu();
      // 不认 Escape 的第三方弹层：只隐藏、不伪造事件；重新点触发器时撤销隐藏。
      const third=document.getElementById('third');third.innerHTML='<div role="menu" id="tp" style="position:fixed;left:40px;top:300px;width:160px;height:80px">第三方</div>';
      document.body.appendChild(document.getElementById('tp'));
      await collapse(false);await collapse(true);await tick();
      const tp=document.getElementById('tp');out.thirdHidden=tp.hasAttribute('data-dsha-orphan-popover')&&getComputedStyle(tp).visibility==='hidden';
      tp.remove();out.closes=closes;
      return out;
    });
    assert.deepEqual(guarded,{drawer:[false,1],drawerOpenKept:true,afterCollapse:true,session:true,programmaticKept:true,userScroll:true,thirdHidden:true,closes:guarded.closes},JSON.stringify(guarded));
  }
  assert.deepEqual(fixture.errors,[]);
  console.log(JSON.stringify({engine:process.env.DSHA_BROWSER||'chromium',status:'PASS',results},null,2));
} finally { await fixture.close(); }
