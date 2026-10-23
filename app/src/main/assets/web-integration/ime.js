/* 原生只提供实际可见区域；本模块不预测键盘高度或自行补间。 */
window.__dshaIme = window.__dshaIme || (() => {
  let binding, epoch = 0, lastId = 0, target, seat, token, written, sheet, rule;
  let originalTranslate, originalTransform;
  let raf = 0, pendingAck, drivenAt = -Infinity;
  // 首页 hero（[data-content-phase="hero"]）的 seat 由官方 scrollBody 的 justify-content:center 居中，
  // 不贴底：整段按键盘高度平移会把输入框推到键盘上方很远处，末态 resize 后又按半个键盘高度回落（跳变）。
  // hero 模式改为绝对目标：seat 底边 = min(键盘弹出前的底边 anchor, 可见区底边)，
  // 布局只在 acquire/resize/seat 尺寸变化时读取一次，不逐帧读 DOM 几何。
  let hero = false, natural = 0, anchor = 0, applied = 0, lift = 0, seatObserver;
  // hero 栈自带底部留白（官方 composerHero padding-bottom:32px）；贴键盘时只保留 8px，输入卡片紧贴键盘上沿。
  const HERO_GAP = 8;
  const HERO = '[data-content-phase="hero"],[data-phase="hero"]';
  const same = packet => binding && packet && packet.nonce === binding.nonce
    && packet.generation === binding.generation && packet.instance === binding.instance;
  const ensureSheet = () => {
    if (sheet?.isConnected && rule) return true;
    sheet = document.createElement('style');
    sheet.setAttribute('data-dsha-ime-sheet', '1');
    (document.head || document.documentElement).appendChild(sheet);
    if (!sheet.sheet) return false;
    sheet.sheet.insertRule('[data-dsha-ime-seat] {}', 0);
    // 根滚动守卫的样式半：应用 frame 恰好一屏高，文档本身永不横向滚动。
    sheet.sheet.insertRule('html[data-dsha-root-lock] { overflow-x: hidden !important; overscroll-behavior-x: none !important; }', 1);
    rule = sheet.sheet.cssRules[0];
    return true;
  };
  const restore = () => {
    if (seat && seat.getAttribute('data-dsha-ime-seat') === token) seat.removeAttribute('data-dsha-ime-seat');
    rule?.style.removeProperty('translate');
    seatObserver?.disconnect(); seatObserver = undefined;
    seat = token = undefined; written = undefined;
    hero = false; natural = anchor = applied = lift = 0;
  };
  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; target = undefined;
    if (pendingAck) pendingAck(false);
    pendingAck = undefined; restore();
  };
  // 读取 seat 未平移时的布局底边；translate 不改布局，rect 减去已施加偏移即为布局位置。
  const measure = () => {
    if (!seat) return;
    hero = !!seat.closest(HERO);
    if (!hero) return;
    natural = seat.getBoundingClientRect().bottom - applied;
    const stack = seat.firstElementChild;
    const pad = stack ? parseFloat(getComputedStyle(stack).paddingBottom) : 0;
    lift = Number.isFinite(pad) ? Math.max(0, pad - HERO_GAP) : 0;
  };
  const acquire = () => {
    if (seat?.isConnected) return true;
    restore();
    const input = document.activeElement;
    const found = input?.closest?.('[class*="_composerSeat"]');
    if (!found || !found.closest('[data-mobile-nav="frame"]')
        || !input.closest('[data-composer-input]')
        || typeof CSS === 'undefined' || !CSS.supports('translate', '0 1px')) return false;
    const css = getComputedStyle(found);
    // 不覆盖用户或其他插件持有的变换；iOS 专用 lift 仍归上游处理。
    if (found.hasAttribute('data-dsha-ime-seat') || css.transform !== 'none' || css.translate && css.translate !== 'none') return false;
    if (!ensureSheet()) return false;
    seat = found;
    originalTranslate = seat.style.getPropertyValue('translate');
    originalTransform = seat.style.getPropertyValue('transform');
    token = binding.nonce + '-' + epoch;
    rule.selectorText = `[data-dsha-ime-seat="${token}"]`;
    seat.setAttribute('data-dsha-ime-seat', token);
    applied = 0; measure(); anchor = natural;
    if (hero && typeof ResizeObserver === 'function') {
      // hero 内输入多行增高或切到 active 相位时重新取布局；只在尺寸真正变化时触发。
      seatObserver = new ResizeObserver(() => { measure(); schedule(); });
      seatObserver.observe(seat);
    }
    return true;
  };
  const flush = () => {
    raf = 0;
    let supported = false;
    try {
    if (target && !document.hidden && (!window.visualViewport || Math.abs(window.visualViewport.scale - 1) < 0.01)
        && window.innerWidth > 0 && acquire()) {
      if (seat.getAttribute('data-dsha-ime-seat') === token
          && seat.style.getPropertyValue('translate') === originalTranslate
          && seat.style.getPropertyValue('transform') === originalTransform) {
        const visible = target.height * window.innerWidth / target.width;
        // 贴底 seat：绝对可见高度减当前浏览器视口，保留 composer 原有底部间距。
        // hero seat：只在键盘碰到它时随键盘上移，末态 resize 后仍收敛到同一绝对底边。
        const offset = hero ? Math.min(anchor, visible + lift) - natural : Math.min(0, visible - window.innerHeight);
        if (Number.isFinite(offset)) {
          const next = `0 ${offset}px`;
          // CSSOM 不改 seat/root 的 style 属性，避免上游 MutationObserver 每帧全树 reconcile。
          if (next !== written) rule.style.setProperty('translate', next, 'important');
          written = next; applied = offset; supported = true; drivenAt = performance.now();
          // 末态 native resize 与消息异步到达均使用相同绝对目标；偏移归零才还原自有样式。
          if (target.phase === 'end' && Math.abs(offset) < 0.5) restore();
        }
      }
    }
    } catch (_) { supported = false; }
    if (!supported) restore();
    const ack = pendingAck; pendingAck = undefined;
    if (ack) ack(supported);
  };
  const schedule = () => { if (target && !raf) raf = requestAnimationFrame(flush); };
  // 不支持逐帧桥（旧 WebView 无 CSS translate、缩放中等）时，原生只在动画末尾 resize 一次：
  // hero 居中块用一次 FLIP 过渡代替瞬跳；Android 6 WebView 亦有 Element.animate。
  let flipSeat, flipTop;
  const heroSeat = () => {
    const input = document.activeElement;
    const found = input?.closest?.('[data-composer-input]') && input.closest('[class*="_composerSeat"]');
    return found && found.closest('[data-mobile-nav="frame"]') && found.closest(HERO) ? found : undefined;
  };
  const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.addEventListener('focusin', () => {
    flipSeat = heroSeat();
    flipTop = flipSeat ? flipSeat.getBoundingClientRect().top : undefined;
  }, true);
  const flip = () => {
    const current = heroSeat();
    if (!current || current !== flipSeat || flipTop === undefined) { flipSeat = current; flipTop = current?.getBoundingClientRect().top; return; }
    const top = current.getBoundingClientRect().top;
    const delta = flipTop - top;
    flipTop = top;
    // 桥正在驱动（已认领 seat 或刚逐帧平移过）时由逐帧 translate 负责，不叠加第二套补偿。
    if (seat || performance.now() - drivenAt < 400 || Math.abs(delta) < 1 || reducedMotion()
        || typeof current.animate !== 'function' || getComputedStyle(current).transform !== 'none') return;
    try {
      current.animate([{transform: `translateY(${delta}px)`}, {transform: 'translateY(0px)'}],
        {duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)'});
    } catch (_) { /* 动画不可用时保持原生 resize 的即时结果 */ }
  };
  // 根滚动守卫：应用 frame 设计为恰好一屏高、文档永不滚动；Chromium 聚焦可编辑元素后的
  // scroll-into-view 或任何横向溢出都只会把整页推上/推左（左缘裁切、出现竖向滚动条）。
  // 仅在 frame 存在且未被用户缩放时把根滚动夹回 0；内部滚动容器不受影响。
  const lockRoot = () => {
    if (!document.querySelector('[data-mobile-nav="frame"]')) return false;
    if (!document.documentElement.hasAttribute('data-dsha-root-lock')) {
      ensureSheet();
      document.documentElement.setAttribute('data-dsha-root-lock', '');
    }
    return true;
  };
  const clampRoot = () => {
    if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) >= 0.01) return;
    if ((window.scrollX || window.scrollY) && lockRoot()) window.scrollTo(0, 0);
  };
  window.addEventListener('scroll', clampRoot, {passive: true});
  window.addEventListener('resize', () => {
    clampRoot();
    if (seat && hero) measure();
    schedule();
    flip();
  });
  window.addEventListener('blur', cancel);
  window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  return {
    bind(next) {
      if (!same(next)) { cancel(); epoch = lastId = 0; }
      binding = next;
      lockRoot();
    },
    cancel,
    receive(packet, ack) {
      if (!same(packet) || !Number.isSafeInteger(packet.epoch) || packet.epoch < epoch
          || !Number.isSafeInteger(packet.frameId) || packet.frameId <= 0
          || packet.epoch === epoch && packet.frameId <= lastId) return;
      if (packet.epoch > epoch) { cancel(); epoch = packet.epoch; lastId = 0; }
      lastId = packet.frameId;
      if (packet.phase === 'cancel') { cancel(); ack({frameId:packet.frameId,supported:false}); return; }
      if (!['frame','end'].includes(packet.phase) || !Number.isFinite(packet.width) || packet.width <= 0
          || packet.width > 1000000 || !Number.isFinite(packet.height) || packet.height <= 0 || packet.height > 1000000) return;
      target = packet;
      if (pendingAck) pendingAck(false);
      pendingAck = supported => ack({frameId:packet.frameId,supported});
      clampRoot();
      schedule();
    }
  };
})();
/* 手机抽屉内弹出的菜单（如侧栏「插件」的弹层）在抽屉关闭后残留：宿主 Menu 以 portal + position:fixed
 * 挂在 <body>，坐标只在打开时测一次；抽屉经返回键/导航/手势关闭时没有落到 document 的 pointerdown，
 * 菜单便悬在聊天页中部。这里只在手机 frame 下、抽屉已关闭时走宿主自己的关闭路径（Escape），
 * 移动插件同样用合成 Escape 驱动宿主菜单；抽屉开着时不发 Escape（那会顺带关抽屉）。 */
