(function () {
  'use strict';

  var STATUSES = ['관심', '임장예정', '임장완료', '보류', '탈락', '계약'];
  var TRADE_TYPES = ['전세', '월세', '매매', '단기임대'];
  var LEVELS = ['좋음', '보통', '나쁨'];
  // 설정에서 바꾸기 전의 기본 지역 목록
  var DEFAULT_REGIONS = ['죽전', '구성', '기흥', '상갈', '신갈'];
  var STARS = [['1', '1★'], ['2', '2★'], ['3', '3★'], ['4', '4★'], ['5', '5★']];
  // 임장 체크리스트 (아파트 기준). 키는 시트의 '임장' 열과 맞습니다.
  var VISIT_GROUPS = [
    { title: '집 내부', items: [
      ['sunlight', '채광'], ['view', '조망·앞동 간격'], ['noise', '소음 (층간·외부)'], ['water', '수압·배수'],
      ['mold', '곰팡이·결로'], ['leak', '누수 흔적'], ['interior', '도배·장판·수리 상태'], ['windows', '창호·샷시'],
      ['kitchenBath', '주방·욕실'], ['layout', '구조·수납']] },
    { title: '단지·주변', items: [
      ['parkingReal', '주차 여건'], ['common', '엘리베이터·공용부'], ['transit', '역·버스 접근'], ['amenities', '편의시설·상권']] }
  ];
  var VISIT_EXTRA = [
    { title: '확인 사항', items: [['expanded', '확장 여부'], ['occupant', '현 거주자'], ['options', '옵션'], ['boiler', '보일러']] },
    { title: '총평', items: [['pros', '장점'], ['cons', '단점'], ['memo', '메모']] }
  ];
  // 매물 입력 항목. [키, 이름, 옵션]. locked 는 항상 표시, full 은 한 줄 전체 사용.
  var LISTING_GROUPS = [
    { title: '기본 정보', prefix: 'l', fields: [
      ['name', '단지·건물명', { full: 1, locked: 1 }],
      ['dongHo', '동/호', { locked: 1 }],
      ['region', '지역', { locked: 1, region: 1 }],
      ['status', '상태', { options: STATUSES, newOnly: 1, locked: 1 }],
      ['visitPlan', '임장 예정 일시', { type: 'datetime-local', existingOnly: 1, full: 1 }],
      ['address', '주소', { full: 1 }],
      ['tradeType', '거래유형', { options: TRADE_TYPES }],
      ['deposit', '보증금 (만원)', { number: 1, locked: 1 }],
      ['rent', '월세 (만원, 있을 때만)', { number: 1 }],
      ['loan', '융자금']] },
    { title: '상세 정보', prefix: 'l', fields: [
      ['supplyArea', '공급면적 (㎡)', { number: 1 }], ['exclusiveArea', '전용면적 (㎡)', { number: 1 }],
      ['floor', '해당층'], ['totalFloor', '총층'],
      ['rooms', '방 수'], ['baths', '욕실 수'],
      ['direction', '방향'], ['moveIn', '입주가능일'],
      ['maintenanceFee', '관리비'], ['parking', '주차'],
      ['naverNo', '네이버 매물번호'], ['confirmedDate', '매물 확인일'],
      ['features', '매물특징', { full: 1 }],
      ['description', '매물설명', { full: 1, area: 4 }]] },
    { title: '단지·시세', prefix: 'l', fields: [
      ['households', '세대수'], ['approvalDate', '사용승인일'],
      ['entrance', '현관구조'], ['heating', '난방'],
      ['dealHigh', '전세 실거래 3년 최고'], ['dealLow', '전세 실거래 3년 최저'],
      ['school', '배정 초등학교', { full: 1 }]] },
    { title: '중개사', prefix: 'a', fields: [
      ['name', '상호', { full: 1 }], ['rep', '대표자'], ['regNo', '등록번호'],
      ['phone', '전화', { full: 1 }], ['address', '소재지', { full: 1 }]] },
    { title: '메모', prefix: 'l', fields: [['memo', '우리끼리 메모', { full: 1, area: 3 }]] }
  ];
  // 설정의 "핵심만 남기기"에서 남길 항목
  var ESSENTIAL = ['l.visitPlan', 'l.exclusiveArea', 'l.floor', 'l.totalFloor', 'l.direction', 'l.moveIn',
    'l.maintenanceFee', 'l.features', 'l.memo', 'a.name', 'a.phone',
    'v.sunlight', 'v.noise', 'v.water', 'v.mold', 'v.interior', 'v.parkingReal', 'v.pros', 'v.cons', 'v.memo'];
  var SESSION_KEY = 'jn-session';
  var DEMO_KEY = 'jn-demo-db';
  var DEMO = !window.CONFIG || !window.CONFIG.API_URL;

  var app = document.getElementById('app');
  var state = { session: loadSession(), listings: [], agents: [], visits: [], settings: { hidden: [], regions: DEFAULT_REGIONS.slice() }, loaded: false, filter: '전체', region: '전체', showDropped: false, sort: 'recent' };

  /** 설정에서 숨기지 않은 항목인지. key 예: 'l.loan', 'a.rep', 'v.noise' */
  function isShown(key) {
    return state.settings.hidden.indexOf(key) < 0;
  }

  /** 서버에서 받은 설정을 화면용으로 정리. 지역 목록이 없으면(이전 버전 서버) 기본값 */
  function normalizeSettings(s) {
    s = s || {};
    return {
      hidden: Array.isArray(s.hidden) ? s.hidden : [],
      regions: Array.isArray(s.regions) ? s.regions : DEFAULT_REGIONS.slice()
    };
  }

  /** 주소·단지명·매물특징에서 지역명을 찾습니다. '기흥구'처럼 구 이름으로 쓰인 곳은 건너뜁니다. */
  function detectRegion(l) {
    var texts = [l.address, l.name, l.features];
    for (var i = 0; i < texts.length; i++) {
      var text = String(texts[i] || '');
      for (var j = 0; j < state.settings.regions.length; j++) {
        var r = state.settings.regions[j];
        var re = new RegExp(r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!구)');
        if (re.test(text)) return r;
      }
    }
    return '';
  }

  /** 매물의 지역. 직접 고른 값이 없으면 주소에서 추정 */
  function regionOf(l) {
    return l.region || detectRegion(l);
  }

  /* ---------- 공통 ---------- */

  function esc(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.hidden = true; }, 2500);
  }

  /** 35000 → "3억 5,000" */
  function formatMoney(v) {
    var n = Number(v);
    if (!v || isNaN(n)) return '';
    var eok = Math.floor(n / 10000), rest = n % 10000;
    return (eok ? eok + '억' : '') + (eok && rest ? ' ' : '') + (rest ? rest.toLocaleString('ko-KR') : '') + (eok ? '' : '만');
  }

  function priceText(l) {
    var dep = formatMoney(l.deposit);
    if (!dep) return '가격 미입력';
    return (l.tradeType || '전세') + ' ' + dep + (l.rent ? ' / ' + l.rent : '');
  }

  function titleOf(l) {
    return (l.name || '이름 없는 매물') + (l.dongHo ? ' ' + l.dongHo : '');
  }

  /** "2026-11-20T14:00" → "11-20 14:00" */
  function shortDateTime(v) {
    return String(v || '').replace('T', ' ').slice(5, 16);
  }

  /**
   * 임장 예정 일시를 오늘 기준으로 풀어 씁니다.
   * 반환: { text: '내일 14:00', when: '11/20(금) 14:00', level: 'past' | 'today' | 'soon' | 'later' | 'none' }
   */
  function planInfo(v) {
    var m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return { text: '일시 미정', when: '', level: 'none' };
    var day = new Date(+m[1], +m[2] - 1, +m[3]);
    var at = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59));
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((day - today) / 86400000);
    var time = m[4] ? ' ' + m[4] + ':' + m[5] : '';
    var when = +m[2] + '/' + +m[3] + '(' + '일월화수목금토'.charAt(day.getDay()) + ')' + time;
    if (at < now) return { text: diff === 0 ? '오늘' + time + ' 지남' : -diff + '일 지남', when: when, level: 'past' };
    if (diff === 0) return { text: '오늘' + time, when: when, level: 'today' };
    if (diff === 1) return { text: '내일' + time, when: when, level: 'soon' };
    return { text: 'D-' + diff, when: when, level: diff <= 3 ? 'soon' : 'later' };
  }

  /** 상태가 '임장예정'인 매물을 가까운 일정부터. 일시 미정은 맨 뒤 */
  function plannedListings() {
    return state.listings.filter(function (l) { return l.status === '임장예정'; }).sort(function (a, b) {
      return String(a.visitPlan || '9').localeCompare(String(b.visitPlan || '9'));
    });
  }

  function nowLocal() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function stars(v) {
    var n = Number(v);
    return n ? '★' + (Math.round(n * 10) / 10) : '';
  }

  function byId(list, id) {
    return list.filter(function (x) { return x.id === id; })[0] || null;
  }

  function agentOf(l) { return byId(state.agents, l.agentId); }

  function visitsOf(listingId) {
    return state.visits.filter(function (v) { return v.listingId === listingId; })
      .sort(function (a, b) { return String(b.visitedAt).localeCompare(String(a.visitedAt)); });
  }

  /** 임장 기록들에서 '나쁨'으로 표시한 항목 이름 */
  function badItems(visits) {
    var out = [];
    VISIT_GROUPS.forEach(function (g) {
      g.items.forEach(function (it) {
        var bad = visits.some(function (v) { return v[it[0]] === '나쁨'; });
        if (bad) out.push(it[1].replace(/\s*\(.*\)/, ''));
      });
    });
    return out;
  }

  function avgRating(visits) {
    var rated = visits.map(function (v) { return Number(v.rating); }).filter(Boolean);
    return rated.length ? rated.reduce(function (a, b) { return a + b; }, 0) / rated.length : 0;
  }

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch (e) { return null; }
  }

  function saveSession(session, remember) {
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) { /* 저장이 막힌 브라우저에서는 새로고침 시 다시 입력 */ }
  }

  function logout() {
    try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    state.session = null;
    state.loaded = false;
    location.hash = '';
    render();
  }

  /* ---------- 서버 통신 ---------- */

  function api(action, data) {
    var body = Object.assign({ action: action, password: state.session.password }, data || {});
    if (DEMO) return demoApi(body);
    // text/plain 으로 보내야 브라우저가 사전 요청(preflight)을 하지 않습니다.
    return fetch(window.CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); }).then(function (json) {
      if (!json.ok) {
        var err = new Error(json.error || '요청에 실패했습니다.');
        err.code = json.code;
        throw err;
      }
      return json.data;
    });
  }

  // 체험 모드: 서버 없이 이 브라우저에만 저장 (Code.gs 와 같은 규칙)
  function demoApi(req) {
    var db;
    try { db = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch (e) {}
    db = Object.assign({ listings: [], agents: [], visits: [], settings: { hidden: [], regions: DEFAULT_REGIONS.slice() } }, db || {});
    if (!Array.isArray(db.settings.regions)) db.settings.regions = DEFAULT_REGIONS.slice();
    var now = nowLocal().replace('T', ' ');
    var newId = function (p) { return p + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); };
    var result = true;

    if (req.action === 'list') result = db;

    if (req.action === 'saveListing') {
      var agent = null, a = req.agent || {};
      if (a.name || a.rep || a.regNo || a.phone || a.address) {
        var found = db.agents.filter(function (x) {
          return a.id ? x.id === a.id : (a.regNo ? x.regNo === a.regNo : a.phone ? x.phone === a.phone : x.name === a.name);
        })[0];
        agent = Object.assign(found || { createdAt: now }, a);
        agent.id = found ? found.id : newId('A');
        if (!found) db.agents.push(agent);
      }
      var l = req.listing || {};
      var old = byId(db.listings, l.id);
      var listing = Object.assign(old || { createdAt: now, author: req.author }, l);
      listing.id = old ? old.id : newId('L');
      listing.updatedAt = now;
      listing.status = listing.status || '관심';
      listing.agentId = agent ? agent.id : '';
      if (!old) db.listings.push(listing);
      result = { listing: listing, agent: agent };
    }

    if (req.action === 'deleteListing') {
      db.listings = db.listings.filter(function (x) { return x.id !== req.id; });
      db.visits = db.visits.filter(function (x) { return x.listingId !== req.id; });
    }

    if (req.action === 'setStatus') {
      var target = byId(db.listings, req.id);
      if (target) { target.status = req.status; target.updatedAt = now; }
    }

    if (req.action === 'saveVisit') {
      var v = req.visit || {};
      var oldVisit = byId(db.visits, v.id);
      var visit = Object.assign(oldVisit || { createdAt: now, author: req.author }, v);
      visit.id = oldVisit ? oldVisit.id : newId('V');
      visit.updatedAt = now;
      if (!oldVisit) {
        db.visits.push(visit);
        var owner = byId(db.listings, visit.listingId);
        if (owner && ['', '관심', '임장예정'].indexOf(owner.status || '') >= 0) owner.status = '임장완료';
      }
      result = visit;
    }

    if (req.action === 'deleteVisit') {
      db.visits = db.visits.filter(function (x) { return x.id !== req.id; });
    }

    if (req.action === 'saveAgent') {
      var oldAgent = byId(db.agents, (req.agent || {}).id);
      if (oldAgent) Object.assign(oldAgent, req.agent, { id: oldAgent.id });
    }

    if (req.action === 'saveSettings') {
      db.settings = { hidden: (req.settings || {}).hidden || [], regions: (req.settings || {}).regions || [] };
      result = db.settings;
    }

    try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) {}
    return Promise.resolve(JSON.parse(JSON.stringify(result)));
  }

  function handleError(err) {
    if (err.code === 'AUTH') { toast('비밀번호가 바뀌었습니다. 다시 입력하세요.'); logout(); return; }
    toast(err.message || '오류가 발생했습니다.');
  }

  function loadData() {
    return api('list').then(function (data) {
      state.listings = data.listings || [];
      state.agents = data.agents || [];
      state.visits = data.visits || [];
      state.settings = normalizeSettings(data.settings);
      state.loaded = true;
    });
  }

  /* ---------- 입력 도우미 ---------- */

  function field(prefix, obj, key, label, opts) {
    opts = opts || {};
    var value = obj[key] === undefined || obj[key] === null ? '' : obj[key];
    var name = prefix + '.' + key;
    var control;
    if (opts.options) {
      control = '<select name="' + name + '">' + opts.options.map(function (o) {
        return '<option value="' + esc(o) + '"' + (String(value) === o ? ' selected' : '') + '>' + esc(o || '미지정') + '</option>';
      }).join('') + '</select>';
    } else if (opts.area) {
      control = '<textarea name="' + name + '" rows="' + opts.area + '">' + esc(value) + '</textarea>';
    } else {
      var type = opts.number ? 'number' : (opts.type || 'text');
      control = '<input type="' + type + '" name="' + name + '" value="' + esc(value) + '"' +
        (opts.number ? ' inputmode="decimal" step="any" min="0"' : '') +
        (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '>';
    }
    return '<label class="field' + (opts.full ? ' full' : '') + '" data-key="' + name + '"><span>' + label + '</span>' + control + '</label>';
  }

  /** 한 번 눌러 고르고, 다시 누르면 해제되는 버튼 묶음. options: 값 배열 또는 [값, 표시] 배열 */
  function seg(prefix, obj, key, label, options) {
    var value = String(obj[key] || '');
    var name = prefix + '.' + key;
    return '<div class="field segfield"><span>' + label + '</span><div class="seg">' +
      '<input type="hidden" name="' + name + '" value="' + esc(value) + '">' +
      options.map(function (o) {
        var val = Array.isArray(o) ? o[0] : o, text = Array.isArray(o) ? o[1] : o;
        return '<button type="button" data-val="' + esc(val) + '"' + (val === value ? ' class="on"' : '') + '>' + esc(text) + '</button>';
      }).join('') + '</div></div>';
  }

  function bindSegs(rootEl) {
    rootEl.querySelectorAll('.seg').forEach(function (group) {
      var input = group.querySelector('input');
      group.querySelectorAll('button').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var on = btn.classList.contains('on');
          group.querySelectorAll('button').forEach(function (b) { b.classList.remove('on'); });
          if (!on) btn.classList.add('on');
          input.value = on ? '' : btn.dataset.val;
        });
      });
    });
  }

  function readForm(form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.name.indexOf('.') < 0) return;
      var parts = el.name.split('.');
      out[parts[0]] = out[parts[0]] || {};
      out[parts[0]][parts[1]] = el.value.trim();
    });
    return out;
  }

  /* ---------- 화면 공통 조각 ---------- */

  var ICONS = {
    home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    phone: '<path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    note: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/>',
    link: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    backspace: '<path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="M12 9l6 6M18 9l-6 6"/>'
  };

  function icon(name, size) {
    size = size || 24;
    return '<svg class="ic" aria-hidden="true" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }

  function ratingHtml(v) {
    var n = Number(v);
    if (!n) return '';
    return '<span class="rating"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">' +
      '<polygon points="12 3 14.8 8.9 21 9.7 16.5 14 17.6 20.3 12 17.3 6.4 20.3 7.5 14 3 9.7 9.2 8.9"/></svg>' +
      '<b>' + (Math.round(n * 10) / 10).toFixed(1) + '</b></span>';
  }

  /** 임장 기록들에서 '좋음'만 받은 항목 이름 ('나쁨'이 한 번이라도 있으면 제외) */
  function goodItems(visits) {
    var out = [];
    VISIT_GROUPS.forEach(function (g) {
      g.items.forEach(function (it) {
        var good = visits.some(function (v) { return v[it[0]] === '좋음'; });
        var bad = visits.some(function (v) { return v[it[0]] === '나쁨'; });
        if (good && !bad) out.push(it[1].replace(/\s*\(.*\)/, ''));
      });
    });
    return out;
  }

  /** 좋음·나쁨 항목을 작은 라벨로 */
  function levelTags(visits) {
    var html = goodItems(visits).map(function (t) { return '<span class="tag good">' + esc(t) + ' 좋음</span>'; }).join('') +
      badItems(visits).map(function (t) { return '<span class="tag bad">' + esc(t) + ' 나쁨</span>'; }).join('');
    return html ? '<div class="tags">' + html + '</div>' : '';
  }

  function isDropped(l) { return l.status === '보류' || l.status === '탈락'; }

  /** 안쪽 화면의 윗줄: 뒤로 가기 + 제목 + (오른쪽 버튼) */
  function header(title, backHref, right) {
    return '<div class="topbar"><a class="iconbtn" href="' + backHref + '" aria-label="뒤로">' + icon('back') + '</a>' +
      '<h1>' + esc(title) + '</h1>' + (right || '') + '</div>';
  }

  /** 큰 화면(매물·임장·중개사·설정)의 제목 */
  function bigTitle(title, sub) {
    return '<div class="hero"><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>';
  }

  function tabbar(active) {
    var planned = plannedListings().length;
    var tab = function (key, href, name, label, badge) {
      return '<a class="tab' + (active === key ? ' on' : '') + '" href="' + href + '"' + (active === key ? ' aria-current="page"' : '') + '>' +
        icon(name) + label + (badge ? '<span class="count">' + badge + '</span>' : '') + '</a>';
    };
    return '<div class="tabspace"></div><nav class="tabbar" aria-label="메뉴"><div class="tabs">' +
      tab('home', '#', 'home', '매물') +
      tab('plans', '#plans', 'calendar', '임장', planned) +
      '<a class="tabadd" href="#new" aria-label="매물 추가">' + icon('plus', 26) + '</a>' +
      tab('agents', '#agents', 'person', '중개사') +
      tab('settings', '#settings', 'sliders', '설정') +
      '</div></nav>';
  }

  /* ---------- 화면: 비밀번호 ---------- */

  function renderLogin() {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
    app.innerHTML =
      '<div class="login" id="login">' +
      '<div class="logo">' + icon('home', 36) + '</div>' +
      '<h1>우리 집 찾기</h1>' +
      '<p>둘만 아는 숫자 6자리를 눌러 주세요</p>' +
      (DEMO ? '<div class="banner">체험 모드입니다. 서버 주소가 설정되지 않아 이 브라우저에만 저장되고, 비밀번호는 확인하지 않습니다.</div>' : '') +
      '<div class="dots" id="dots" role="status" aria-label="입력한 자리 수 0 / 6">' +
      '<i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="error" id="login-error"></div>' +
      '<div class="keypad">' + keys.map(function (k) {
        if (k === '') return '<span></span>';
        if (k === 'back') return '<button type="button" class="key back" data-key="back" aria-label="지우기">' + icon('backspace', 28) + '</button>';
        return '<button type="button" class="key" data-key="' + k + '">' + k + '</button>';
      }).join('') + '</div>' +
      '<label class="check"><input type="checkbox" id="remember" checked> 이 기기에서 기억하기</label>' +
      '</div>';

    var box = document.getElementById('login');
    var dots = document.getElementById('dots');
    var errorEl = document.getElementById('login-error');
    var pin = '';
    var busy = false;

    function paint() {
      dots.querySelectorAll('i').forEach(function (dot, i) { dot.classList.toggle('on', i < pin.length); });
      dots.setAttribute('aria-label', '입력한 자리 수 ' + pin.length + ' / 6');
    }

    function submit() {
      busy = true;
      box.classList.add('busy');
      var session = { password: pin };
      state.session = session;
      api('login').then(function () {
        saveSession(session, document.getElementById('remember').checked);
        return loadData();
      }).then(function () {
        document.removeEventListener('keydown', onKeyDown);
        render();
      }).catch(function (err) {
        state.session = null;
        busy = false;
        pin = '';
        paint();
        box.classList.remove('busy');
        errorEl.textContent = err.code ? err.message : '서버에 연결하지 못했습니다. 주소와 배포 설정을 확인하세요.';
      });
    }

    function press(key) {
      if (busy) return;
      if (key === 'back') pin = pin.slice(0, -1);
      else if (pin.length < 6) pin += key;
      if (pin.length) errorEl.textContent = '';
      paint();
      if (pin.length === 6) submit();
    }

    // 컴퓨터에서는 키보드 숫자로도 입력
    function onKeyDown(e) {
      if (!document.body.contains(box)) { document.removeEventListener('keydown', onKeyDown); return; }
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
    }

    box.querySelectorAll('[data-key]').forEach(function (btn) {
      btn.addEventListener('click', function () { press(btn.dataset.key); btn.blur(); });
    });
    document.addEventListener('keydown', onKeyDown);
  }

  /* ---------- 화면: 매물 목록 ---------- */

  /** 상단 지역 필터에 맞는 매물. '' 는 지역 미지정 */
  function inRegion() {
    return state.listings.filter(function (l) {
      return state.region === '전체' || regionOf(l) === state.region;
    });
  }

  function sortedListings() {
    var list = inRegion().filter(function (l) {
      return state.filter === '전체' || (l.status || '관심') === state.filter;
    });
    var num = function (v) { return Number(v) || 0; };
    var sorters = {
      recent: function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); },
      cheap: function (a, b) { return (num(a.deposit) || Infinity) - (num(b.deposit) || Infinity); },
      pricey: function (a, b) { return num(b.deposit) - num(a.deposit); },
      wide: function (a, b) { return num(b.exclusiveArea) - num(a.exclusiveArea); },
      rating: function (a, b) { return avgRating(visitsOf(b.id)) - avgRating(visitsOf(a.id)); },
      plan: function (a, b) { return String(a.visitPlan || '9').localeCompare(String(b.visitPlan || '9')); }
    };
    return list.sort(sorters[state.sort]);
  }

  function specText(l) {
    return [
      l.exclusiveArea ? '전용 ' + l.exclusiveArea + '㎡' : '',
      l.floor ? l.floor + (l.totalFloor ? '/' + l.totalFloor : '') + '층' : '',
      l.direction, l.moveIn
    ].filter(Boolean).join(' · ');
  }

  function cardHtml(l) {
    var visits = visitsOf(l.id);
    var status = l.status || '관심';
    var spec = specText(l);
    var visitLine = '';
    if (visits.length) {
      var words = goodItems(visits).slice(0, 2).map(function (t) { return t + ' 좋음'; })
        .concat(badItems(visits).map(function (t) { return t + ' 주의'; }));
      visitLine = '<div class="visitsum">' + ratingHtml(avgRating(visits)) +
        '<span>' + esc(words.join(' · ') || '임장 ' + visits.length + '회') + '</span></div>';
    }
    return '<a class="card item" href="#view/' + esc(l.id) + '">' +
      '<div class="row"><span class="name">' + esc(titleOf(l)) + '</span>' +
      '<span class="badge s-' + esc(status) + '">' + esc(status) + '</span></div>' +
      '<div class="price">' + esc(priceText(l)) + '</div>' +
      (spec ? '<div class="meta">' + esc(spec) + '</div>' : '') +
      visitLine + '</a>';
  }

  function renderList() {
    // 지역 필터: 설정의 지역은 매물이 없어도 항상 보여줍니다.
    var regionCounts = {};
    state.listings.forEach(function (l) { var r = regionOf(l); regionCounts[r] = (regionCounts[r] || 0) + 1; });
    var regionKeys = state.settings.regions.concat(
      Object.keys(regionCounts).filter(function (r) { return r && state.settings.regions.indexOf(r) < 0; }).sort(), ['']
    ).filter(function (r) { return regionCounts[r] || state.settings.regions.indexOf(r) >= 0; });
    if (state.region !== '전체' && regionKeys.indexOf(state.region) < 0) state.region = '전체';
    var regionChips = !regionKeys.length ? '' :
      '<div class="chips" aria-label="지역">' + [['전체', '전체', 0]].concat(regionKeys.map(function (r) {
        return [r, r || '미지정', regionCounts[r] || 0];
      })).map(function (c) {
        return '<button class="chip' + (state.region === c[0] ? ' on' : '') + '" data-region="' + esc(c[0]) + '">' +
          esc(c[1]) + (c[2] ? ' <span>' + c[2] + '</span>' : '') + '</button>';
      }).join('') + '</div>';

    var scoped = inRegion();
    var counts = {};
    scoped.forEach(function (l) { var s = l.status || '관심'; counts[s] = (counts[s] || 0) + 1; });
    var statusOptions = '<option value="전체"' + (state.filter === '전체' ? ' selected' : '') + '>상태 전체</option>' +
      STATUSES.map(function (s) {
        return '<option value="' + s + '"' + (state.filter === s ? ' selected' : '') + '>' + s + ' ' + (counts[s] || 0) + '</option>';
      }).join('');
    var sortOptions = [['recent', '최근 등록순'], ['cheap', '보증금 낮은순'], ['pricey', '보증금 높은순'], ['wide', '면적 넓은순'], ['rating', '별점 높은순'], ['plan', '임장 예정 빠른순']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');

    // 상태를 고르지 않았을 때는 보류·탈락을 아래로 접어 둡니다.
    var list = sortedListings();
    var fold = state.filter === '전체';
    var main = fold ? list.filter(function (l) { return !isDropped(l); }) : list;
    var dropped = fold ? list.filter(isDropped) : [];

    // 같은 지역끼리 묶기: 설정의 지역 순서 → 목록에 없는 지역 → 미지정
    var byRegion = {};
    main.forEach(function (l) { var r = regionOf(l); (byRegion[r] = byRegion[r] || []).push(l); });
    var others = Object.keys(byRegion).filter(function (r) { return r && state.settings.regions.indexOf(r) < 0; }).sort();
    var order = state.settings.regions.concat(others, ['']).filter(function (r) { return byRegion[r]; });
    var showHeads = state.region === '전체' && (order.length > 1 || (order.length === 1 && order[0] !== ''));
    var cards = order.map(function (r) {
      return (showHeads ? '<h2 class="group">' + esc(r || '지역 미지정') + '</h2>' : '') + byRegion[r].map(cardHtml).join('');
    }).join('');

    var droppedHtml = !dropped.length ? '' :
      '<button class="more" id="toggle-dropped" aria-expanded="' + (state.showDropped ? 'true' : 'false') + '">보류·탈락 ' + dropped.length + '곳 ' +
      (state.showDropped ? '접기' : '보기') + '</button>' +
      (state.showDropped ? '<div class="dropped">' + dropped.map(cardHtml).join('') + '</div>' : '');

    var active = state.listings.filter(function (l) { return !isDropped(l); }).length;
    var planned = plannedListings().length;
    var empty = !state.listings.length
      ? '<div class="empty">아직 매물이 없어요.<br>아래 <b>＋</b> 버튼을 눌러 네이버 부동산 내용을 붙여넣어 보세요.</div>'
      : (!cards && !dropped.length ? '<div class="empty">조건에 맞는 매물이 없어요.</div>' : '');

    app.innerHTML =
      bigTitle('우리 집 찾기', state.listings.length ? '보는 중 ' + active + '곳' + (planned ? ' · 임장 예정 ' + planned + '건' : '') : '') +
      (DEMO ? '<div class="banner">체험 모드: 이 브라우저에만 저장됩니다.</div>' : '') +
      regionChips +
      (state.listings.length ? '<div class="toolbar"><select id="status" aria-label="상태">' + statusOptions + '</select>' +
        '<select id="sort" aria-label="정렬">' + sortOptions + '</select></div>' : '') +
      cards + empty + droppedHtml +
      tabbar('home');

    app.querySelectorAll('.chips [data-region]').forEach(function (el) {
      el.addEventListener('click', function () { state.region = el.dataset.region; renderList(); });
    });
    var statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.addEventListener('change', function (e) { state.filter = e.target.value; renderList(); });
      document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderList(); });
    }
    var toggle = document.getElementById('toggle-dropped');
    if (toggle) toggle.addEventListener('click', function () { state.showDropped = !state.showDropped; renderList(); });
  }

  /* ---------- 화면: 임장 ---------- */

  function renderPlans() {
    var planned = plannedListings();
    var goRows = planned.map(function (l) {
      var pi = planInfo(l.visitPlan);
      var ag = agentOf(l);
      var parts = pi.text.split(' ');
      return '<a class="card agendarow" href="#view/' + esc(l.id) + '">' +
        '<span class="when p-' + pi.level + '"><b>' + esc(pi.level === 'none' ? '미정' : parts[0] + (pi.level === 'past' ? ' ' + (parts[1] || '') : '')) + '</b>' +
        (pi.level !== 'none' && pi.level !== 'past' && parts[1] ? '<small>' + esc(parts[1]) + '</small>' : '') + '</span>' +
        '<span class="what"><b>' + esc(titleOf(l)) + '</b>' +
        '<small>' + esc([regionOf(l), priceText(l)].filter(Boolean).join(' · ')) + '</small>' +
        '<small>' + esc([pi.when || '일시를 정해 주세요', ag && ag.name].filter(Boolean).join(' · ')) + '</small></span></a>';
    }).join('');

    var visited = state.listings.map(function (l) { return { l: l, visits: visitsOf(l.id) }; })
      .filter(function (x) { return x.visits.length; })
      .sort(function (a, b) { return String(b.visits[0].visitedAt).localeCompare(String(a.visits[0].visitedAt)); });
    var doneRows = visited.map(function (x) {
      var last = planInfo(x.visits[0].visitedAt);
      return '<a class="card item" href="#view/' + esc(x.l.id) + '">' +
        '<div class="row"><span class="name">' + esc(titleOf(x.l)) + '</span>' + ratingHtml(avgRating(x.visits)) + '</div>' +
        levelTags(x.visits) +
        '<div class="meta small">' + esc([last.when, priceText(x.l), x.l.status].filter(Boolean).join(' · ')) + '</div></a>';
    }).join('');

    app.innerHTML =
      bigTitle('임장') +
      (goRows ? '<h2 class="group">갈 곳 ' + planned.length + '</h2>' + goRows : '') +
      (doneRows ? '<h2 class="group">다녀온 곳 ' + visited.length + '</h2>' + doneRows : '') +
      (!goRows && !doneRows ? '<div class="empty">아직 임장 일정이 없어요.<br>매물의 상태를 <b>임장예정</b>으로 바꾸면 여기에 모여요.</div>' : '') +
      tabbar('plans');
  }

  /* ---------- 화면: 매물 보기 ---------- */

  function renderView(id) {
    var l = byId(state.listings, id);
    if (!l) { location.hash = ''; return; }
    var agent = agentOf(l);
    var visits = visitsOf(id);
    var status = l.status || '관심';
    var region = regionOf(l);
    var phone = agent ? String(agent.phone || '').split(',')[0].replace(/[^\d+]/g, '') : '';

    var facts = [
      ['전용면적', l.exclusiveArea && l.exclusiveArea + '㎡'],
      ['층', l.floor && l.floor + (l.totalFloor ? ' / ' + l.totalFloor : '') + '층'],
      ['방향', l.direction],
      ['방 · 욕실', l.rooms && l.rooms + (l.baths ? ' · ' + l.baths : '')],
      ['입주', l.moveIn],
      ['관리비', l.maintenanceFee]
    ].filter(function (f) { return f[1]; }).map(function (f) {
      return '<div><span>' + f[0] + '</span><b>' + esc(f[1]) + '</b></div>';
    }).join('');

    var actions = [
      phone ? '<a class="act primary" href="tel:' + esc(phone) + '">' + icon('phone', 18) + '중개사 전화</a>' : '',
      '<a class="act" href="#visit/' + esc(id) + '/new">' + icon('note', 18) + '임장 기록</a>',
      l.naverNo ? '<a class="act" href="https://m.land.naver.com/article/info/' + encodeURIComponent(l.naverNo) + '" target="_blank" rel="noopener">' + icon('link', 18) + '네이버</a>' : ''
    ].filter(Boolean);

    var planCard = '';
    if (status === '임장예정') {
      var pi = planInfo(l.visitPlan);
      planCard = '<div class="card"><h2>임장 일시' + (pi.level !== 'none' ? ' <span class="plantext p-' + pi.level + '">' + esc(pi.text) + '</span>' : '') + '</h2>' +
        '<input type="datetime-local" id="plan" aria-label="임장 일시" value="' + esc(l.visitPlan || '') + '">' +
        (pi.level === 'none' ? '<p class="hint">언제 가는지 적어 두면 임장 탭에 날짜순으로 모여요.</p>' : '') + '</div>';
    }

    var visitCards = visits.map(function (v) {
      var when = planInfo(v.visitedAt).when;
      var notes = [v.pros && '장점: ' + v.pros, v.cons && '단점: ' + v.cons, v.memo].filter(Boolean);
      return '<a class="visitrow" href="#visit/' + esc(id) + '/' + esc(v.id) + '">' +
        '<div class="row"><span class="name">' + esc(when || '날짜 없음') + '</span>' + ratingHtml(v.rating) + '</div>' +
        levelTags([v]) +
        notes.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('') + '</a>';
    }).join('');

    var allRows = LISTING_GROUPS.filter(function (g) { return g.prefix === 'l'; }).map(function (g) {
      return g.fields.filter(function (f) { return l[f[0]] && ['name', 'dongHo', 'status', 'memo', 'region'].indexOf(f[0]) < 0; })
        .map(function (f) {
          var label = f[1].replace(/\s*\(.*\)/, '');
          var value = f[0] === 'deposit' ? formatMoney(l.deposit) : f[0] === 'visitPlan' ? planInfo(l.visitPlan).when : l[f[0]];
          return '<div class="inforow"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
        }).join('');
    }).join('');

    app.innerHTML =
      header('', '#', '<a class="textbtn" href="#edit/' + esc(id) + '">' + icon('pencil', 18) + '수정</a>') +
      '<div class="viewhead">' +
      ([region, l.address].filter(Boolean).length ? '<div class="meta">' + esc([region, l.address].filter(Boolean).join(' · ')) + '</div>' : '') +
      '<h1>' + esc(titleOf(l)) + '</h1>' +
      '<div class="bigprice">' + esc(priceText(l)) + '</div></div>' +
      '<div class="chips" id="status-chips" aria-label="상태">' + STATUSES.map(function (s) {
        return '<button type="button" class="chip' + (status === s ? ' on' : '') + '" data-status="' + s + '"' + (status === s ? ' aria-pressed="true"' : '') + '>' + s + '</button>';
      }).join('') + '</div>' +
      planCard +
      (facts || l.features ? '<div class="card">' + (facts ? '<div class="facts">' + facts + '</div>' : '') +
        (l.features ? '<p class="features">' + esc(l.features) + '</p>' : '') + '</div>' : '') +
      '<div class="acts n' + actions.length + '">' + actions.join('') + '</div>' +
      '<div class="card"><h2>임장 기록' + (visits.length ? ' ' + visits.length + '회' : '') + '</h2>' +
      (visitCards || '<p class="hint" style="margin:0">아직 다녀오지 않았어요. 다녀온 뒤 [임장 기록]을 눌러 남겨 보세요.</p>') + '</div>' +
      (l.memo ? '<div class="card"><h2>우리끼리 메모</h2><p class="memo">' + esc(l.memo) + '</p></div>' : '') +
      (agent ? '<div class="card"><h2>중개사</h2><div class="agentname">' + esc(agent.name || '이름 없는 중개사') + '</div>' +
        '<div class="meta">' + [agent.contact && esc('담당 ' + agent.contact), telLinks(agent.phone)].filter(Boolean).join(' · ') + '</div>' +
        (agent.memo ? '<p class="memo">' + esc(agent.memo) + '</p>' : '') +
        '<a class="hint" href="#agent/' + esc(agent.id) + '">중개사 메모 쓰기 →</a></div>' : '') +
      (allRows || l.rawText ? '<details class="card"><summary>전체 정보 보기</summary>' + allRows +
        (l.rawText ? '<details class="rawbox"><summary>붙여넣은 원문</summary><pre class="raw">' + esc(l.rawText) + '</pre></details>' : '') + '</details>' : '') +
      '<p class="hint center">' + esc([l.createdAt && '등록 ' + l.createdAt, l.updatedAt && '수정 ' + l.updatedAt].filter(Boolean).join(' · ')) + '</p>';

    document.getElementById('status-chips').querySelectorAll('[data-status]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var next = chip.dataset.status;
        if (next === status) return;
        api('setStatus', { id: id, status: next }).then(function () {
          l.status = next;
          renderView(id);
          toast('상태: ' + next);
          var planEl = document.getElementById('plan');
          if (planEl && !planEl.value) planEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }).catch(handleError);
      });
    });

    var planInput = document.getElementById('plan');
    if (planInput) {
      planInput.addEventListener('change', function () {
        // 중개사를 함께 보내야 매물과의 연결이 끊기지 않습니다.
        api('saveListing', { listing: { id: id, visitPlan: planInput.value }, agent: agent ? Object.assign({}, agent) : {} })
          .then(loadData).then(function () { renderView(id); toast('임장 일시를 저장했어요.'); }).catch(handleError);
      });
    }
  }

  /* ---------- 화면: 매물 추가·수정 ---------- */

  /** 설정에서 켜 둔 항목만으로 매물 입력 폼을 만듭니다. 항목이 하나도 없는 묶음은 생략. */
  function listingFormHtml(l, a, isNew) {
    return LISTING_GROUPS.map(function (g, gi) {
      var obj = g.prefix === 'a' ? a : l;
      var html = g.fields.filter(function (f) {
        var o = f[2] || {};
        if (o.existingOnly && isNew) return false;
        if (o.newOnly && !isNew) return false;
        return o.locked || isShown(g.prefix + '.' + f[0]);
      }).map(function (f) {
        var o = f[2];
        if (o && o.region) {
          // 설정에서 지운 지역이 이미 들어 있는 매물은 그 값을 잃지 않도록 선택지에 남김
          var opts = [''].concat(state.settings.regions);
          if (obj.region && opts.indexOf(obj.region) < 0) opts.push(obj.region);
          o = Object.assign({}, o, { options: opts });
        }
        return field(g.prefix, obj, f[0], f[1], o);
      }).join('');
      if (!html) return '';
      // 기본 정보와 메모만 펼쳐 두고, 나머지는 눌러서 펼칩니다.
      if (gi === 0 || g.title === '메모') return '<div class="card"><h2>' + g.title + '</h2><div class="grid">' + html + '</div></div>';
      return '<details class="card fold"><summary>' + g.title + '</summary><div class="grid">' + html + '</div></details>';
    }).join('');
  }

  function renderListingForm(id) {
    var existing = id ? byId(state.listings, id) : null;
    if (id && !existing) { location.hash = ''; return; }
    var listing = existing ? Object.assign({}, existing) : { status: '관심', tradeType: '전세' };
    var agent = existing ? Object.assign({}, agentOf(existing) || {}) : {};
    if (!listing.region) listing.region = detectRegion(listing);
    var rawText = listing.rawText || '';
    var stash = { l: {}, a: {} };
    var visitCount = existing ? visitsOf(existing.id).length : 0;
    var back = existing ? '#view/' + encodeURIComponent(existing.id) : '#';

    app.innerHTML =
      header(existing ? '매물 수정' : '매물 추가', back) +
      (existing ? '' :
        '<div class="card"><h2>네이버 부동산 내용</h2>' +
        '<textarea id="paste" rows="4" placeholder="매물 상세 화면의 글자를 전체 선택해 복사한 뒤 여기에 붙여넣으세요."></textarea>' +
        '<p class="hint" id="parse-result">붙여넣으면 아래 칸이 알아서 채워져요.</p>' +
        '<button class="btn block" type="button" id="parse" style="margin-top:12px">다시 인식하기</button></div>') +
      '<form id="form">' + listingFormHtml(listing, agent, !existing) +
      (existing ? '<button class="btn danger block" type="button" id="delete">이 매물 삭제</button>' : '') +
      '<div class="savebar"><button class="btn primary block" type="submit">저장</button></div>' +
      '</form>';

    var form = document.getElementById('form');

    function applyParsed() {
      var text = document.getElementById('paste').value;
      if (!text.trim()) { toast('붙여넣은 내용이 없어요.'); return; }
      var parsed = window.parseNaver(text);
      rawText = parsed.listing.rawText || '';
      var filled = 0;
      stash = { l: {}, a: {} };
      form.querySelectorAll('.field').forEach(function (el) { el.classList.remove('filled', 'missing'); });
      [['l', parsed.listing], ['a', parsed.agent]].forEach(function (pair) {
        Object.keys(pair[1]).forEach(function (key) {
          var input = form.elements[pair[0] + '.' + key];
          if (!pair[1][key] || key === 'rawText') return;
          // 화면에서 숨긴 항목도 인식된 값은 버리지 않고 함께 저장
          if (!input) { stash[pair[0]][key] = pair[1][key]; return; }
          input.value = pair[1][key];
          input.closest('.field').classList.add('filled');
          filled++;
        });
      });
      var guessed = detectRegion(parsed.listing);
      if (guessed) {
        form.elements['l.region'].value = guessed;
        form.elements['l.region'].closest('.field').classList.add('filled');
      }
      ['l.name', 'l.deposit'].forEach(function (name) {
        if (!form.elements[name].value) form.elements[name].closest('.field').classList.add('missing');
      });
      var result = document.getElementById('parse-result');
      result.classList.toggle('ok', !!filled);
      result.textContent = filled
        ? filled + '개 항목을 채웠어요. 기본 정보만 확인하고, 노란 칸은 직접 적어 주세요.'
        : '인식한 항목이 없어요. 복사 범위를 넓혀 다시 붙여넣거나 직접 적어 주세요.';
    }

    if (!existing) {
      document.getElementById('parse').addEventListener('click', applyParsed);
      document.getElementById('paste').addEventListener('paste', function () { setTimeout(applyParsed, 0); });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var read = readForm(form);
      // 숨긴 항목: 새 매물은 인식된 값(stash), 기존 매물의 중개사는 원래 값을 유지
      var keepAgent = {};
      ['id', 'name', 'rep', 'regNo', 'phone', 'address'].forEach(function (k) { if (agent[k]) keepAgent[k] = agent[k]; });
      var data = {
        l: Object.assign({}, stash.l, read.l || {}),
        a: Object.assign(keepAgent, stash.a, read.a || {})
      };
      if (!data.l.name && !data.l.deposit) { toast('단지·건물명이나 보증금 중 하나는 입력하세요.'); return; }
      data.l.rawText = rawText;
      if (existing) data.l.id = existing.id;
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      api('saveListing', { listing: data.l, agent: data.a }).then(function (res) {
        var lost = data.l.region && res && res.listing && res.listing.region !== data.l.region;
        var savedId = res && res.listing && res.listing.id;
        return loadData().then(function () { return { lost: lost, id: savedId }; });
      }).then(function (r) {
        toast(r.lost ? '저장했지만 지역은 서버에 남지 않았습니다. Code.gs를 새 버전으로 바꿔 주세요.' : '저장했어요.');
        location.hash = r.id ? 'view/' + encodeURIComponent(r.id) : '';
      }).catch(function (err) { btn.disabled = false; handleError(err); });
    });

    if (existing) {
      document.getElementById('delete').addEventListener('click', function () {
        var extra = visitCount ? ' 임장 기록 ' + visitCount + '건도 함께 삭제됩니다.' : '';
        if (!confirm('이 매물을 삭제할까요?' + extra + ' 되돌릴 수 없습니다.')) return;
        api('deleteListing', { id: existing.id }).then(loadData).then(function () {
          toast('삭제했어요.');
          location.hash = '';
        }).catch(handleError);
      });
    }
  }

  /* ---------- 화면: 임장 기록 ---------- */

  function renderVisitForm(listingId, visitId) {
    var listing = byId(state.listings, listingId);
    if (!listing) { location.hash = ''; return; }
    var existing = visitId && visitId !== 'new' ? byId(state.visits, visitId) : null;
    var v = existing ? Object.assign({}, existing) : { visitedAt: nowLocal() };
    var back = '#view/' + encodeURIComponent(listingId);

    var groups = VISIT_GROUPS.map(function (g) {
      var items = g.items.filter(function (it) { return isShown('v.' + it[0]); });
      if (!items.length) return '';
      return '<div class="card"><h2>' + g.title + '</h2>' +
        items.map(function (it) { return seg('v', v, it[0], it[1], LEVELS); }).join('') + '</div>';
    }).join('');

    var extraHtml = {
      expanded: seg('v', v, 'expanded', '확장 여부', ['확장', '비확장', '모름']),
      occupant: seg('v', v, 'occupant', '현 거주자', ['집주인', '세입자', '공실']),
      options: field('v', v, 'options', '옵션', { placeholder: '예: 시스템에어컨 2대, 붙박이장, 식기세척기' }),
      boiler: field('v', v, 'boiler', '보일러', { placeholder: '예: 2021년 교체' }),
      pros: field('v', v, 'pros', '장점', { area: 2 }),
      cons: field('v', v, 'cons', '단점', { area: 2 }),
      memo: field('v', v, 'memo', '메모 (집주인·중개사가 한 말, 확인할 것 등)', { area: 3 })
    };
    var extras = VISIT_EXTRA.map(function (g) {
      var html = g.items.filter(function (it) { return isShown('v.' + it[0]); })
        .map(function (it) { return extraHtml[it[0]]; }).join('');
      return html ? '<div class="card"><h2>' + g.title + '</h2>' + html + '</div>' : '';
    }).join('');

    app.innerHTML =
      header('임장 기록', back) +
      '<p class="hint" style="margin:0 0 12px">' + esc(titleOf(listing) + ' · ' + priceText(listing)) + '</p>' +
      '<form id="visit">' +
      '<div class="card">' + field('v', v, 'visitedAt', '방문 일시', { type: 'datetime-local' }) +
      seg('v', v, 'rating', '총점', STARS) + '</div>' +
      groups + extras +
      (existing ? '<p class="hint" style="margin:0 0 12px">' + esc([existing.author && '작성 ' + existing.author, existing.updatedAt && '수정 ' + existing.updatedAt].filter(Boolean).join(' · ')) + '</p>' : '') +
      (existing ? '<button class="btn danger block" type="button" id="delete">이 기록 삭제</button>' : '') +
      '<div class="savebar"><button class="btn primary block" type="submit">저장</button></div>' +
      '</form>';

    var form = document.getElementById('visit');
    bindSegs(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var visit = readForm(form).v;
      visit.listingId = listingId;
      if (existing) visit.id = existing.id;
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      api('saveVisit', { visit: visit }).then(loadData).then(function () {
        toast('임장 기록을 저장했습니다.');
        location.hash = back;
      }).catch(function (err) { btn.disabled = false; handleError(err); });
    });

    if (existing) {
      document.getElementById('delete').addEventListener('click', function () {
        if (!confirm('이 임장 기록을 삭제할까요? 되돌릴 수 없습니다.')) return;
        api('deleteVisit', { id: existing.id }).then(loadData).then(function () {
          toast('삭제했습니다.');
          location.hash = back;
        }).catch(handleError);
      });
    }
  }

  /* ---------- 화면: 중개사 ---------- */

  function listingsOfAgent(agentId) {
    return state.listings.filter(function (l) { return l.agentId === agentId; });
  }

  function telLinks(phone) {
    return String(phone || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) {
      return '<a href="tel:' + esc(p.replace(/[^\d+]/g, '')) + '">' + esc(p) + '</a>';
    }).join(', ');
  }

  function renderAgents() {
    var cards = state.agents.slice().sort(function (a, b) {
      return listingsOfAgent(b.id).length - listingsOfAgent(a.id).length;
    }).map(function (a) {
      var mine = listingsOfAgent(a.id);
      return '<a class="card item" href="#agent/' + esc(a.id) + '">' +
        '<div class="row"><span class="name">' + esc(a.name || '이름 없는 중개사') + '</span><span class="badge">매물 ' + mine.length + '</span></div>' +
        '<div class="meta">' + esc([a.rep && '대표 ' + a.rep, a.contact && '담당 ' + a.contact, a.phone].filter(Boolean).join(' · ')) + '</div>' +
        (a.memo ? '<div class="meta">' + esc(a.memo) + '</div>' : '') +
        '</a>';
    }).join('');

    app.innerHTML =
      bigTitle('중개사') +
      (cards || '<div class="empty">아직 중개사가 없어요.<br>매물을 저장하면 중개사가 알아서 여기에 모여요.</div>') +
      tabbar('agents');
  }

  function renderAgentForm(id) {
    var agent = byId(state.agents, id);
    if (!agent) { location.hash = 'agents'; return; }
    var a = Object.assign({}, agent);
    var G = function (key, label, opts) { return field('g', a, key, label, opts); };
    var mine = listingsOfAgent(id);

    app.innerHTML =
      header(a.name || '중개사', '#agents') +
      (a.phone ? '<div class="card"><h2>전화 걸기</h2><div class="tels">' + telLinks(a.phone) + '</div></div>' : '') +
      '<form id="agent">' +
      '<div class="card"><h2>메모</h2>' +
      G('memo', '중개사에 대한 메모', { area: 4 }) +
      '</div>' +
      '<div class="card"><h2>기본 정보</h2>' +
      G('name', '상호') +
      '<div class="grid">' + G('rep', '대표자') + G('regNo', '등록번호') + '</div>' +
      G('contact', '담당자 (실제로 응대한 사람)') +
      G('phone', '전화') + G('address', '소재지') +
      '</div>' +
      '<div class="savebar"><button class="btn primary block" type="submit">저장</button></div>' +
      '</form>' +
      '<div class="card" style="margin-top:12px"><h2>이 중개사의 매물 ' + mine.length + '건</h2>' +
      (mine.map(function (l) {
        return '<a class="visitrow" href="#view/' + esc(l.id) + '"><div class="row"><span class="name">' + esc(titleOf(l)) + '</span>' +
          '<span class="badge s-' + esc(l.status || '관심') + '">' + esc(l.status || '관심') + '</span></div>' +
          '<div class="meta">' + esc(priceText(l)) + '</div></a>';
      }).join('') || '<p class="hint" style="margin:0">연결된 매물이 없습니다.</p>') +
      '</div>';

    var form = document.getElementById('agent');
    bindSegs(form);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = readForm(form).g;
      data.id = id;
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      api('saveAgent', { agent: data }).then(loadData).then(function () {
        toast('저장했습니다.');
        location.hash = 'agents';
      }).catch(function (err) { btn.disabled = false; handleError(err); });
    });
  }

  /* ---------- 화면: 설정 ---------- */

  function renderSettings() {
    app.innerHTML =
      bigTitle('설정') +
      '<div class="card"><h2>입력 항목</h2>' +
      '<p class="hint" style="margin:0 0 12px">매물과 임장 기록에서 쓸 항목만 골라 화면을 줄일 수 있습니다. 지금 ' + state.settings.hidden.length + '개를 숨기고 있습니다.</p>' +
      '<a class="btn" href="#fields" style="text-decoration:none">입력 항목 선택</a></div>' +
      '<form class="card" id="regions"><h2>지역</h2>' +
      '<p class="hint" style="margin:0 0 12px">목록에서 매물을 이 순서대로 지역별로 묶어 보여줍니다. 지역명을 누르면 지워집니다. 주소에 지역명이 있으면 자동으로 골라집니다.</p>' +
      '<div class="chips wrap" id="region-chips">' +
      (state.settings.regions.map(function (r) {
        return '<button type="button" class="chip" data-region="' + esc(r) + '" aria-label="' + esc(r) + ' 지우기">' + esc(r) + ' ✕</button>';
      }).join('') || '<span class="hint">지역이 없습니다.</span>') + '</div>' +
      '<div class="addrow"><input type="text" name="region" maxlength="20" placeholder="추가할 지역명" aria-label="추가할 지역명">' +
      '<button class="btn primary" type="submit">추가</button></div></form>' +
      '<div class="card"><h2>이 기기</h2>' +
      '<button class="btn" id="logout">잠그기 (비밀번호 다시 입력)</button></div>' +
      '<form class="card" id="pw"><h2>비밀번호 변경</h2>' +
      (DEMO ? '<p class="hint" style="margin:0 0 12px">체험 모드에서는 바꿀 수 없습니다.</p>' : '') +
      '<label class="field"><span>새 비밀번호 (숫자 6자리)</span><input type="password" name="p1" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="new-password"></label>' +
      '<label class="field"><span>새 비밀번호 확인</span><input type="password" name="p2" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="new-password"></label>' +
      '<p class="hint" style="margin:0 0 12px">바꾸면 함께 쓰는 사람도 새 비밀번호로 다시 들어와야 합니다.</p>' +
      '<button class="btn primary" type="submit"' + (DEMO ? ' disabled' : '') + '>변경</button></form>' +
      tabbar('settings');

    document.getElementById('logout').addEventListener('click', logout);

    function saveRegions(regions, msg) {
      api('saveSettings', { settings: { hidden: state.settings.hidden, regions: regions } }).then(function (saved) {
        var kept = saved && Array.isArray(saved.regions);
        state.settings.regions = kept ? saved.regions : regions;
        toast(kept ? msg : '지역 목록이 서버에 남지 않았습니다. Code.gs를 새 버전으로 바꿔 주세요.');
        renderSettings();
      }).catch(handleError);
    }
    var regionForm = document.getElementById('regions');
    regionForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = regionForm.region.value.trim();
      if (!name) return;
      if (state.settings.regions.indexOf(name) >= 0) { toast('이미 있는 지역입니다.'); return; }
      saveRegions(state.settings.regions.concat([name]), name + ' 지역을 추가했습니다.');
    });
    regionForm.querySelectorAll('[data-region]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var name = chip.dataset.region;
        var used = state.listings.filter(function (l) { return l.region === name; }).length;
        if (!confirm(name + ' 지역을 목록에서 지울까요?' + (used ? ' 이 지역으로 저장된 매물 ' + used + '건은 그대로 남습니다.' : ''))) return;
        saveRegions(state.settings.regions.filter(function (r) { return r !== name; }), name + ' 지역을 지웠습니다.');
      });
    });
    var form = document.getElementById('pw');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!/^\d{6}$/.test(form.p1.value)) { toast('비밀번호는 숫자 6자리여야 합니다.'); return; }
      if (form.p1.value !== form.p2.value) { toast('두 비밀번호가 다릅니다.'); return; }
      var next = form.p1.value;
      api('changePassword', { newPassword: next }).then(function () {
        var remembered = false;
        try { remembered = !!localStorage.getItem(SESSION_KEY); } catch (err) {}
        state.session.password = next;
        saveSession(state.session, remembered);
        form.reset();
        toast('비밀번호를 바꿨습니다.');
      }).catch(handleError);
    });
  }

  /* ---------- 화면: 입력 항목 선택 ---------- */

  function renderFields() {
    var checkGroup = function (title, prefix, items) {
      if (!items.length) return '';
      return '<h3>' + title + '</h3><div class="checks">' + items.map(function (it) {
        var key = prefix + '.' + it[0];
        return '<label class="check"><input type="checkbox" name="' + key + '"' + (isShown(key) ? ' checked' : '') + '> ' +
          esc(it[1].replace(/\s*\(.*\)/, '')) + '</label>';
      }).join('') + '</div>';
    };

    var listingHtml = LISTING_GROUPS.map(function (g) {
      return checkGroup(g.title, g.prefix, g.fields.filter(function (f) { return !(f[2] || {}).locked; }));
    }).join('');
    var visitHtml = VISIT_GROUPS.concat(VISIT_EXTRA).map(function (g) { return checkGroup(g.title, 'v', g.items); }).join('');

    app.innerHTML =
      header('입력 항목 선택', '#settings') +
      '<form id="fields">' +
      '<div class="card"><p class="hint" style="margin:0 0 12px">체크한 항목만 입력 화면에 나옵니다. 함께 쓰는 사람에게도 똑같이 적용됩니다.</p>' +
      '<div class="actions"><button class="btn" type="button" id="only-essential">핵심만 남기기</button>' +
      '<button class="btn" type="button" id="all-on">모두 켜기</button></div></div>' +
      '<div class="card"><h2>매물 정보</h2>' +
      '<p class="hint" style="margin:0">단지·건물명, 동/호, 지역, 보증금, 상태는 항상 나옵니다. 숨긴 항목도 네이버 내용을 붙여넣으면 인식된 값은 시트에 저장됩니다.</p>' +
      listingHtml + '</div>' +
      '<div class="card"><h2>임장 기록</h2>' +
      '<p class="hint" style="margin:0">방문 일시와 총점은 항상 나옵니다.</p>' +
      visitHtml + '</div>' +
      '<div class="savebar"><button class="btn primary block" type="submit">저장</button></div>' +
      '</form>';

    var form = document.getElementById('fields');
    var boxes = form.querySelectorAll('input[type=checkbox]');
    document.getElementById('all-on').addEventListener('click', function () {
      boxes.forEach(function (b) { b.checked = true; });
    });
    document.getElementById('only-essential').addEventListener('click', function () {
      boxes.forEach(function (b) { b.checked = ESSENTIAL.indexOf(b.name) >= 0; });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var hidden = [];
      boxes.forEach(function (b) { if (!b.checked) hidden.push(b.name); });
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      api('saveSettings', { settings: { hidden: hidden, regions: state.settings.regions } }).then(function (saved) {
        state.settings.hidden = (saved && saved.hidden) || hidden;
        toast('입력 항목을 저장했습니다.');
        location.hash = 'settings';
      }).catch(function (err) { btn.disabled = false; handleError(err); });
    });
  }

  /* ---------- 라우팅 ---------- */

  function render() {
    if (!state.session) { renderLogin(); return; }
    if (!state.loaded) {
      app.innerHTML = '<div class="empty">불러오는 중…</div>';
      loadData().then(render).catch(function (err) {
        if (err.code === 'AUTH' || err.code === 'LOCKED') { state.session = null; renderLogin(); document.getElementById('login-error').textContent = err.message; }
        else app.innerHTML = '<div class="empty">불러오지 못했습니다.<br><button class="btn" onclick="location.reload()">다시 시도</button></div>';
      });
      return;
    }
    var parts = location.hash.replace(/^#/, '').split('/').map(decodeURIComponent);
    window.scrollTo(0, 0);
    if (parts[0] === 'new') renderListingForm(null);
    else if (parts[0] === 'view') renderView(parts[1]);
    else if (parts[0] === 'edit') renderListingForm(parts[1]);
    else if (parts[0] === 'visit') renderVisitForm(parts[1], parts[2]);
    else if (parts[0] === 'plans') renderPlans();
    else if (parts[0] === 'agents') renderAgents();
    else if (parts[0] === 'agent') renderAgentForm(parts[1]);
    else if (parts[0] === 'settings') renderSettings();
    else if (parts[0] === 'fields') renderFields();
    else renderList();
  }

  window.addEventListener('hashchange', render);
  render();
})();
