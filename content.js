(() => {
  function getVisibleText() {
    if (!document || !document.body) return "";
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
          const text = node.nodeValue.replace(/\s+/g, " ").trim();
          if (!text) return NodeFilter.FILTER_REJECT;
          // Skip script/style text or hidden elements
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const style =
            parent.ownerDocument.defaultView.getComputedStyle(parent);
          if (
            style &&
            (style.visibility === "hidden" || style.display === "none")
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    const parts = [];
    let n;
    while ((n = walker.nextNode())) {
      parts.push(n.nodeValue.replace(/\s+/g, " ").trim());
      if (parts.length > 5000) break;
    }
    return parts
      .join(" ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "GET_PAGE_TEXT") {
      try {
        const text = getVisibleText();
        sendResponse({ text });
      } catch (e) {
        sendResponse({ text: "" });
      }
      // return true to keep the message channel open for async sendResponse (not needed here)
      return true;
    }
  });
})();