window.__dshaPopoverGuard = window.__dshaPopoverGuard || (() => {
  const MENU = '[role="menu"]';
  const TRIGGER = '[aria-haspopup][aria-expanded="true"]';
  const frame = () => document.querySelector('[data-mobile-nav="frame"]');
  const drawerClosed = () => { const f = frame(); return !!f && f.hasAttribute('data-sidebar-collapsed'); };
  const menus = () => Array.from(document.querySelectorAll(MENU)).filter(menu => !menu.parentElement?.closest(MENU));
  const visible = el => {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    const pane = el.closest('[data-pane="sidebar"]');
    return !(pane && drawerClosed());
  };
  let gesture = -Infinity, pending = 0, lastHref = location.href;
  const hide = menu => { menu.setAttribute('data-dsha-orphan-popover', ''); };
  const settle = list => {
    // 宿主或第三方弹层若不认 Escape（只认外部 pointerdown），不伪造指针事件，只把残留层隐藏；
    // 其自身状态仍为打开，用户下一次真实外部点按即由它自己收起。
    requestAnimationFrame(() => requestAnimationFrame(() => list.filter(menu => menu.isConnected).forEach(hide)));
  };
  const close = reason => {
    if (!frame() || !drawerClosed()) return false;
    const list = menus();
    if (!list.length) return false;
    for (const menu of list) {
      menu.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true}));
    }
    settle(list);
    return reason;
  };
  // 有触发器可查时：全部触发器都不可见（随抽屉滑出、被卸载）即视为孤儿。
  const orphaned = () => {
    const triggers = Array.from(document.querySelectorAll(TRIGGER));
    return triggers.length > 0 && !triggers.some(visible);
  };
  const check = reason => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; if (menus().length && (reason !== 'anchor' || orphaned())) close(reason); }); };
  const outside = target => !(target instanceof Element) || !target.closest(MENU) && !target.closest(TRIGGER);
  new MutationObserver(records => {
    for (const row of records) {
      if (row.attributeName === 'data-sidebar-collapsed' && row.target.hasAttribute?.('data-sidebar-collapsed')) { check('drawer'); return; }
      if (row.attributeName === 'data-conversation-session') { check('session'); return; }
    }
    if (location.href !== lastHref) { lastHref = location.href; check('route'); }
  }).observe(document.documentElement, {subtree: true, attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-conversation-session']});
  const route = () => { if (location.href !== lastHref) { lastHref = location.href; check('route'); } };
  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);
  // 外部点按：捕获于 window，早于任何 frame 级捕获拦截；事件后再判断，给宿主先收的机会。
  window.addEventListener('pointerdown', event => {
    if (!event.isTrusted) return;
    // 用户重新点开某个触发器时撤销隐藏，复用同一节点的弹层不会被永久藏起。
    if (event.target instanceof Element && event.target.closest('[aria-haspopup],[aria-expanded]'))
      document.querySelectorAll('[data-dsha-orphan-popover]').forEach(el => el.removeAttribute('data-dsha-orphan-popover'));
    if (!outside(event.target)) return;
    setTimeout(() => { if (menus().length) check('outside'); }, 0);
  }, true);
  // 只认用户手势带来的滚动；流式输出自动滚动、键盘根滚动夹回都不关菜单。
  const touched = () => { gesture = performance.now(); };
  window.addEventListener('touchmove', touched, {capture: true, passive: true});
  window.addEventListener('wheel', touched, {capture: true, passive: true});
  document.addEventListener('scroll', event => {
    if (performance.now() - gesture > 300 || !outside(event.target === document ? document.documentElement : event.target)) return;
    check('scroll');
  }, {capture: true, passive: true});
  window.addEventListener('resize', () => check('anchor'));
  const sheet = document.createElement('style');
  sheet.setAttribute('data-dsha-popover-guard', '1');
  sheet.textContent = '[data-dsha-orphan-popover]{visibility:hidden!important;pointer-events:none!important}';
  (document.head || document.documentElement).appendChild(sheet);
  return {close, check};
})();
