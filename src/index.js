import "./styles.css";

(function () {
  "use strict";

  /* ---------- theme: follow system, manual override via toggle ----------
     The palette and toggle label are pure CSS (light-dark() + color-scheme);
     the only job here is flipping the data-theme override. */

  var root = document.documentElement;
  var mq = window.matchMedia("(prefers-color-scheme: dark)");

  function effTheme() {
    return root.dataset.theme || (mq.matches ? "dark" : "light");
  }

  document.getElementById("theme-toggle").addEventListener("click", function () {
    root.dataset.theme = effTheme() === "dark" ? "light" : "dark";
  });

  /* ---------- vertical rhythm data ----------
     Derived from the rendered grid, so the CSS/HTML grid-row values stay
     the single source of truth. The g* spacer divs are the gap zones;
     each element's [topGap, bottomGap] is its adjacent pair of spacers.
     All values are DESIGN px (1rem = 10 design px, 32px rows) inside the
     40px page margins — resize-invariant, since the whole layout scales
     with the root font-size. CSS converts them back via * 0.1rem. */

  var page = document.getElementById("page");
  var content = document.querySelector(".content");

  /* the mobile single-column layout has no rulers and no grid to measure */
  var mqMobile = window.matchMedia("(max-width: 840px)");

  /* right-column keys measure on the right ruler, the rest on the left */
  var RIGHT = ["sub", "bio", "pageinfo", "gNavSub", "gSubBio", "gBioPage"];

  var GAPS = null;
  function deriveGaps() {
    GAPS = {};
    var leftGaps = [];
    var rightGaps = [];
    var elemTops = {};

    var toDesign = 10 / parseFloat(getComputedStyle(root).fontSize);
    var origin = content.getBoundingClientRect().top +
      parseFloat(getComputedStyle(content).paddingTop);

    document.querySelectorAll("[data-m]").forEach(function (el) {
      var rect = el.getBoundingClientRect();
      var top = Math.round((rect.top - origin) * toDesign);
      var key = el.dataset.m;
      if (/^g[A-Z]/.test(key)) {
        var gap = { top: top, h: Math.round(rect.height * toDesign) };
        GAPS[key] = [gap];
        /* side from the spacer's declared grid columns (columns 5+ are the
           right block); declarative, so it needs no horizontal layout */
        var cols = el.style.gridColumn.split("/");
        if (parseInt(cols[0], 10) < 5) leftGaps.push(gap);
        if (parseInt(cols[1] || cols[0], 10) > 5) rightGaps.push(gap);
      } else if (!(key in elemTops) || top < elemTops[key]) {
        elemTops[key] = top;
      }
    });

    var byTop = function (a, b) { return a.top - b.top; };
    leftGaps.sort(byTop);
    rightGaps.sort(byTop);

    Object.keys(elemTops).forEach(function (key) {
      var gaps = RIGHT.indexOf(key) >= 0 ? rightGaps : leftGaps;
      var top = elemTops[key];
      var above = null;
      var below = null;
      gaps.forEach(function (gap) {
        if (gap.top < top) above = gap;
        else if (!below) below = gap;
      });
      GAPS[key] = [above, below];
    });

    if (import.meta.env.DEV) {
      Object.keys(GAPS).forEach(function (key) {
        GAPS[key].forEach(function (gap) {
          if (gap) console.assert(gap.top % 32 === 0 && gap.h % 32 === 0, "off-grid gap for " + key, gap);
        });
      });
    }
  }

  /* design-px gaps are resize-invariant, so one derivation suffices — it
     just has to happen while the desktop layout is applied. Loading in the
     mobile layout defers it to the first desktop interaction. */
  if (!mqMobile.matches) deriveGaps();

  var brackets = {
    l: [document.getElementById("bracket-l0"), document.getElementById("bracket-l1")],
    r: [document.getElementById("bracket-r0"), document.getElementById("bracket-r1")]
  };

  /* ---------- split-flap dials ---------- */

  var DIGIT_STAGGER = 0.105; /* s per digit */

  function makeDial() {
    var dial = document.createElement("span");
    dial.className = "dial";
    var strip = document.createElement("span");
    strip.className = "strip";
    for (var d = 0; d <= 9; d++) {
      var digit = document.createElement("span");
      digit.textContent = d;
      strip.appendChild(digit);
    }
    dial.appendChild(strip);
    return dial;
  }

  function setLabelValue(labelEl, value) {
    var digits = String(value).split("");
    while (labelEl.children.length > digits.length) labelEl.removeChild(labelEl.lastChild);
    while (labelEl.children.length < digits.length) labelEl.appendChild(makeDial());
    digits.forEach(function (ch, i) {
      var strip = labelEl.children[i].firstChild;
      strip.style.transitionDelay = (i * DIGIT_STAGGER).toFixed(2) + "s";
      /* the strip is exactly 10 digits tall, so percentages of its own
         height land on digits at any scale */
      strip.style.transform = "translateY(" + (-Number(ch) * 10) + "%)";
    });
  }

  function setBracket(el, gap) {
    if (!gap) {
      el.classList.remove("on");
      return;
    }
    if (el.style.getPropertyValue("--gap-top") === "") {
      /* first placement: snap instead of animating in from 0/0 */
      el.classList.add("no-anim");
      void el.offsetWidth;
    }
    el.style.setProperty("--gap-top", gap.top);
    el.style.setProperty("--gap-h", gap.h);
    el.classList.remove("no-anim");
    setLabelValue(el.querySelector(".b-label"), gap.h);
    el.classList.add("on");
  }

  function showMeasurements(key) {
    if (mqMobile.matches) return;
    if (GAPS === null) deriveGaps();
    var gaps = GAPS[key] || [];
    var side = RIGHT.indexOf(key) >= 0 ? "r" : "l";
    var other = side === "r" ? "l" : "r";
    wake();
    setBracket(brackets[side][0], gaps[0]);
    setBracket(brackets[side][1], gaps[1]);
    brackets[other][0].classList.remove("on");
    brackets[other][1].classList.remove("on");
  }

  function hideMeasurements() {
    ["l", "r"].forEach(function (s) {
      brackets[s][0].classList.remove("on");
      brackets[s][1].classList.remove("on");
    });
  }

  document.querySelectorAll("[data-m]").forEach(function (el) {
    var show = function () { showMeasurements(el.dataset.m); };
    el.addEventListener("pointerenter", show);
    el.addEventListener("pointerleave", hideMeasurements);
    el.addEventListener("focus", show);
    el.addEventListener("blur", hideMeasurements);
  });

  /* ---------- grid + measurements only while the pointer moves ----------
     One live timer instead of clear+set per event: pointermove only stamps
     the time, and the timer re-arms itself until the idle window passes. */

  var IDLE_MS = 700;
  var idleTimer = null;
  var lastMove = 0;

  function idleCheck() {
    var remain = IDLE_MS - (Date.now() - lastMove);
    if (remain > 0) {
      idleTimer = setTimeout(idleCheck, remain);
    } else {
      idleTimer = null;
      page.classList.remove("is-moving");
    }
  }

  function wake() {
    lastMove = Date.now();
    if (idleTimer === null) {
      page.classList.add("is-moving");
      idleTimer = setTimeout(idleCheck, IDLE_MS);
    }
  }

  page.addEventListener("pointermove", wake);

  page.addEventListener("pointerleave", function () {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    page.classList.remove("is-moving");
    hideMeasurements();
  });
})();
