const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const base = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const manifest = JSON.parse(fs.readFileSync(path.join(base, "manifest.json")));
for (const script of [...manifest.content_scripts.flatMap(entry => entry.js), "popup.js"]) {
  new vm.Script(fs.readFileSync(path.join(base, script), "utf8"), { filename: script });
}
const source = fs.readFileSync(path.join(base, "interceptor.js"), "utf8");
const endpoint = "https://voting.fansunitedapi.com/v1/polls/123?key=test";
const payload = { data: { options: [
  { title: "Player", description: "&lt;p&gt;2023 winner&lt;/p&gt;", votes: 42, id: "player-1" }
] } };
function setup(response = Response.json(payload)) {
  const messages = [];
  class XHR extends EventTarget {
    open(method, url) { this.url = url; }
    send() { this.sent = true; }
  }
  const originalPromise = Promise.resolve(response);
  const window = {
    fetch() { return originalPromise; },
    postMessage(message, origin) { messages.push({ message, origin }); }
  };
  const context = vm.createContext({
    window, XMLHttpRequest: XHR, Request, URL,
    location: { href: "https://ballondor.com/vote", origin: "https://ballondor.com" }
  });
  vm.runInContext(source, context);
  return { window, messages, XHR, originalPromise, response };
}
const drain = () => new Promise(resolve => setTimeout(resolve, 30));
(async () => {
  const env = setup();
  const returned = env.window.fetch(new Request(endpoint));
  assert.equal(returned, env.originalPromise);
  const siteResponse = await returned;
  assert.deepEqual(await siteResponse.json(), payload);
  await drain();
  assert.equal(env.messages.length, 1);
  assert.equal(env.messages[0].message.options[0].votes, 42);
  assert.deepEqual(env.messages[0].message.options, payload.data.options);
  assert.equal(env.messages[0].message.poll, "/v1/polls/123");
  assert.equal(env.messages[0].origin, "https://ballondor.com");

  for (const url of [
    "https://voting.fansunitedapi.com.evil.test/polls/123",
    "https://example.com/polls/123",
    "http://voting.fansunitedapi.com/polls/123",
    "https://voting.fansunitedapi.com/users?polls=1",
    "https://voting.fansunitedapi.com/notpolls",
    "https://voting.fansunitedapi.com/v1/polls/123/votes",
    "https://voting.fansunitedapi.com/v1/polls/123/votes/count"
  ]) {
    const ignored = setup();
    await ignored.window.fetch(url);
    await drain();
    assert.equal(ignored.messages.length, 0, url);
  }
  const ignoredVotes = setup(new Response("denied", { status: 403 }));
  await ignoredVotes.window.fetch(endpoint.replace("?key=test", "/votes"));
  const voteXhr = new ignoredVotes.XHR();
  voteXhr.open("POST", endpoint.replace("?key=test", "/votes"));
  voteXhr.status = 403;
  voteXhr.responseText = "invalid JSON";
  voteXhr.send();
  voteXhr.dispatchEvent(new Event("loadend"));
  await drain();
  assert.equal(ignoredVotes.messages.length, 0);

  for (const response of [
    new Response("oops"),
    new Response("denied", { status: 403 })
  ]) {
    const failure = setup(response);
    await failure.window.fetch(endpoint);
    await drain();
    assert.ok(failure.messages[0].message.error);
  }

  // Unexpected observer exceptions must be shown without rejecting the site's fetch.
  const brokenClone = setup({ ok: true, clone() { throw new Error("clone failed"); } });
  assert.equal(await brokenClone.window.fetch(endpoint), brokenClone.response);
  await drain();
  assert.equal(brokenClone.messages[0].message.kind, "error");
  assert.match(brokenClone.messages[0].message.error, /clone failed/);

  const networkError = new Error("offline");
  const network = setup(Promise.reject(networkError));
  await assert.rejects(network.window.fetch(endpoint), error => error === networkError);
  await drain();
  assert.match(network.messages[0].message.error, /ошибкой сети/);

  const xhrEnv = setup();
  const xhr = new xhrEnv.XHR();
  xhr.open("GET", endpoint);
  xhr.responseType = "";
  xhr.status = 200;
  xhr.responseText = JSON.stringify(payload);
  xhr.send();
  assert.ok(xhr.sent);
  xhr.dispatchEvent(new Event("loadend"));
  assert.equal(xhrEnv.messages[0].message.options[0].votes, 42);
  // A reused XHR must neither keep old listeners nor use its previous URL.
  xhr.open("GET", "https://example.com/other");
  xhr.send();
  xhr.dispatchEvent(new Event("loadend"));
  assert.equal(xhrEnv.messages.length, 1);
  xhr.open("GET", endpoint);
  xhr.responseType = "json";
  xhr.response = payload;
  xhr.send();
  xhr.dispatchEvent(new Event("loadend"));
  assert.equal(xhrEnv.messages.length, 2);

  // Validation belongs to the receiving handler; it also runs before DOM readiness.
  const errors = [];
  let onMessage;
  const panelWindow = { addEventListener(type, callback) { onMessage = callback; } };
  const panelContext = vm.createContext({
    window: panelWindow,
    location: { origin: "https://ballondor.com", pathname: "/vote" },
    document: { body: null, readyState: "loading", addEventListener() {} },
    chrome: { runtime: { onMessage: { addListener() {} } } },
    console: { error(label, error) { errors.push(error.message); } }
  });
  vm.runInContext(fs.readFileSync(path.join(base, "panel.js"), "utf8"), panelContext);
  const deliver = data => onMessage({
    source: panelWindow, origin: "https://ballondor.com", data
  });
  const missing = setup(Response.json({ data: {} }));
  await missing.window.fetch(endpoint);
  await drain();
  assert.equal(missing.messages[0].message.error, "");
  assert.equal(missing.messages[0].message.options, undefined);
  deliver(missing.messages[0].message);
  assert.equal(errors.pop(), "В ответе нет массива data.options.");
  deliver({ ...env.messages[0].message, options: {} });
  assert.equal(errors.pop(), "В ответе нет массива data.options.");
  deliver({ ...env.messages[0].message, options: undefined, error: "HTTP 503" });
  assert.equal(errors.pop(), "HTTP 503");
  deliver(env.messages[0].message);
  deliver({ ...env.messages[0].message, options: [] });
  deliver({ channel: "other" });
  assert.equal(errors.length, 0);
  // Exercise closing, background-to-content messaging and retained poll data.
  const nodes = [];
  function node(tag) {
    const result = {
      tag, children: [], style: {}, handlers: {}, open: false,
      classList: { add() {}, remove() {} },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {},
      addEventListener(type, callback) { this.handlers[type] = callback; },
      attachShadow() { return node("shadow"); },
      focus() { this.focused = true; }
    };
    nodes.push(result);
    return result;
  }
  let pageMessage, extensionMessage;
  let popupClosed = false;
  const openButton = node("button");
  const popupStatus = node("p");
  const body = node("body");
  const pageWindow = { addEventListener(type, callback) { pageMessage = callback; } };
  const chrome = {
    runtime: { onMessage: { addListener(callback) { extensionMessage = callback; } } },
    tabs: { async query() { return [{ id: 7 }]; }, async sendMessage(tabId, message) {
      assert.equal(tabId, 7);
      let response;
      extensionMessage(message, {}, value => { response = value; });
      assert.equal(response.opened, true);
      return response;
    } }
  };
  const uiContext = vm.createContext({
    chrome, window: pageWindow, console,
    location: { origin: "https://ballondor.com", pathname: "/vote" },
    document: { body, readyState: "complete", createElement: node,
      createDocumentFragment: () => node("fragment") },
    voteRanking: { getTopVotes: options => options.map(item => ["", item]), getYear: () => "2023" }
  });
  vm.runInContext(fs.readFileSync(path.join(base, "panel.js"), "utf8"), uiContext);
  const popupContext = vm.createContext({
    chrome, window: { close() { popupClosed = true; } },
    document: { getElementById(id) { return id === "open-panel" ? openButton : popupStatus; } }
  });
  vm.runInContext(fs.readFileSync(path.join(base, "popup.js"), "utf8"), popupContext);
  const host = body.children[0];
  const details = nodes.find(item => item.tag === "details");
  const close = nodes.find(item => item.className === "close");
  assert.equal(details.open, false);
  close.handlers.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(host.style.display, "none");
  pageMessage({ source: pageWindow, origin: "https://ballondor.com", data: env.messages[0].message });
  assert.equal(host.style.display, "none", "API updates must not reopen a closed panel");
  assert.equal(popupClosed, false);
  await openButton.handlers.click();
  assert.equal(popupClosed, true);
  assert.equal(host.style.display, "block");
  assert.equal(details.open, true);
  assert.equal(body.children.length, 1, "Reopen the existing panel");
  const list = nodes.find(item => item.tag === "ol");
  assert.equal(list.children[0].children.length, 1, "Retain the loaded option");
  assert.equal(nodes.find(item => item.tag === "summary").focused, true);
  const percentages = () => list.children[0].children.map(row =>
    row.children[2].children[0].textContent);
  assert.deepEqual(percentages(), ["100%"]);
  const deliverVotes = votes => pageMessage({
    source: pageWindow, origin: "https://ballondor.com",
    data: { ...env.messages[0].message,
      options: votes.map(votes => ({ ...payload.data.options[0], votes })) }
  });
  deliverVotes(["70", "30"]);
  assert.deepEqual(percentages(), ["70%", "30%"]);
  deliverVotes([0, 0]);
  assert.deepEqual(percentages(), ["0%", "0%"]);
  chrome.tabs.sendMessage = async () => { throw new Error("No receiver"); };
  popupClosed = false;
  await openButton.handlers.click();
  assert.equal(popupClosed, false);
  assert.equal(popupStatus.hidden, false);
  assert.equal(openButton.disabled, false);
  assert.match(popupStatus.textContent, /ballondor.com\/vote/);
  console.log("PASS: fetch/XHR; /votes excluded; response preservation; errors; options validation; close/reopen through toolbar; retained data.");
})().catch(error => { console.error(error); process.exitCode = 1; });
