// ==UserScript==
// @name         Debiteringsapp IntelliPlan
// @namespace    robin/debitering
// @version      2026.4.13.145052
// @description  Stabil version för Normal tid, ATF, SAT-tid och Skiftformstillägg.
// @match        https://*.intelliplan.eu/*
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @downloadURL  https://raw.githubusercontent.com/FirstPersonal/debiteringsapp-intelliplan-script/main/intelliplan-debitering.user.js
// @updateURL    https://raw.githubusercontent.com/FirstPersonal/debiteringsapp-intelliplan-script/main/intelliplan-debitering.user.js
// @homepageURL  https://github.com/FirstPersonal/debiteringsapp-intelliplan-script
// ==/UserScript==

(function () {
  "use strict";

  if (window.top !== window.self) {
    return;
  }

  const SCRIPT_VERSION = (typeof GM_info !== "undefined" && GM_info.script && GM_info.script.version)
    ? GM_info.script.version
    : "okänd";

  const PANEL_ID = "debiteringsapp-panel";
  const BRIDGE_URL = "http://127.0.0.1:8765/current";
  const AUTO_REFRESH_INTERVAL_MS = 3000;

  const ARTICLE_NORMAL = "Normal tid";
  const ARTICLE_ATF = "ATF";
  const ARTICLE_SAT = "SAT-tid";
  const ARTICLE_SHIFT = "Skiftformstillägg";

  const TEXT_NORMTID = "Normaltid";
  const TEXT_ATF_MARKER = "Arbetstidsförkortning";
  const TEXT_SAT_MARKER = "SAT-tid";
  const TEXT_LON_PRIS = "Lön & pris";
  const TEXT_FAST_LON = "Fast lön";
  const TEXT_PERCENT_LON = "% av lön";
  const TEXT_FAST_PRIS = "Fast pris";

  const ROW_CONFIGS = {
    fastLon: {
      suffix: "OrderPricingTimeArticleCard.PriceInHeader.PriceIn.",
      text: TEXT_FAST_LON,
      inputSelector: "#PriceIn"
    },
    percentLon: {
      suffix: "OrderPricingTimeArticleCard.PriceOutHeader.PriceOutCostRelative.",
      text: TEXT_PERCENT_LON,
      inputSelector: "#PriceOutCostRelative"
    },
    fastPris: {
      suffix: "OrderPricingTimeArticleCard.PriceOutHeader.PriceOut.",
      text: TEXT_FAST_PRIS,
      inputSelector: "#PriceOut"
    }
  };

  const ARTICLE_CONFIGS = {
    normal: {
      name: ARTICLE_NORMAL,
      markerText: TEXT_NORMTID,
      fallbackTexts: [ARTICLE_NORMAL, TEXT_NORMTID]
    },
    atf: {
      name: ARTICLE_ATF,
      markerText: TEXT_ATF_MARKER,
      fallbackTexts: [ARTICLE_ATF, TEXT_ATF_MARKER]
    },
    sat: {
      name: ARTICLE_SAT,
      markerText: TEXT_SAT_MARKER,
      fallbackTexts: [ARTICLE_SAT]
    },
    shift: {
      name: ARTICLE_SHIFT,
      markerText: ARTICLE_SHIFT,
      fallbackTexts: [ARTICLE_SHIFT, TEXT_LON_PRIS]
    }
  };
  const ARTICLE_CONFIGS_BY_NAME = Object.fromEntries(
    Object.values(ARTICLE_CONFIGS).map((config) => [config.name, config])
  );

  let bridgeData = null;
  let isCollapsed = true;
  let panelPosition = null;
  let manualRefreshInFlight = false;
  let bridgeFingerprint = null;
  let bridgeRefreshInFlight = false;
  let autoRefreshTimerId = null;

  const styles = `
    #${PANEL_ID} {
      position: fixed;
      right: 18px;
      bottom: 18px;
      width: 320px;
      max-height: calc(100vh - 40px);
      overflow: auto;
      z-index: 999999;
      background: #ffffff;
      color: #0f172a;
      border: 1px solid #dbe4ee;
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.18);
      font-family: "Segoe UI", sans-serif;
    }
    #${PANEL_ID}.collapsed {
      width: 220px;
    }
    #${PANEL_ID} .head {
      background: linear-gradient(135deg, #0f766e, #115e59);
      color: #ffffff;
      padding: 14px 16px 12px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      cursor: move;
      user-select: none;
    }
    #${PANEL_ID} .head-main {
      min-width: 0;
      flex: 1 1 auto;
    }
    #${PANEL_ID} .head-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }
    #${PANEL_ID} .title {
      font-size: 15px;
      font-weight: 700;
      margin: 0;
    }
    #${PANEL_ID} .sub {
      font-size: 11px;
      opacity: 0.9;
      margin-top: 2px;
    }
    #${PANEL_ID} .toggle {
      border: 0;
      width: 30px;
      height: 30px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.18);
      color: #ffffff;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      font-weight: 700;
      flex: 0 0 auto;
    }
    #${PANEL_ID} .icon-button {
      border: 0;
      width: 30px;
      height: 30px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.18);
      color: #ffffff;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      font-weight: 700;
      flex: 0 0 auto;
      transition: transform 0.2s ease, background 0.2s ease, opacity 0.2s ease;
    }
    #${PANEL_ID} .icon-button:active {
      transform: scale(0.92);
    }
    #${PANEL_ID} .icon-button.is-busy {
      background: rgba(255, 255, 255, 0.28);
      cursor: wait;
      animation: ${PANEL_ID}-spin 0.8s linear infinite;
    }
    #${PANEL_ID} .icon-button:disabled {
      opacity: 0.9;
    }
    #${PANEL_ID} .body {
      padding: 14px;
    }
    #${PANEL_ID}.collapsed .body {
      display: none;
    }
    #${PANEL_ID} .status {
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.5;
      background: #e0f2fe;
      color: #075985;
    }
    #${PANEL_ID} .button {
      width: 100%;
      border: 0;
      border-radius: 10px;
      padding: 11px 12px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      background: #0f766e;
      color: #ffffff;
      margin-top: 10px;
    }
    #${PANEL_ID} .button.secondary {
      background: #e2e8f0;
      color: #0f172a;
    }
    #${PANEL_ID} .data {
      margin-top: 12px;
      font-size: 12px;
      line-height: 1.6;
      color: #334155;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 10px 12px;
      white-space: pre-line;
    }
    @keyframes ${PANEL_ID}-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = styles;
    document.head.appendChild(style);
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function setStatus(text) {
    const status = document.querySelector(`#${PANEL_ID} .status`);
    if (status) status.textContent = text;
  }

  function setRefreshButtonBusy(isBusy) {
    const button = document.querySelector(`#${PANEL_ID} .button-refresh-compact`);
    if (!button) return;
    button.classList.toggle("is-busy", isBusy);
    button.disabled = isBusy;
    button.title = isBusy ? "Uppdaterar värden..." : "Uppdatera värden";
    button.setAttribute("aria-label", button.title);
  }

  function getBridgeFingerprint(data) {
    if (!data) return null;
    if (data.updatedAt) return String(data.updatedAt);
    return JSON.stringify(data.display || data);
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function formatBridgeData(data) {
    if (!data || !data.display) {
      return "Ingen data hämtad ännu.";
    }

    const display = data.display;
    const atfPrice = Number(display.atfPrice ?? 0);
    const satPrice = Number(display.satPrice ?? 0);
    const atfContribution = Number(display.atfContribution ?? 0);
    const satContribution = Number(display.satContribution ?? 0);
    const atfSatContribution = atfContribution + satContribution;
    const hasSat = satPrice > 0;
    const lines = [
      `Normal tid: Fast lön ${Number(display.salaryPrice ?? 0).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, % av lön ${Number(display.salaryFactorPercent ?? 0).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `ATF: Fast pris ${atfPrice.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `${hasSat ? "ATF + SAT (avsättning)" : "ATF (avsättning)"}: ${atfSatContribution.toLocaleString("sv-SE", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    ];

    if (hasSat) {
      lines.push(`SAT-tid: Fast pris ${satPrice.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    }

    if (Number(display.shiftPrice ?? 0) > 0) {
      lines.push(`Skiftformstillägg: Fast lön ${Number(display.shiftPrice ?? 0).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, % av lön ${Number(display.shiftFactorPercent ?? 0).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    }

    return lines.join("\n");
  }

  function setDataText(text) {
    const data = document.querySelector(`#${PANEL_ID} .data`);
    if (data) data.textContent = text;
  }

  function updateDataPanel() {
    setDataText(formatBridgeData(bridgeData));
    window.requestAnimationFrame(keepPanelVisible);
  }

  function isSatEnabled() {
    return !!(bridgeData && bridgeData.display && bridgeData.display.useSat);
  }

  function hasShiftValue() {
    return !!(bridgeData && bridgeData.display && Number(bridgeData.display.shiftPrice ?? 0) > 0);
  }

  function updateSatButtonVisibility() {
    const button = document.querySelector(`#${PANEL_ID} .button-fill-sat`);
    if (!button) return;
    button.style.display = isSatEnabled() ? "" : "none";
    window.requestAnimationFrame(keepPanelVisible);
  }

  function updateShiftButtonVisibility() {
    const button = document.querySelector(`#${PANEL_ID} .button-fill-shift`);
    if (!button) return;
    button.style.display = hasShiftValue() ? "" : "none";
    window.requestAnimationFrame(keepPanelVisible);
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-9999px";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.focus();
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  function getCopyUnderlagText() {
    if (bridgeData && bridgeData.copy && bridgeData.copy.combined) {
      return bridgeData.copy.combined;
    }
    return formatBridgeData(bridgeData);
  }

  function updateToggleButton() {
    const button = document.querySelector(`#${PANEL_ID} .toggle`);
    const panel = document.getElementById(PANEL_ID);
    if (!button || !panel) return;
    const rectBefore = panel.getBoundingClientRect();
    panel.classList.toggle("collapsed", isCollapsed);
    button.textContent = isCollapsed ? "+" : "−";
    button.title = isCollapsed ? "Visa panel" : "Minimera panel";
    button.setAttribute("aria-label", button.title);
    window.requestAnimationFrame(() => {
      if (isCollapsed) {
        panelPosition = {
          left: window.innerWidth - panel.offsetWidth - 18,
          top: rectBefore.bottom - panel.offsetHeight
        };
      } else if (panelPosition) {
        panelPosition = {
          left: rectBefore.left,
          top: rectBefore.bottom - panel.offsetHeight
        };
      }
      applyPanelPosition();
    });
  }

  function togglePanel() {
    isCollapsed = !isCollapsed;
    updateToggleButton();
  }

  function clampPanelPosition(panel, left, top) {
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);

    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop)
    };
  }

  function applyPanelPosition() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !panelPosition) return;

    const clamped = clampPanelPosition(panel, panelPosition.left, panelPosition.top);
    panel.style.left = `${clamped.left}px`;
    panel.style.top = `${clamped.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panelPosition = clamped;
  }

  function keepPanelVisible() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !panelPosition || isCollapsed) return;

    const margin = 12;
    const rect = panel.getBoundingClientRect();
    let nextLeft = panelPosition.left;
    let nextTop = panelPosition.top;

    if (rect.right > window.innerWidth - margin) {
      nextLeft -= rect.right - (window.innerWidth - margin);
    }
    if (rect.bottom > window.innerHeight - margin) {
      nextTop -= rect.bottom - (window.innerHeight - margin);
    }
    if (rect.left < margin) {
      nextLeft += margin - rect.left;
    }
    if (rect.top < margin) {
      nextTop += margin - rect.top;
    }

    panelPosition = clampPanelPosition(panel, nextLeft, nextTop);
    applyPanelPosition();
  }

  function enableDragging(panel) {
    const head = panel.querySelector(".head");
    const toggle = panel.querySelector(".toggle");
    if (!head) return;

    let dragState = null;

    head.addEventListener("pointerdown", (event) => {
      if (event.target === toggle || toggle.contains(event.target)) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };

      head.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    head.addEventListener("pointermove", (event) => {
      if (!dragState) return;

      panelPosition = clampPanelPosition(
        panel,
        event.clientX - dragState.offsetX,
        event.clientY - dragState.offsetY
      );
      applyPanelPosition();
    });

    function stopDrag(event) {
      if (!dragState) return;
      dragState = null;
      try {
        head.releasePointerCapture(event.pointerId);
      } catch (_error) {
      }
    }

    head.addEventListener("pointerup", stopDrag);
    head.addEventListener("pointercancel", stopDrag);
  }

  function realClick(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.min(rect.width / 2, 20);
    const clientY = rect.top + Math.min(rect.height / 2, 20);

    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY
      }));
    });

    if (typeof element.click === "function") {
      element.click();
    }
  }

  function setNativeInputValue(input, value) {
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value")
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
  }

  function rightSideContexts() {
    return [...document.querySelectorAll('[data-type="Context"]')]
      .filter(isVisible)
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left > (window.innerWidth * 0.5) && rect.top > 120;
      });
  }

  function isArticleDetailContext(node) {
    if (!node) return false;
    if ((node.id || "").includes("OrderPricingTimeArticleContext.")) return true;
    return !!node.querySelector('[id*="OrderPricingTimeArticleContext."]');
  }

  function rightSideArticlePanels() {
    return [...document.querySelectorAll('[id*="OrderPricingTimeArticleContext."]')]
      .map((node) => node.closest('[data-type="Context"]') || node)
      .filter(Boolean)
      .filter((node, index, array) => array.indexOf(node) === index)
      .filter(isVisible)
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left > (window.innerWidth * 0.55) && rect.top > 80;
      });
  }

  function rightSideMarker(exactText) {
    return rightSideArticlePanels()
      .flatMap((panel) => [panel, ...panel.querySelectorAll("div, p, span")])
      .filter(isVisible)
      .find((node) => (node.innerText || "").trim() === exactText) || null;
  }

  function findArticleListRow(articleTitle) {
    return [...document.querySelectorAll('[id$="TimeArticle.Open"][data-type="ClickableArea"]')]
      .filter(isVisible)
      .find((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.top < 120) return false;
        return !!node.querySelector(`h4[title="${articleTitle}"]`);
      }) || null;
  }

  function findOpenArticlePanel(articleName) {
    const contexts = rightSideArticlePanels();
    const config = ARTICLE_CONFIGS_BY_NAME[articleName];
    if (!config) return null;

    const marker = rightSideMarker(config.markerText);
    if (marker) {
      return contexts.find((node) => node === marker || node.contains(marker))
        || marker.closest('[data-type="Context"]')
        || marker.closest('[id*="OrderPricingTimeArticleContext."]');
    }

    return contexts.find((node) => {
      const text = node.innerText || "";
      return config.fallbackTexts.every((part) => text.includes(part));
    }) || null;
  }

  function findRowInOpenPanel(articleName, suffix, textMatch) {
    const panel = findOpenArticlePanel(articleName);
    if (!panel) return null;
    return [...panel.querySelectorAll(`[id$="${suffix}"][data-type="ClickableArea"]`)]
      .filter(isVisible)
      .find((node) => (node.innerText || "").includes(textMatch)) || null;
  }

  function findSaveButton() {
    return [...document.querySelectorAll("button")]
      .filter(isVisible)
      .find((button) => (button.innerText || "").includes("Spara")) || null;
  }

  function fetchBridgeData() {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: BRIDGE_URL,
        nocache: true,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(response.responseText));
          } catch (_error) {
            resolve(null);
          }
        },
        onerror: () => resolve(null)
      });
    });
  }

  async function refreshBridgeData() {
    setStatus("Hämtar data från appen...");
    bridgeData = await fetchBridgeData();
    updateDataPanel();
    updateSatButtonVisibility();
    updateShiftButtonVisibility();

    if (!bridgeData) {
      setStatus("Kunde inte hämta data från appen.");
      return false;
    }

    setStatus("Data hämtades från appen.");
    return true;
  }

  async function handleManualRefresh() {
    if (manualRefreshInFlight) return;

    manualRefreshInFlight = true;
    setRefreshButtonBusy(true);
    const startedAt = Date.now();

    try {
      await refreshBridgeData();
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 350) {
        await sleep(350 - elapsed);
      }
      setRefreshButtonBusy(false);
      manualRefreshInFlight = false;
    }
  }

  async function ensureBridgeData() {
    if (!bridgeData) {
      return refreshBridgeData();
    }
    updateSatButtonVisibility();
    updateShiftButtonVisibility();
    return true;
  }

  async function autoRefreshBridgeData() {
    if (bridgeRefreshInFlight) {
      return !!bridgeData;
    }

    bridgeRefreshInFlight = true;
    const fetchedData = await fetchBridgeData();
    bridgeRefreshInFlight = false;

    if (!fetchedData) {
      return false;
    }

    const nextFingerprint = getBridgeFingerprint(fetchedData);
    const didChange = nextFingerprint !== bridgeFingerprint;

    bridgeData = fetchedData;
    bridgeFingerprint = nextFingerprint;
    updateDataPanel();
    updateSatButtonVisibility();
    updateShiftButtonVisibility();

    if (didChange) {
      setStatus("Värden uppdaterades automatiskt.");
    }

    return true;
  }

  async function openArticle(articleName) {
    if (findOpenArticlePanel(articleName)) {
      setStatus(`${articleName} är redan öppen.`);
      return true;
    }

    const target = findArticleListRow(articleName);
    if (!target) {
      setStatus(`Hittade inte raden för ${articleName}.`);
      return false;
    }

    setStatus(`Klickar på ${articleName}...`);
    realClick(target);

    for (let i = 0; i < 30; i += 1) {
      if (findOpenArticlePanel(articleName)) {
        setStatus(`${articleName} öppnades.`);
        return true;
      }
      await sleep(100);
    }

    setStatus(`Raden hittades och klickades, men ${articleName} öppnades inte.`);
    return false;
  }

  async function openRow(articleName, suffix, textMatch, inputSelector, label) {
    const row = findRowInOpenPanel(articleName, suffix, textMatch);
    if (!row) {
      setStatus(`${label} är inte synlig i högerspalten.`);
      return false;
    }

    const clickTargets = [
      row,
      row.querySelector(`[title="${textMatch}"]`),
      row.querySelector("span"),
      row.firstElementChild
    ].filter((element) => element && isVisible(element));

    for (const target of clickTargets) {
      realClick(target);

      for (let i = 0; i < 15; i += 1) {
        const input = document.querySelector(inputSelector);
        if (input && isVisible(input)) {
          setStatus(`Dialogen för ${label} öppnades.`);
          return true;
        }
        await sleep(100);
      }
    }

    setStatus(`Raden ${label} hittades, men dialogen öppnades inte.`);
    return false;
  }

  async function fillOpenDialog(inputSelector, value, infoLabel, successLabel) {
    const input = document.querySelector(inputSelector);
    if (!input || !isVisible(input)) {
      setStatus(`Dialogen för ${successLabel} är inte öppen.`);
      return false;
    }

    setDataText(`${infoLabel}: ${value}`);
    input.focus();
    setNativeInputValue(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Tab" }));
    input.blur();

    await sleep(250);

    const saveButton = findSaveButton();
    if (!saveButton) {
      setStatus(`Fyllde ${successLabel} men hittade inte Spara-knappen.`);
      return false;
    }

    realClick(saveButton);
    setStatus(`${successLabel} fylldes med ${value} och Spara klickades.`);
    return true;
  }

  function getDisplayValue(key) {
    return bridgeData && bridgeData.display ? bridgeData.display[key] : null;
  }

  function formatDisplayValue(value, decimals = 2) {
    return Number(value ?? 0).toLocaleString("sv-SE", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  async function openConfiguredRow(articleName, rowKey, label) {
    const row = ROW_CONFIGS[rowKey];
    return openRow(articleName, row.suffix, row.text, row.inputSelector, label || row.text);
  }

  async function fillConfiguredValue(options) {
    const {
      articleName,
      rowKey,
      displayKey,
      missingValueText,
      infoLabel,
      successLabel,
      decimals = 2,
      isValueAllowed = () => true,
      invalidValueText = "Värdet från Debiteringsapp kunde inte användas."
    } = options;

    if (!await ensureBridgeData()) return false;

    const displayValue = getDisplayValue(displayKey);
    if (typeof displayValue !== "number") {
      setStatus(missingValueText);
      return false;
    }
    if (!isValueAllowed(displayValue)) {
      setStatus(invalidValueText);
      return false;
    }

    const opened = await openConfiguredRow(articleName, rowKey, successLabel);
    if (!opened) return false;

    return fillOpenDialog(
      ROW_CONFIGS[rowKey].inputSelector,
      formatDisplayValue(displayValue, decimals),
      infoLabel,
      successLabel
    );
  }

  async function fillFastLon() {
    return fillConfiguredValue({
      articleName: ARTICLE_NORMAL,
      rowKey: "fastLon",
      displayKey: "salaryPrice",
      missingValueText: "Kunde inte hämta värdet för Fast lön från Debiteringsapp.",
      infoLabel: "Fast lön från appen",
      successLabel: TEXT_FAST_LON
    });
  }

  async function fillPercentLon() {
    return fillConfiguredValue({
      articleName: ARTICLE_NORMAL,
      rowKey: "percentLon",
      displayKey: "salaryFactorPercent",
      missingValueText: "Kunde inte hämta värdet för % av lön från Debiteringsapp.",
      infoLabel: "% av lön från appen",
      successLabel: TEXT_PERCENT_LON
    });
  }

  async function fillAtfFastPris() {
    return fillConfiguredValue({
      articleName: ARTICLE_ATF,
      rowKey: "fastPris",
      displayKey: "atfPrice",
      missingValueText: "Kunde inte hämta värdet för ATF från Debiteringsapp.",
      infoLabel: "ATF från appen",
      successLabel: "ATF Fast pris"
    });
  }

  async function fillSatFastPris() {
    return fillConfiguredValue({
      articleName: ARTICLE_SAT,
      rowKey: "fastPris",
      displayKey: "satPrice",
      missingValueText: "Kunde inte hämta värdet för SAT-tid från Debiteringsapp.",
      infoLabel: "SAT-tid från appen",
      successLabel: "SAT-tid Fast pris",
      isValueAllowed: (value) => value > 0,
      invalidValueText: "SAT-tid är inte aktiverat i appen eller har värdet 0,00."
    });
  }

  async function fillShiftFastLon() {
    return fillConfiguredValue({
      articleName: ARTICLE_SHIFT,
      rowKey: "fastLon",
      displayKey: "shiftPrice",
      missingValueText: "Kunde inte hämta värdet för Skiftformstillägg Fast lön från Debiteringsapp.",
      infoLabel: "Skiftformstillägg Fast lön från appen",
      successLabel: "Skiftformstillägg Fast lön"
    });
  }

  async function fillShiftPercentLon() {
    return fillConfiguredValue({
      articleName: ARTICLE_SHIFT,
      rowKey: "percentLon",
      displayKey: "shiftFactorPercent",
      missingValueText: "Kunde inte hämta värdet för Skiftformstillägg % av lön från Debiteringsapp.",
      infoLabel: "Skiftformstillägg % av lön från appen",
      successLabel: "Skiftformstillägg % av lön"
    });
  }

  async function fillNormalTid() {
    setStatus("Fyller Normal tid...");
    const opened = await openArticle(ARTICLE_NORMAL);
    if (!opened) return;
    if (!await fillFastLon()) return;
    await sleep(350);
    await fillPercentLon();
  }

  async function fillAtf() {
    setStatus("Fyller ATF...");
    const opened = await openArticle(ARTICLE_ATF);
    if (!opened) return;
    await fillAtfFastPris();
  }

  async function fillSatTid() {
    setStatus("Fyller SAT-tid...");
    const opened = await openArticle(ARTICLE_SAT);
    if (!opened) return;
    await fillSatFastPris();
  }

  async function fillSkiftformstillagg() {
    setStatus("Fyller Skiftformstillägg...");
    const opened = await openArticle(ARTICLE_SHIFT);
    if (!opened) return;
    if (!await fillShiftFastLon()) return;
    await sleep(350);
    await fillShiftPercentLon();
  }

  async function fillAllaTre() {
    setStatus("Fyller alla...");
    await fillNormalTid();
    await sleep(500);
    await fillAtf();
    await sleep(500);
    if (isSatEnabled()) {
      await fillSatTid();
      await sleep(500);
    }
    if (hasShiftValue()) {
      await fillSkiftformstillagg();
    }
  }

  async function copyUnderlag() {
    if (!await ensureBridgeData()) return;

    const text = getCopyUnderlagText();
    if (!text) {
      setStatus("Ingen data finns att kopiera.");
      return;
    }

    try {
      await copyTextToClipboard(text);
      setStatus("Underlaget kopierades.");
    } catch (_error) {
      setStatus("Kunde inte kopiera underlaget.");
    }
  }

  function createPanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.id = PANEL_ID;
    wrapper.innerHTML = `
      <div class="head">
        <div class="head-main">
          <div class="title">Debiteringsapp + IntelliPlan</div>
          <div class="sub">Version ${SCRIPT_VERSION}</div>
        </div>
        <div class="head-actions">
          <button class="icon-button button-refresh-compact" type="button" title="Uppdatera värden" aria-label="Uppdatera värden">↻</button>
          <button class="toggle" type="button" title="Minimera panel" aria-label="Minimera panel">−</button>
        </div>
      </div>
      <div class="body">
        <div class="status">Scriptet är laddat.</div>
        <button class="button secondary button-copy" type="button">Kopiera underlag</button>
        <button class="button button-fill-all" type="button">Fyll alla</button>
        <button class="button button-fill-normal" type="button">Fyll Normal tid</button>
        <button class="button button-fill-atf" type="button">Fyll ATF</button>
        <button class="button button-fill-sat" type="button">Fyll SAT-tid</button>
        <button class="button button-fill-shift" type="button">Fyll Skiftformstillägg</button>
        <div class="data">Ingen data hämtad ännu.</div>
      </div>
    `;

    document.body.appendChild(wrapper);
    enableDragging(wrapper);
    wrapper.querySelector(".toggle").addEventListener("click", togglePanel);
    wrapper.querySelector(".button-refresh-compact").addEventListener("click", handleManualRefresh);
    wrapper.querySelector(".button-copy").addEventListener("click", copyUnderlag);
    wrapper.querySelector(".button-fill-all").addEventListener("click", fillAllaTre);
    wrapper.querySelector(".button-fill-normal").addEventListener("click", fillNormalTid);
    wrapper.querySelector(".button-fill-atf").addEventListener("click", fillAtf);
    wrapper.querySelector(".button-fill-sat").addEventListener("click", fillSatTid);
    wrapper.querySelector(".button-fill-shift").addEventListener("click", fillSkiftformstillagg);

    updateToggleButton();
    updateDataPanel();
    updateSatButtonVisibility();
    updateShiftButtonVisibility();
    applyPanelPosition();
  }

  function startAutoRefresh() {
    if (autoRefreshTimerId) {
      window.clearInterval(autoRefreshTimerId);
    }

    autoRefreshTimerId = window.setInterval(() => {
      autoRefreshBridgeData().catch(() => {});
    }, AUTO_REFRESH_INTERVAL_MS);
  }

  function init() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }
    injectStyles();
    createPanel();
    window.addEventListener("resize", applyPanelPosition);
    autoRefreshBridgeData().catch(() => {});
    startAutoRefresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
