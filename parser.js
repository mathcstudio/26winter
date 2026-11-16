/**
 * 네이버 부동산 매물 상세 화면에서 복사한 텍스트를 항목별로 나눕니다.
 * parseNaver(text) → { listing: {...}, agent: {...} }
 *
 * 화면은 "기본 정보 / 실거래가 / 단지 정보 / 중개사 …" 구역으로 나뉘고,
 * 구역 안에서는 라벨 한 줄 다음 줄에 값이 옵니다. 같은 라벨(관리비·위치·전화)이
 * 여러 구역에 나오므로 구역을 먼저 나눈 뒤 구역별로 값을 찾습니다.
 * 인식하지 못한 항목은 비워 두고, 원문은 listing.rawText 에 그대로 담습니다.
 */
(function (root) {
  'use strict';

  var SECTIONS = ['기본 정보', '매물 소개', '전월세대출 정보', '매매/전세 흐름', '실거래가', '단지 정보',
    '주변 분양', '중개사', '중개 보수', '전월세대출', '전세보증금 반환보증', '관리비', '배정 초등학교', '주변 대중교통'];
  var NOISE = /^(도움말 보기|도움말|자세히|상세보기|상세내용 (숨기기|보기)|전\/월세 계산기|면적 단위 변경.*)$/;
  var AGENT_NAME = /공인중개사|부동산|중개법인|중개사무소/;
  var AGENT_SKIP = /프로필|상세보기|^중개소$|^중개사( 매물| 상담)?$/;
  var PHONE = /0\d{1,2}-\d{3,4}-\d{4}|1\d{3}-\d{4}/g;
  var TRADE = '(전세|월세|매매|단기임대)';

  // 값 자리에 다른 라벨이 온 경우(값이 비어 있는 항목)를 걸러내기 위한 목록
  var KNOWN_LABELS = ['전세가', '보증금', '융자금', '관리비', '월관리비', '공급면적', '전용면적', '공급/전용면적',
    '계약/전용면적', '해당층/총층', '방수/욕실수', '향', '방향', '복층여부', '입주가능일', '매물번호', '매물특징',
    '매물설명', '위치', '소재지', '건축물용도', '건축물 용도', '사용승인일', '세대수', '총세대수', '해당면적 세대수',
    '현관구조', '난방', '난방(방식/연료)', '주차', '총주차대수', '주차가능여부', '용적률/건폐율', '건설사',
    '전화', '등록번호', '거리', '3년 내 최고', '3년 내 최저', '기보증금/월세'];

  function nextText(lines, i) {
    for (var j = i + 1; j < lines.length; j++) {
      var t = lines[j].trim();
      if (t && !NOISE.test(t)) return t;
    }
    return '';
  }

  function splitSections(lines) {
    var sections = [{ name: '', lines: [] }];
    var cur = sections[0];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      var header = '', rest = '';
      if (SECTIONS.indexOf(t) >= 0) header = t;
      else {
        // 예전 화면: "중개사<탭>OO공인중개사사무소"
        var m = t.match(/^중개사[\t :：]+(.+)$/);
        if (m && AGENT_NAME.test(m[1]) && !AGENT_SKIP.test(t)) { header = '중개사'; rest = m[1]; }
      }
      // "관리비"는 기본 정보 안의 라벨이기도 해서, 뒤에 "상세내용 …"이 올 때만 구역으로 봄
      if (header === '관리비') {
        var j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j >= lines.length || lines[j].trim().indexOf('상세내용') !== 0) header = '';
      }
      if (header && header !== cur.name) {
        cur = { name: header, lines: [] };
        sections.push(cur);
        if (rest) cur.lines.push(rest);
      } else {
        cur.lines.push(lines[i]);
      }
    }
    return sections;
  }

  /** 지정한 구역들에서 라벨의 값을 찾습니다. 같은 줄(탭·공백 뒤) 또는 다음 줄. */
  function lookup(sections, secNames, labels) {
    for (var s = 0; s < secNames.length; s++) {
      for (var k = 0; k < sections.length; k++) {
        if (sections[k].name !== secNames[s]) continue;
        var lines = sections[k].lines;
        for (var i = 0; i < lines.length; i++) {
          var t = lines[i].trim();
          for (var l = 0; l < labels.length; l++) {
            var label = labels[l];
            if (t === label) {
              var v = nextText(lines, i);
              if (v && KNOWN_LABELS.indexOf(v) < 0) return v;
            } else if (t.indexOf(label) === 0) {
              var rest = t.slice(label.length);
              if (/^[\t :：]/.test(rest) || label.length >= 4) return rest.replace(/^[\s:：]+/, '').trim();
            }
          }
        }
      }
    }
    return '';
  }

  function sectionLines(sections, name) {
    for (var k = 0; k < sections.length; k++) if (sections[k].name === name) return sections[k].lines;
    return [];
  }

  function startsWithLabel(t) {
    for (var i = 0; i < KNOWN_LABELS.length; i++) {
      var label = KNOWN_LABELS[i];
      if (t === label || (t.indexOf(label) === 0 && /^[\t :：]/.test(t.slice(label.length)))) return true;
    }
    return false;
  }

  /** "3억 5,000" / "5억원" → 만원 단위 숫자 문자열 */
  function parseMoney(s) {
    s = String(s || '').replace(/\s/g, '');
    var total = 0;
    var eok = s.match(/(\d+)억/);
    if (eok) { total += Number(eok[1]) * 10000; s = s.slice(s.indexOf('억') + 1); }
    var cheon = s.match(/^(\d)천/);
    if (cheon) total += Number(cheon[1]) * 1000;
    else {
      var num = s.match(/^[\d,]+/);
      if (num) total += Number(num[0].replace(/,/g, '')) || 0;
    }
    return total ? String(total) : '';
  }

  function firstNumber(s) {
    var m = String(s || '').match(/\d+(?:\.\d+)?/);
    return m ? m[0] : '';
  }

  function noParens(s) {
    return String(s || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  }

  function parseNaver(text) {
    var raw = String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
    var sections = splitSections(raw.split('\n'));
    var head = sections[0].lines;
    var listing = { rawText: raw.trim() };
    var agent = {};
    var INFO = ['기본 정보', '단지 정보', ''];
    var get = function (labels, secs) { return lookup(sections, secs || INFO, labels); };
    var i, j, t;

    /* ---- 1) 맨 위: 단지명·동, 가격, 한 줄 요약 ---- */
    for (i = 0; i < head.length; i++) {
      t = head[i].trim();
      if (/매매\s*\d+\s*전세/.test(t)) continue;                       // 중개사 보유 매물 수 줄
      if (new RegExp('^' + TRADE + '$').test(t)) {                     // 거래유형과 금액이 줄바꿈으로 나뉜 경우
        for (j = i + 1; j < head.length && !head[j].trim(); j++);
        if (j < head.length) t += ' ' + head[j].trim();
      }
      var p = t.match(new RegExp('^' + TRADE + '\\s*(\\d[\\d억천,\\s]*)(?:\\/\\s*([\\d,]+))?'));
      if (!p) continue;
      listing.tradeType = p[1];
      listing.deposit = parseMoney(p[2]);
      if (p[3]) listing.rent = p[3].replace(/,/g, '');
      for (j = i - 1; j >= 0; j--) {
        var prev = head[j].trim();
        if (!prev) continue;
        if (prev.length <= 40 && !startsWithLabel(prev)) {
          var d = prev.match(/^(.*?)\s+(\d+동)$/);
          if (d) { listing.name = d[1]; listing.dongHo = d[2]; }
          else listing.name = prev;
        }
        break;
      }
      break;
    }
    if (!listing.deposit) {
      var price = get(['전세가', '보증금'], ['기본 정보']);
      if (price) { listing.deposit = parseMoney(price); listing.tradeType = '전세'; }
    }

    // 요약 줄 "아파트114A㎡ (전용84A)저/15층남향" 과 그 아래 한 줄 소개
    var summaryIdx = -1;
    for (i = 0; i < head.length; i++) {
      if (/㎡/.test(head[i]) && /층/.test(head[i]) && !startsWithLabel(head[i].trim())) { summaryIdx = i; break; }
    }
    var summary = summaryIdx >= 0 ? head[summaryIdx] : '';

    listing.features = get(['매물특징'], ['']);
    if (!listing.features && summaryIdx >= 0) {
      var intro = nextText(head, summaryIdx);
      if (intro && !/확인매물|최초게재/.test(intro) && !startsWithLabel(intro)) listing.features = intro;
    }
    var confirmed = head.join('\n').match(/확인매물\s*(\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (confirmed) listing.confirmedDate = [confirmed[1], ('0' + confirmed[2]).slice(-2), ('0' + confirmed[3]).slice(-2)].join('.');

    /* ---- 2) 기본 정보 ---- */
    listing.loan = get(['융자금']);
    listing.maintenanceFee = get(['월관리비', '관리비'], ['기본 정보', '']).replace(/상세보기$/, '').trim();
    listing.moveIn = get(['입주가능일']);
    listing.naverNo = firstNumber(get(['매물번호']));
    listing.direction = noParens(get(['방향', '향']));

    listing.supplyArea = firstNumber(get(['공급면적']));
    listing.exclusiveArea = firstNumber(get(['전용면적']));
    if (!listing.supplyArea || !listing.exclusiveArea) {
      var nums = get(['공급/전용면적', '계약/전용면적']).match(/[\d.]+(?=\s*㎡)/g) || [];
      listing.supplyArea = listing.supplyArea || nums[0] || '';
      listing.exclusiveArea = listing.exclusiveArea || nums[1] || '';
    }

    var floor = get(['해당층/총층']).match(/^\s*([^/\s(]+)\s*(?:\([^)]*\))?\s*\/\s*(\d+)/) ||
      summary.match(/([0-9]+|저|중|고)\/(\d+)층/);
    if (floor) { listing.floor = floor[1]; listing.totalFloor = floor[2]; }
    if (!listing.direction) {
      var dir = summary.match(/([남북동서]{1,2}향)/);
      if (dir) listing.direction = dir[1];
    }
    var room = get(['방수/욕실수']).match(/(\d+)\s*\/\s*(\d+)/);
    if (room) { listing.rooms = room[1]; listing.baths = room[2]; }

    // 매물 소개(설명): 여러 줄
    var desc = [];
    var intro2 = sectionLines(sections, '매물 소개');
    for (i = 0; i < intro2.length; i++) {
      t = intro2[i].trim();
      if (/최초게재|허위 매물 신고/.test(t)) break;
      if (!NOISE.test(t)) desc.push(t);
    }
    if (!desc.length) {
      for (i = 0; i < head.length; i++) {
        t = head[i].trim();
        if (t.indexOf('매물설명') !== 0) continue;
        var first = t.slice(4).replace(/^[\s:：]+/, '');
        if (first) desc.push(first);
        for (j = i + 1; j < head.length && !startsWithLabel(head[j].trim()); j++) desc.push(head[j].trim());
        break;
      }
    }
    listing.description = desc.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    /* ---- 3) 단지 정보 ---- */
    listing.address = get(['위치'], ['단지 정보']) || get(['소재지'], ['']);
    listing.approvalDate = noParens(get(['사용승인일']));
    listing.households = get(['총세대수', '세대수']);
    listing.entrance = get(['현관구조']);
    listing.heating = get(['난방(방식/연료)', '난방']);
    listing.parking = get(['총주차대수', '주차', '주차가능여부']);

    /* ---- 4) 실거래가, 학교 ---- */
    listing.dealHigh = get(['3년 내 최고'], ['실거래가']);
    listing.dealLow = get(['3년 내 최저'], ['실거래가']);

    var school = sectionLines(sections, '배정 초등학교');
    for (i = 0; i < school.length; i++) {
      t = school[i].trim();
      if (!t || NOISE.test(t)) continue;
      var dist = lookup(sections, ['배정 초등학교'], ['거리']).replace(/지도보기$/, '').replace(/(m)(도보)/, '$1 $2');
      listing.school = t.replace(/분류.*$/, '') + (dist ? ' (' + dist + ')' : '');
      break;
    }

    /* ---- 5) 중개사 ---- */
    var aLines = sectionLines(sections, '중개사');
    var aText = aLines.join('\n');
    var hasAgentSection = aLines.length > 0;
    var searchLines = hasAgentSection ? aLines : head;
    var searchText = hasAgentSection ? aText : head.join('\n');

    var nameIdx = -1;
    for (i = 0; i < searchLines.length; i++) {
      t = searchLines[i].trim();
      if (t && t.length <= 40 && AGENT_NAME.test(t) && !AGENT_SKIP.test(t)) { nameIdx = i; break; }
    }
    if (nameIdx >= 0) agent.name = searchLines[nameIdx].replace(/길찾기/g, '').trim();

    var rep = searchText.match(/대표\s*[:：]?\s*([가-힣A-Za-z]{2,10}?)\s*(?=등록번호|\n|$)/);
    if (rep) agent.rep = rep[1];
    else if (nameIdx > 0) {
      // 새 화면: 상호 바로 윗줄이 대표자 이름
      for (j = nameIdx - 1; j >= 0 && !searchLines[j].trim(); j--);
      var above = j >= 0 ? searchLines[j].trim() : '';
      if (/^[가-힣]{2,5}$/.test(above) && !AGENT_SKIP.test(above)) agent.rep = above;
    }

    var reg = searchText.match(/등록번호\s*[:：]?\s*([^\s]+)/);
    if (reg) agent.regNo = reg[1];

    if (hasAgentSection) {
      var addr = lookup(sections, ['중개사'], ['위치', '소재지']);
      if (!addr) { var am = aText.match(/소재지\s*[:：]?\s*(.+)/); addr = am ? am[1].trim() : ''; }
      if (addr) agent.address = addr;

      for (i = 0; i < aLines.length; i++) {
        t = aLines[i].trim();
        if (t.indexOf('전화') !== 0) continue;
        var telText = t.slice(2) || nextText(aLines, i);
        var tels = telText.match(PHONE);            // 번호 두 개가 붙어 나와도 각각 분리
        if (tels) { agent.phone = tels.join(', '); break; }
      }
    }
    if (!agent.phone && (agent.name || agent.regNo)) {
      var all = searchText.match(PHONE);
      if (all) agent.phone = all.join(', ');
    }

    Object.keys(listing).forEach(function (k) { if (!listing[k]) delete listing[k]; });
    return { listing: listing, agent: agent };
  }

  var api = { parseNaver: parseNaver, parseMoney: parseMoney };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.parseNaver = parseNaver; root.parseMoney = parseMoney; }
})(typeof window !== 'undefined' ? window : this);
