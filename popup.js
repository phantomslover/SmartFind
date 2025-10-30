const res = document.getElementById("result");
const input = document.getElementById("input");
const button = document.getElementById("button");

let hfPipeline = null;
async function loadTransformers() {
  if (hfPipeline) return hfPipeline;
  try {
    const mod = await import(
      /* webpackIgnore: true */ chrome.runtime.getURL(
        "vendor/transformers.min.js"
      )
    );
    hfPipeline = mod.pipeline;
    return hfPipeline;
  } catch (_e) {
    return null;
  }
}

function summarizeAnswer(question, answer) {
  const text = (answer || "").trim();
  if (!text) return "";
  if (text.length <= 180) return text; // already short

  const normalize = (s) => s.toLowerCase();
  const words = (str) =>
    (str.match(/[a-z0-9']+/gi) || []).map((w) => w.toLowerCase());
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "for",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "it",
    "its",
    "that",
    "this",
    "these",
    "those",
    "with",
    "as",
    "by",
    "at",
    "from",
    "but",
    "if",
    "then",
    "so",
    "than",
    "too",
    "very",
    "can",
    "could",
    "would",
    "should",
    "may",
    "might",
    "will",
    "just",
    "we",
    "you",
    "they",
    "he",
    "she",
    "i",
    "them",
    "him",
    "her",
    "our",
    "your",
    "their",
  ]);

  const qTokens = words(question || "").filter((w) => !stop.has(w));
  const qSet = new Set(qTokens);

  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 2) return text;

  // Compute term frequencies for the whole answer (to downweight very common words)
  const allTokens = words(normalize(text)).filter((w) => !stop.has(w));
  const tf = new Map();
  for (const w of allTokens) tf.set(w, (tf.get(w) || 0) + 1);
  const maxTf = Math.max(1, ...tf.values());

  function sentenceScore(s) {
    const toks = words(normalize(s)).filter((w) => !stop.has(w));
    if (toks.length === 0) return 0;
    const set = new Set(toks);
    const overlap = qTokens.reduce((acc, w) => acc + (set.has(w) ? 1 : 0), 0);
    const rarity =
      toks.reduce((acc, w) => acc + (1 - (tf.get(w) || 0) / maxTf), 0) /
      toks.length;
    const lengthPenalty = Math.min(toks.length / 30, 1); // prefer reasonably long sentences
    return overlap * 1.5 + rarity * 1.0 + lengthPenalty * 0.5;
  }

  const ranked = sentences
    .map((s, idx) => ({ s, idx, score: sentenceScore(s) }))
    .sort((a, b) => b.score - a.score);

  // Select top sentences with redundancy control
  const selected = [];
  const selectedSets = [];
  function jaccard(aSet, bSet) {
    let inter = 0;
    for (const w of aSet) if (bSet.has(w)) inter++;
    const union = aSet.size + bSet.size - inter;
    return union === 0 ? 0 : inter / union;
  }
  for (const r of ranked) {
    const set = new Set(words(normalize(r.s)).filter((w) => !stop.has(w)));
    let similar = false;
    for (const other of selectedSets) {
      if (jaccard(set, other) >= 0.7) {
        similar = true;
        break;
      }
    }
    if (similar) continue;
    selected.push(r);
    selectedSets.push(set);
    if (selected.length >= 3) break;
  }

  // Keep original order for readability
  selected.sort((a, b) => a.idx - b.idx);
  let summary = selected.map((x) => x.s).join(" ");
  if (summary.length > 300) {
    summary = summary.slice(0, 300);
    const cut = summary.lastIndexOf(".");
    if (cut > 120) summary = summary.slice(0, cut + 1);
  }
  return summary;
}

