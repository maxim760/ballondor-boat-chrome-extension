(() => {
  "use strict";
  const polls = new Map();
  let ui;
  let selected = "";
  let lastError = "";
  const format = new Intl.NumberFormat("ru-RU");

  function showError(error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("[Ballon d’Or Votes]", error);
    try {
      mount();
      if (ui) {
        ui.badge.textContent = "Ошибка";
        ui.badge.classList.add("error");
        ui.status.textContent = `Ошибка: ${lastError}`;
        ui.status.classList.add("error");
        ui.list.replaceChildren();
      }
    } catch (fallbackError) {
      console.error("[Ballon d’Or Votes] Не удалось показать ошибку", fallbackError);
      // Independent fallback if creating the normal panel itself failed.
      try {
        const fallback = document.getElementById("bod-votes-error") || document.createElement("div");
        fallback.id = "bod-votes-error";
        fallback.textContent = `Ballon d’Or — ошибка: ${lastError}`;
        fallback.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;max-width:320px;padding:12px;background:#391b1b;color:#fff;font:13px system-ui;border-radius:10px";
        (document.body || document.documentElement)?.append(fallback);
      } catch { /* Console output remains available when the DOM is unusable. */ }
    }
  }

  // An outer try/catch cannot catch later event callbacks.
  const guarded = callback => (...args) => {
    try { return callback(...args); } catch (error) { showError(error); }
  };

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function onMessage(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.channel !== "ballondor-votes:v1") return;
    if (data.error) throw new Error(data.error);
    if (!Array.isArray(data.options)) {
      throw new Error("В ответе нет массива data.options.");
    }
    polls.set(data.poll, data);
    lastError = "";
    if (!selected) selected = data.poll;
    mount();
    render();
  }

  function mount(force = false) {
    if (ui || !document.body) return;
    // Keep listening on all routes so client-side navigation to /vote works too.
    if (!force && !lastError && !polls.size && !/(?:^|\/)vote(?:\/|$)/.test(location.pathname)) return;
    const host = element("div");
    host.id = "ballondor-votes-extension";
    host.style.cssText = "all:initial;position:fixed;right:16px;top:16px;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = element("style", `
      :host{color-scheme:dark}
      *{box-sizing:border-box}
      details{width:max-content;max-width:calc(100vw - 32px);font:14px/1.45 system-ui,sans-serif;
        color:#f3f1eb;background:#171819;border:1px solid #625337;border-radius:12px;
        box-shadow:0 16px 55px #0007;overflow:hidden}
      details[open]{width:min(390px,calc(100vw - 32px))}
      summary{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;
        gap:12px;cursor:pointer;list-style:none;user-select:none}
      summary::-webkit-details-marker{display:none}
      .chevron{color:#e9cb84}
      details[open] .chevron{transform:rotate(180deg)}
      .close{font:20px/1 system-ui;color:#aaa69e;background:transparent;
        border:0;border-radius:5px;cursor:pointer;padding:2px 5px}
      .close:hover{background:#ffffff18;color:#fff}
      .close:focus-visible{outline:2px solid #e9cb84}
      .title{font-weight:600;font-size:13px;color:#e9cb84}
      .badge{font-size:11px;color:#aaa69e}
      .error{color:#ffaaa5!important}
      summary:focus-visible{outline:2px solid #e9cb84;outline-offset:-3px}
      select{font:inherit;color:inherit;background:#292a2c;border:1px solid #555;
        border-radius:8px;padding:7px 10px}
      summary:hover{background:#ffffff08}
      select:focus-visible{outline:2px solid #e9cb84;outline-offset:2px}
      select{width:100%;margin-bottom:10px}
      .body{padding:4px 14px 14px;max-height:calc(100dvh - 90px);overflow:auto;
        overscroll-behavior:contain}
      .status{font-size:12px;color:#bbb6aa;margin:0 0 12px;overflow-wrap:anywhere}
      ol{list-style:none;margin:0;padding:0}
      li{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;
        gap:9px;padding:11px 0;border-top:1px solid #ffffff12}
      .rank{color:#b7a477;font-size:12px;font-variant-numeric:tabular-nums}
      .name{font-weight:600;overflow-wrap:anywhere}.year{display:block;color:#aaa69e;font-size:12px}
      .votes{font-weight:650;text-align:right;font-variant-numeric:tabular-nums;color:#edcf8b}
      .votes small{display:block;font-weight:400;font-size:10px;color:#aaa69e}
      footer{margin-top:12px;color:#aaa69e;font-size:11px}
      [hidden]{display:none!important}
    `);
    const panel = element("details");
    panel.setAttribute("aria-label", "Рейтинг голосования");
    const header = element("summary");
    const badge = element("span", "Ожидание", "badge");
    badge.setAttribute("role", "status");
    const body = element("div", undefined, "body");
    const close = element("button", "×", "close");
    close.type = "button";
    close.title = "Закрыть панель";
    close.setAttribute("aria-label", "Закрыть панель");
    close.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      host.style.display = "none";
    });
    const chevron = element("span", "⌄", "chevron");
    chevron.setAttribute("aria-hidden", "true");
    header.append(element("span", "Ballon d’Or · Голоса", "title"), badge, chevron, close);
    const select = element("select");
    select.setAttribute("aria-label", "Опрос");
    select.addEventListener("change", guarded(() => { selected = select.value; lastError = ""; render(); }));
    const status = element("p", undefined, "status");
    status.setAttribute("role", "status");
    const list = element("ol");
    body.append(select, status, list, element("footer",
      "Обновляется при ответе сайта. Для нового запроса перезагрузи страницу."));
    panel.append(header, body);
    shadow.append(style, panel);
    document.body.append(host);
    ui = { host, panel, header, select, status, list, badge };
  }

  function render() {
    if (!ui) return;
    ui.badge.classList.remove("error");
    ui.status.classList.remove("error");
    ui.select.replaceChildren(...[...polls].map(([key, poll]) => {
      const option = element("option", poll.title || key);
      option.value = key;
      return option;
    }));
    ui.select.value = selected;
    ui.select.hidden = polls.size < 2;
    ui.list.replaceChildren();
    const poll = polls.get(selected);
    if (lastError || poll?.error) {
      ui.badge.textContent = "Ошибка";
      ui.badge.classList.add("error");
      ui.status.classList.add("error");
      ui.status.textContent = `Ошибка: ${lastError || String(poll.error)}`;
      return;
    }
    if (!poll) {
      ui.badge.textContent = "Ожидание";
      ui.status.textContent = "Жду ответ polls… Если список не появляется, перезагрузи страницу после установки расширения.";
      return;
    }
    const ranked = voteRanking.getTopVotes(poll.options);
    ui.badge.textContent = `${ranked.length} вариантов`;
    ui.status.textContent = `${ranked.length} вариантов · ${new Date(poll.time).toLocaleTimeString("ru-RU")}`;
    if (!ranked.length) ui.status.textContent += " · Массив options пуст.";
    const fragment = document.createDocumentFragment();
    ranked.forEach(([, item], idx) => {
      const row = element("li");
      const name = element("div", item.title, "name");
      name.append(element("span", voteRanking.getYear(item.description), "year"));
      const votes = element("div", format.format(item.votes), "votes");
      votes.append(element("small", "голосов"));
      row.append(element("span", `#${idx + 1}`, "rank"), name, votes);
      fragment.append(row);
    });
    ui.list.append(fragment);
  }

  try {
    window.addEventListener("message", guarded(onMessage));
    chrome.runtime.onMessage.addListener(guarded((message, sender, sendResponse) => {
      if (message.type !== "OPEN_VOTES_PANEL") return;
      mount(true);
      if (!ui) throw new Error("Страница ещё загружается. Попробуй открыть панель ещё раз.");
      ui.host.style.display = "block";
      ui.panel.open = true;
      render();
      ui.header.focus();
      sendResponse({ opened: true });
    }));
    const initialize = guarded(() => { mount(); render(); });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
      initialize();
    }
  } catch (error) { showError(error); }
})();
