/*
 * MarketScope fixture collector -- DevTools console helper.
 *
 * WHAT IT DOES
 *   Reads the listing cards already rendered on the page you are looking at,
 *   finds each card's root element, and downloads their outerHTML as cards.json.
 *   It does NOT scroll, paginate, navigate, or fetch anything. It only reads
 *   what your own browsing already put on screen.
 *
 * HOW TO USE
 *   1. Browse Marketplace normally. Scroll by hand until the page shows the
 *      kind of cards you want (sponsored, free, no image, long titles, ...).
 *   2. Open DevTools -> Console.
 *   3. Paste this whole file, press Enter.
 *   4. It reports what it found and downloads cards.json.
 *   5. Repeat on other pages; rename each download (cards-1.json, ...).
 *   6. Run the sanitizer over them:
 *        python tools/marketscope-fixtures/sanitize_fixtures.py sanitize \
 *          --from-json cards.json -o tests/fixtures/marketplace
 *
 * CARD ROOT HEURISTIC
 *   Start at the a[href*="/marketplace/item/"] anchor and climb while the
 *   PARENT still contains exactly one item link. That stops one level before
 *   the container that would swallow a sibling card -- i.e. the same element
 *   you would pick by eye in the Elements panel.
 *
 * NOTE: cards.json is raw, unsanitized page markup. Treat it as sensitive,
 * keep it out of the repo, and delete it once fixtures are generated.
 */

(() => {
  const SEL = 'a[href*="/marketplace/item/"]';
  const anchors = Array.from(document.querySelectorAll(SEL));

  if (!anchors.length) {
    console.warn("No Marketplace item links on this page. Are you on a results or feed page?");
    return;
  }

  const countLinks = (el) => el.querySelectorAll(SEL).length;

  const roots = [];
  const seen = new Set();

  for (const a of anchors) {
    let el = a;
    while (el.parentElement && countLinks(el.parentElement) === 1) {
      el = el.parentElement;
    }
    if (seen.has(el)) continue;
    seen.add(el);
    roots.push(el);
  }

  // Label each card by the traits it exhibits, so filenames are meaningful
  // and you can see at a glance which coverage buckets you still need.
  const labelFor = (el) => {
    const text = (el.innerText || "").trim();
    const tags = [];
    if (/sponsored/i.test(text)) tags.push("sponsored");
    if (/shipping/i.test(text)) tags.push("shipping");
    if (/^\s*free\s*$/im.test(text)) tags.push("free");
    if (!/[$£€¥]\s?\d/.test(text)) tags.push("no-price");
    if (!el.querySelector("img")) tags.push("no-image");
    if (countLinks(el) === 0) tags.push("malformed");
    if (/[^\x00-\x7F]/.test(text)) tags.push("non-ascii");
    const firstLine = text.split("\n").find((l) => l.trim().length > 12) || "";
    if (firstLine.length > 80) tags.push("long-title");
    return tags.length ? tags.join("-") : "normal";
  };

  const cards = roots.map((el, i) => ({
    index: i + 1,
    label: labelFor(el),
    html: el.outerHTML,
  }));

  const tally = {};
  for (const c of cards) tally[c.label] = (tally[c.label] || 0) + 1;

  console.log(`Collected ${cards.length} card(s) from ${location.pathname}`);
  console.table(
    Object.entries(tally).map(([label, count]) => ({ label, count }))
  );

  const payload = {
    collectedAt: new Date().toISOString(),
    path: location.pathname,
    count: cards.length,
    cards,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cards.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  console.log("Downloaded cards.json -- now run sanitize_fixtures.py over it.");
  window.__marketscopeCards = payload; // also available for copy(window.__marketscopeCards)
})();
