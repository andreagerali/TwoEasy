// Runs inside the HTML preview page (injected by main.js). Talks to the editor window with
// postMessage: reports the selection and the scroll position, and scrolls on request.
(function () {
  var parentWin = window.parent;
  if (!parentWin || parentWin === window) return;
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1 };

  function post(m) { m.twoeasy = 1; parentWin.postMessage(m, '*'); }

  // Anchors (#id) scroll inside the page.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    var id = decodeURIComponent(a.getAttribute('href').slice(1));
    var el = id ? document.getElementById(id) || document.getElementsByName(id)[0] : document.body;
    if (el) el.scrollIntoView();
  });

  // Text nodes with visible text, in document order. Index = position in this list.
  function textNodes() {
    var out = [];
    var w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) {
      if (n.parentNode && SKIP[n.parentNode.nodeName]) continue;
      if (/\S/.test(n.data)) out.push(n);
    }
    return out;
  }

  var lastSig = '';
  function reportSelection() {
    var s = getSelection();
    if (!s.rangeCount || s.isCollapsed) return post({ t: 'sel', sel: null });
    var r = s.getRangeAt(0);
    var list = textNodes();
    var hit = [];
    list.forEach(function (n, i) { if (r.intersectsNode(n)) hit.push(i); });
    if (!hit.length) return post({ t: 'sel', sel: null });
    var first = list[hit[0]];
    var last = list[hit[hit.length - 1]];
    var msg = {
      t: 'sel',
      sel: {
        s: { n: hit[0], o: first === r.startContainer ? r.startOffset : 0 },
        e: { n: hit[hit.length - 1], o: last === r.endContainer ? r.endOffset : last.data.length },
      },
    };
    var total = 0;
    list.forEach(function (n) { total += n.data.length; });
    var sig = list.length + ':' + total;
    if (sig !== lastSig) { lastSig = sig; msg.texts = list.map(function (n) { return n.data; }); }
    post(msg);
  }

  var selTimer = null;
  document.addEventListener('selectionchange', function () {
    clearTimeout(selTimer);
    selTimer = setTimeout(reportSelection, 120);
  });

  function maxScroll() { return Math.max(0, document.documentElement.scrollHeight - window.innerHeight); }
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      post({ t: 'scroll', y: window.scrollY, max: Math.max(1, maxScroll()) });
    });
  });

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (e.source !== parentWin || !m || m.twoeasy !== 1) return;
    if (m.t === 'ratio') window.scrollTo(0, Number(m.r) * maxScroll());
    else if (m.t === 'top') window.scrollTo(0, Number(m.y) || 0);
  });

  window.addEventListener('load', function () { post({ t: 'ready' }); });
})();
