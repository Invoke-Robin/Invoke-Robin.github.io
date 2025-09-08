/* assets/js/mermaid-init.js */
(function () {
  function convertFences() {
    var codes = document.querySelectorAll("code.language-mermaid");
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i];
      var wrapper =
        code.closest("figure.highlight, pre, div.highlight") ||
        code.parentElement;
      var el = document.createElement("div");
      el.className = "mermaid";
      el.textContent = code.textContent;
      el.dataset.mmd = code.textContent;
      (wrapper || code).replaceWith(el);
    }
    var divs = document.querySelectorAll("div.mermaid");
    for (var j = 0; j < divs.length; j++) {
      if (!divs[j].dataset.mmd) divs[j].dataset.mmd = divs[j].textContent;
    }
  }

  var transparentRe = /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|^transparent$/i;
  function toRGB(str) {
    var probe = document.createElement("span");
    probe.style.color = str;
    document.body.appendChild(probe);
    var rgb = getComputedStyle(probe).color;
    probe.remove();
    var m = rgb && rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : { r: 17, g: 17, b: 17 };
  }
  function mix(a, b, t) {
    return {
      r: a.r * (1 - t) + b.r * t,
      g: a.g * (1 - t) + b.g * t,
      b: a.b * (1 - t) + b.b * t,
    };
  }
  function effectiveBg(el) {
    var cur = el;
    while (cur) {
      var bg = getComputedStyle(cur).backgroundColor;
      if (bg && !transparentRe.test(bg)) return bg;
      cur = cur.parentElement;
    }
    return "#ffffff";
  }
  function detectColors() {
    var bodyCS = getComputedStyle(document.body);
    var text = bodyCS.color || "#111111";
    var bg = effectiveBg(document.body);
    var a = document.createElement("a");
    a.href = "#";
    a.style.display = "none";
    document.body.appendChild(a);
    var link = getComputedStyle(a).color;
    a.remove();

    var textRGB = toRGB(text),
      bgRGB = toRGB(bg),
      linkRGB = toRGB(link);
    var borderRGB = mix(textRGB, bgRGB, 0.4);
    var panelRGB = mix(bgRGB, textRGB, 0.06);
    return {
      text: "rgb(" + textRGB.r + ", " + textRGB.g + ", " + textRGB.b + ")",
      bg: "rgb(" + bgRGB.r + ", " + bgRGB.g + ", " + bgRGB.b + ")",
      border:
        "rgb(" + borderRGB.r + ", " + borderRGB.g + ", " + borderRGB.b + ")",
      panel: "rgb(" + panelRGB.r + ", " + panelRGB.g + ", " + panelRGB.b + ")",
      accent: "rgb(" + linkRGB.r + ", " + linkRGB.g + ", " + linkRGB.b + ")",
    };
  }
  function configFromPage() {
    var c = detectColors();
    return {
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        background: c.bg,
        primaryTextColor: c.text,
        primaryBorderColor: c.border,
        lineColor: c.border,
        clusterBorder: c.border,
        clusterBkg: c.panel,
        primaryColor: c.panel,
        tertiaryColor: c.accent,
        edgeLabelBackground: c.bg,
      },
    };
  }

  function render() {
    if (!window.mermaid) return;
    var els = document.querySelectorAll(".mermaid");
    for (var i = 0; i < els.length; i++) {
      if (els[i].dataset.mmd) els[i].textContent = els[i].dataset.mmd;
      els[i].removeAttribute("data-processed");
    }
    window.mermaid.initialize(configFromPage());
    window.mermaid.run({ querySelector: ".mermaid" });
  }

  function loadMermaid(src, onload) {
    var s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = onload;
    s.onerror = function () {
      console.warn("Mermaid failed to load:", src);
    };
    document.head.appendChild(s);
  }

  function boot() {
    convertFences();
    if (window.mermaid) {
      render();
    } else {
      // CDN; see note below for local fallback
      loadMermaid(
        "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js",
        render
      );
    }

    var scheduleTimer = null;
    function schedule() {
      if (scheduleTimer) clearTimeout(scheduleTimer);
      scheduleTimer = setTimeout(render, 120);
    }
    var mql =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (mql) {
      if (mql.addEventListener) mql.addEventListener("change", schedule);
      else mql.addListener(schedule);
    }
    new MutationObserver(schedule).observe(document.documentElement, {
      attributes: true,
      subtree: true,
      childList: true,
    });
    window.forceMermaidRerender = render;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