function answerFromContext(question, context) {
  const q = question.trim();
  if (!q) return "Please enter a question.";
  if (!context) return "No page text available.";

  const normalize = (s) => s.toLowerCase();
  const words = (str) =>
    (str.match(/[a-z0-9']+/gi) || []).map((w) => w.toLowerCase());
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "for",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "it",
    "its",
    "that",
    "this",
    "these",
    "those",
    "with",
    "as",
    "by",
    "at",
    "from",
    "but",
    "if",
    "then",
    "so",
    "than",
    "too",
    "very",
    "can",
    "could",
    "would",
    "should",
    "may",
    "might",
    "will",
    "just",
    "we",
    "you",
    "they",
    "he",
    "she",
    "i",
    "them",
    "him",
    "her",
    "our",
    "your",
    "their",
  ]);

  const qTokens = words(q).filter((w) => !stop.has(w));
  if (qTokens.length === 0)
    return "Please include some meaningful keywords in your question.";
  const qSet = new Set(qTokens);

  const sentences = context
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return "No readable text found on this page.";

  const sentenceData = sentences.map((s, idx) => {
    const t = normalize(s);
    const toks = words(t).filter((w) => !stop.has(w));
    const set = new Set(toks);
    const overlap = qTokens.reduce((acc, w) => acc + (set.has(w) ? 1 : 0), 0);
    const lengthBonus = Math.min(toks.length / 25, 0.6);
    return { idx, text: s, overlap, score: overlap + lengthBonus };
  });

  sentenceData.sort((a, b) => b.score - a.score);
  const windows = [];
  const taken = new Set();
  for (const s of sentenceData.slice(0, 40)) {
    if (s.overlap === 0) continue;
    if (taken.has(s.idx)) continue;
    const start = Math.max(0, s.idx - 1);
    const end = Math.min(sentences.length - 1, s.idx + 1);
    for (let i = start; i <= end; i++) taken.add(i);
    const winText = sentences.slice(start, end + 1).join(" ");
    let winScore = 0;
    for (let i = start; i <= end; i++) {
      const sd = sentenceData[i] || { score: 0 };
      const dist = Math.abs(i - s.idx);
      const weight = dist === 0 ? 1 : 0.6;
      winScore += sd.score * weight;
    }
    windows.push({ start, end, text: winText, score: winScore });
    if (windows.length >= 6) break;
  }

  if (windows.length === 0) {
    return `I couldn't find anything clearly related to "${question}" on this page.`;
  }

  windows.sort((a, b) => b.score - a.score);

  const selected = [];
  const usedSentences = new Set();
  for (const w of windows) {
    const range = sentences.slice(w.start, w.end + 1);
    const ranked = range
      .map((s) => {
        const toks = words(normalize(s)).filter((w) => !stop.has(w));
        const set = new Set(toks);
        const overlap = qTokens.reduce(
          (acc, w) => acc + (set.has(w) ? 1 : 0),
          0
        );
        return { s, overlap };
      })
      .sort((a, b) => b.overlap - a.overlap);

    for (const r of ranked) {
      if (r.overlap === 0) continue;
      if (usedSentences.has(r.s)) continue;
      selected.push(r.s);
      usedSentences.add(r.s);
      if (selected.length >= 5) break;
    }
    if (selected.length >= 5) break;
  }

  if (selected.length === 0) {
    return `I couldn't find anything clearly related to "${question}" on this page.`;
  }

  // De-duplicate and cap answer length
  const unique = Array.from(new Set(selected));
  let answer = unique.join(" ");
  const MAX_CHARS = 600;
  if (answer.length > MAX_CHARS) {
    // Try to keep early most-relevant content
    answer = answer.slice(0, MAX_CHARS);
    // cut to last sentence boundary
    const cut = answer.lastIndexOf(".");
    if (cut > 200) answer = answer.slice(0, cut + 1);
  }
  return answer;
}

async function getActiveTabText() {
  function toPlainText(value) {
    if (!value) return "";
    return String(value).trim();
  }

  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs && tabs[0];
      const tabId = tab && tab.id;
      if (!tabId) return resolve("");

      let resolved = false;
      const safeResolve = (val) => {
        if (resolved) return;
        resolved = true;
        resolve(toPlainText(val));
      };

      try {
        chrome.tabs.sendMessage(
          tabId,
          { type: "GET_PAGE_TEXT" },
          async (response) => {
            if (chrome.runtime.lastError) {
              // No listener or restricted page; fall back to best-effort injection where allowed
              try {
                if (chrome.scripting && tab && tab.id) {
                  const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () =>
                      document && document.body ? document.body.innerText : "",
                  });
                  const injectedText =
                    (results && results[0] && results[0].result) || "";
                  safeResolve(injectedText);
                } else {
                  safeResolve("");
                }
              } catch (_e) {
                safeResolve("");
              }
            } else {
              safeResolve((response && response.text) || "");
            }
          }
        );
      } catch (_err) {
        safeResolve("");
      }

      // Safety timeout to avoid hanging forever
      setTimeout(() => safeResolve(""), 1500);
    });
  });
}

async function tryAiQa(question, context, signal) {
  try {
    const pipeline = await loadTransformers();
    if (!pipeline) return null;
    const MAX_CTX_CHARS = 10000;
    const ctx = context.slice(0, MAX_CTX_CHARS);
    const qa = await pipeline(
      "question-answering",
      "Xenova/distilbert-base-cased-distilled-squad"
    );
    const out = await qa(question, ctx, { signal });
    if (!out) return null;
    if (typeof out.answer === "string" && out.answer.trim()) {
      return out.answer.trim();
    }
    return null;
  } catch (_e) {
    return null;
  }
}

button.addEventListener("click", async () => {
  res.textContent = "Searching...";
  const question = input.value || "";
  const context = await getActiveTabText();
  // Try AI first with timeout, then fall back to extractive
  let answer = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    answer = await tryAiQa(question, context, controller.signal);
    clearTimeout(timeout);
  } catch (_e) {
    // ignore and fall back
  }
  if (!answer) {
    answer = answerFromContext(question, context);
  }
  const summary = summarizeAnswer(question, answer || "");
  res.textContent =
    (answer || "No relevant text found.") +
    (summary ? "\n\nSummary: " + summary : "");
});
