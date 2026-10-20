"use strict";

const voteRanking = (() => {
  function getYear(html) {
    const div = document.createElement("div");
    div.innerHTML = html;

    const inner = document.createElement("div");
    inner.innerHTML = div.textContent;

    return inner.querySelector("p")?.textContent?.split(" ")?.[0] || "unknown";
  }

  function getTopVotes(options) {
    return options
      .toSorted((a, b) => b.votes - a.votes)
      .map((item, idx) => [
        `#${idx + 1} ${item.title} ${getYear(item.description)} - ${item.votes} votes`,
        item
      ]);
  }

  return { getYear, getTopVotes };
})();
