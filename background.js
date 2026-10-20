"use strict";

chrome.action.onClicked.addListener(async tab => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "OPEN_VOTES_PANEL" });
    await chrome.action.setTitle({ tabId: tab.id, title: "Открыть панель Ballon d’Or" });
  } catch {
    // No content script on other sites or on tabs opened before installation.
    await chrome.action.setTitle({
      tabId: tab.id,
      title: "Открой ballondor.com/vote и перезагрузи страницу"
    });
  }
});
