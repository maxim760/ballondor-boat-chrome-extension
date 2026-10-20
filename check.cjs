const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const base = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const manifest = JSON.parse(fs.readFileSync(path.join(base, "manifest.json")));
for (const script of manifest.content_scripts.flatMap(entry => entry.js)) {
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
    "https://voting.fansunitedapi.com/notpolls"
  ]) {
    const ignored = setup();
    await ignored.window.fetch(url);
    await drain();
    assert.equal(ignored.messages.length, 0, url);
  }

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
  console.log("PASS: fetch/XHR; URL filtering; response preservation; errors; unmodified options; receiver array validation.");
})().catch(error => { console.error(error); process.exitCode = 1; });
