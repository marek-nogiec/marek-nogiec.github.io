import "./styles.css";

(function () {
  "use strict";

  /* ---------- theme ---------- */

  var root = document.documentElement;
  var mqDark = window.matchMedia("(prefers-color-scheme: dark)");
  var themeToggle = document.getElementById("theme-toggle");

  function effectiveTheme() {
    return root.dataset.theme || (mqDark.matches ? "dark" : "light");
  }

  function syncThemeControl() {
    var isDark = effectiveTheme() === "dark";
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.setAttribute(
      "aria-label",
      (isDark ? "Dark" : "Light") + " theme; switch to " + (isDark ? "light" : "dark") + " theme",
    );
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* Storage can be unavailable in hardened/private browsing contexts. */
    }
  }

  syncThemeControl();

  themeToggle.addEventListener("click", function () {
    var nextTheme = effectiveTheme() === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    storeTheme(nextTheme);
    syncThemeControl();
  });

  mqDark.addEventListener("change", function () {
    if (!root.dataset.theme) syncThemeControl();
  });

  /* ---------- measurement geometry ----------
     Spacer rows remain the CSS/HTML source of truth. Geometry is derived only
     after the critical render, or synchronously on the first interaction. */

  var page = document.getElementById("page");
  var content = document.querySelector(".content");
  var mqCompact = window.matchMedia("(max-width: 959px)");
  var mqFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  var GAPS = null;
  var gapDerivationScheduled = false;

  function deriveGaps() {
    GAPS = {};

    var leftGaps = [];
    var rightGaps = [];
    var elements = {};
    var rootSize = parseFloat(getComputedStyle(root).fontSize);
    var contentStyle = getComputedStyle(content);
    var contentRect = content.getBoundingClientRect();
    var toDesign = 10 / rootSize;
    var origin = contentRect.top + parseFloat(contentStyle.paddingTop);
    var paddingLeft = parseFloat(contentStyle.paddingLeft);
    var paddingRight = parseFloat(contentStyle.paddingRight);
    var gridWidth = contentRect.width - paddingLeft - paddingRight;
    var rightColumnStart = contentRect.left + paddingLeft + gridWidth * 2 / 3;

    document.querySelectorAll("[data-m]").forEach(function (el) {
      var rect = el.getBoundingClientRect();
      var top = Math.round((rect.top - origin) * toDesign);
      var key = el.dataset.m;
      var side = rect.left >= rightColumnStart - 1 ? "r" : "l";

      if (/^g[A-Z]/.test(key)) {
        var gap = { top: top, h: Math.round(rect.height * toDesign) };
        GAPS[key] = { gaps: [gap], side: side };

        if (rect.left < rightColumnStart - 1) leftGaps.push(gap);
        if (rect.right > rightColumnStart + 1) rightGaps.push(gap);
      } else if (!(key in elements) || top < elements[key].top) {
        elements[key] = { top: top, side: side };
      }
    });

    var byTop = function (a, b) { return a.top - b.top; };
    leftGaps.sort(byTop);
    rightGaps.sort(byTop);

    Object.keys(elements).forEach(function (key) {
      var item = elements[key];
      var candidates = item.side === "r" ? rightGaps : leftGaps;
      var above = null;
      var below = null;

      candidates.forEach(function (gap) {
        if (gap.top < item.top) above = gap;
        else if (!below) below = gap;
      });

      GAPS[key] = { gaps: [above, below], side: item.side };
    });

    if (import.meta.env.DEV) {
      Object.keys(GAPS).forEach(function (key) {
        GAPS[key].gaps.forEach(function (gap) {
          if (gap) {
            console.assert(
              gap.top % 32 === 0 && gap.h % 32 === 0,
              "off-grid gap for " + key,
              gap,
            );
          }
        });
      });
    }
  }

  function scheduleGapDerivation() {
    if (mqCompact.matches || GAPS !== null || gapDerivationScheduled) return;
    gapDerivationScheduled = true;

    var run = function () {
      gapDerivationScheduled = false;
      if (!mqCompact.matches && GAPS === null) deriveGaps();
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 1500 });
    } else {
      setTimeout(run, 0);
    }
  }

  var brackets = {
    l: [document.getElementById("bracket-l0"), document.getElementById("bracket-l1")],
    r: [document.getElementById("bracket-r0"), document.getElementById("bracket-r1")],
  };

  /* ---------- split-flap dials ---------- */

  var DIGIT_STAGGER = 0.105;

  function makeDial() {
    var dial = document.createElement("span");
    dial.className = "dial";

    var strip = document.createElement("span");
    strip.className = "strip";

    for (var digitValue = 0; digitValue <= 9; digitValue += 1) {
      var digit = document.createElement("span");
      digit.textContent = digitValue;
      strip.appendChild(digit);
    }

    dial.appendChild(strip);
    return dial;
  }

  function setLabelValue(labelEl, value) {
    var digits = String(value).split("");

    while (labelEl.children.length > digits.length) {
      labelEl.removeChild(labelEl.lastChild);
    }
    while (labelEl.children.length < digits.length) {
      labelEl.appendChild(makeDial());
    }

    digits.forEach(function (character, index) {
      var strip = labelEl.children[index].firstChild;
      strip.style.transitionDelay = (index * DIGIT_STAGGER).toFixed(2) + "s";
      strip.style.transform = "translateY(" + (-Number(character) * 10) + "%)";
    });
  }

  function setBracket(el, gap) {
    if (!gap) {
      el.classList.remove("on");
      return;
    }

    var isFirstPlacement = el.style.getPropertyValue("--gap-top") === "";
    if (isFirstPlacement) el.classList.add("no-anim");

    el.style.setProperty("--gap-top", gap.top);
    el.style.setProperty("--gap-h", gap.h);
    setLabelValue(el.querySelector(".b-label"), gap.h);
    el.classList.add("on");

    if (isFirstPlacement) {
      requestAnimationFrame(function () {
        el.classList.remove("no-anim");
      });
    }
  }

  function hideMeasurements() {
    ["l", "r"].forEach(function (side) {
      brackets[side][0].classList.remove("on");
      brackets[side][1].classList.remove("on");
    });
  }

  function showMeasurements(el, persistent) {
    if (mqCompact.matches) return;
    if (GAPS === null) deriveGaps();

    var item = GAPS[el.dataset.m];
    if (!item) return;

    var otherSide = item.side === "r" ? "l" : "r";
    if (persistent) page.classList.add("is-focus-measuring");
    else wake();

    setBracket(brackets[item.side][0], item.gaps[0]);
    setBracket(brackets[item.side][1], item.gaps[1]);
    brackets[otherSide][0].classList.remove("on");
    brackets[otherSide][1].classList.remove("on");
  }

  /* ---------- pointer activity ----------
     Pointer events are delegated, capped to one wake-up per animation frame,
     and ignored on coarse/non-hover pointers. */

  var IDLE_MS = 700;
  var idleTimer = null;
  var lastMove = 0;
  var moveFrame = 0;
  var measurementListenersReady = false;

  function idleCheck() {
    var remaining = IDLE_MS - (Date.now() - lastMove);

    if (remaining > 0) {
      idleTimer = setTimeout(idleCheck, remaining);
    } else {
      idleTimer = null;
      page.classList.remove("is-moving");
    }
  }

  function startMoving() {
    if (idleTimer === null) {
      page.classList.add("is-moving");
      idleTimer = setTimeout(idleCheck, IDLE_MS);
    }
  }

  function wake() {
    lastMove = Date.now();
    startMoving();
  }

  function notePointerMove() {
    if (mqCompact.matches || !mqFinePointer.matches) return;
    lastMove = Date.now();

    if (moveFrame === 0) {
      moveFrame = requestAnimationFrame(function () {
        moveFrame = 0;
        startMoving();
      });
    }
  }

  function closestMeasured(node) {
    return node instanceof Element ? node.closest("[data-m]") : null;
  }

  function initMeasurementListeners() {
    if (measurementListenersReady) return;
    measurementListenersReady = true;

    content.addEventListener("pointerover", function (event) {
      if (mqCompact.matches || !mqFinePointer.matches) return;
      var target = closestMeasured(event.target);
      var previous = closestMeasured(event.relatedTarget);
      if (target && target !== previous) showMeasurements(target, false);
    });

    content.addEventListener("pointerout", function (event) {
      if (mqCompact.matches || !mqFinePointer.matches) return;
      var target = closestMeasured(event.target);
      var next = closestMeasured(event.relatedTarget);
      if (!target || target === next) return;
      if (next && content.contains(next)) showMeasurements(next, false);
      else hideMeasurements();
    });

    content.addEventListener("focusin", function (event) {
      var target = closestMeasured(event.target);
      if (target) showMeasurements(target, true);
    });

    content.addEventListener("focusout", function (event) {
      var next = closestMeasured(event.relatedTarget);
      if (next && content.contains(next)) {
        showMeasurements(next, true);
      } else {
        page.classList.remove("is-focus-measuring");
        hideMeasurements();
      }
    });

    page.addEventListener("pointermove", notePointerMove, { passive: true });

    page.addEventListener("pointerleave", function () {
      if (moveFrame !== 0) {
        cancelAnimationFrame(moveFrame);
        moveFrame = 0;
      }
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }

      page.classList.remove("is-moving");
      if (!page.classList.contains("is-focus-measuring")) hideMeasurements();
    });
  }

  function enableDesktopMeasurements() {
    if (mqCompact.matches) return;
    initMeasurementListeners();
    scheduleGapDerivation();
  }

  enableDesktopMeasurements();

  mqCompact.addEventListener("change", function (event) {
    if (event.matches) {
      page.classList.remove("is-moving", "is-focus-measuring");
      hideMeasurements();
    } else {
      enableDesktopMeasurements();
    }
  });
})();
