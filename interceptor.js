(() => {
  "use strict";
  const CHANNEL = "ballondor-votes:v1";

  function reportError(error) {
    try {
      window.postMessage({
        channel: CHANNEL,
        kind: "error",
        error: error instanceof Error ? error.message : String(error)
      }, location.origin);
    } catch (reportingError) {
      console.error("[Ballon d’Or Votes]", error, reportingError);
    }
  }

  function matches(raw) {
    try {
      const url = new URL(raw, location.href);
      return url.protocol === "https:" &&
        url.hostname === "voting.fansunitedapi.com" &&
        /\/polls(?:\/|$)/.test(url.pathname) &&
        !url.pathname.includes("/votes");
    } catch {
      return false;
    }
  }

  function publish(url, body, error = "") {
    try {
      const data = body?.data;
      window.postMessage({
        channel: CHANNEL,
        poll: new URL(url, location.href).pathname,
        title: data?.title,
        time: Date.now(),
        error: error,
        options: data?.options
      }, location.origin);
    } catch (error) { reportError(error); }
  }

  try {
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      // Return the original promise and Response; observing must not consume its body.
      const promise = Reflect.apply(originalFetch, this, args);
      const input = args[0];
      let url;
      try {
        url = input instanceof Request ? input.url : String(input);
      } catch (error) {
        reportError(error);
        return promise;
      }
      if (matches(url)) {
        promise.then(response => {
          if (!response.ok) {
            publish(url, null, `API вернул HTTP ${response.status}.`);
            return;
          }
          return response.clone().json().then(
            body => publish(url, body),
            () => publish(url, null, "Не удалось разобрать JSON ответа.")
          );
        }, () => publish(url, null, "Запрос завершился ошибкой сети."))
          .catch(reportError);
      }
      return promise;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const urls = new WeakMap();
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      const result = Reflect.apply(originalOpen, this, [method, url, ...rest]);
      try { urls.set(this, String(url)); } catch (error) { reportError(error); }
      return result;
    };
    XMLHttpRequest.prototype.send = function (...args) {
      const url = urls.get(this);
      if (matches(url)) {
        const inspect = () => {
          this.removeEventListener("loadend", inspect);
          try {
            if (this.status < 200 || this.status >= 300) {
              publish(url, null, `API вернул HTTP ${this.status} или запрос прерван.`);
            } else if (this.responseType === "json") {
              publish(url, this.response);
            } else if (!this.responseType || this.responseType === "text") {
              publish(url, JSON.parse(this.responseText));
            } else {
              publish(url, null, `Не поддерживается тип ответа: ${this.responseType}.`);
            }
          } catch {
            publish(url, null, "Не удалось разобрать JSON ответа.");
          }
        };
        try {
          this.addEventListener("loadend", inspect);
        } catch (error) {
          reportError(error);
          return Reflect.apply(originalSend, this, args);
        }
        try {
          return Reflect.apply(originalSend, this, args);
        } catch (error) {
          this.removeEventListener("loadend", inspect);
          reportError(error);
          throw error;
        }
      }
      return Reflect.apply(originalSend, this, args);
    };
  } catch (error) { reportError(error); }
})();
