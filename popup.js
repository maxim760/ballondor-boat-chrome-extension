"use strict";

const openButton = document.getElementById("open-panel");
const status = document.getElementById("status");

openButton.addEventListener("click", async () => {
  openButton.disabled = true;
  status.hidden = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, { type: "OPEN_VOTES_PANEL" });
    if (!response?.opened) throw new Error("Панель не открылась");
    window.close();
  } catch {
    status.textContent = "Не удалось открыть панель. Открой ballondor.com/vote и перезагрузи страницу.";
    status.hidden = false;
  } finally {
    openButton.disabled = false;
  }
});
