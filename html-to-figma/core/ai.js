/*
 * H2F core — ai.js
 * Image (screenshot / mockup) → grid-aligned, flexbox HTML using Claude's vision,
 * which then flows through the normal HTML → Figma pipeline.
 *
 * Runs in the browser with the user's own Anthropic API key (never sent anywhere
 * except api.anthropic.com). This uses a raw fetch because the plugin UI and the
 * website are single-file, bundler-free pages; it mirrors the Messages API exactly.
 */
(function (root) {
  const H2F = (root.H2F = root.H2F || {});

  const DEFAULT_MODEL = 'claude-opus-5-5';
  const MAX_EDGE = 1568; // vision models downscale beyond this anyway

  /** Downscale + re-encode an image (Blob/File or data URL) → { media_type, data(base64), width, height } */
  async function prepareImage(input) {
    const blob = typeof input === 'string' ? await (await fetch(input)).blob() : input;
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale),
      h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const dataUrl = c.toDataURL('image/png');
    let media_type = 'image/png',
      data = dataUrl.split(',')[1];
    if (data.length > 4.5e6) {
      media_type = 'image/jpeg';
      data = c.toDataURL('image/jpeg', 0.88).split(',')[1];
    }
    return { media_type, data, width: bmp.width, height: bmp.height };
  }

  function buildPrompt(opts) {
    const base = opts.base || 8;
    const half = base === 8 ? ' (4px is allowed for values under 16px)' : '';
    return `Rebuild this UI screenshot as a single, self-contained HTML document that will be imported into Figma as editable layers with auto layout.

Target screen: ${opts.width}px wide × ${opts.height}px tall. Lay it out for exactly that width.

Rules — follow all of them:
1. Layout: use flexbox for every container (display:flex + flex-direction + gap). Avoid floats, CSS grid templates and absolute positioning (only use position:absolute for genuinely overlapping things such as badges or overlays). Use gap for spacing between siblings instead of margins.
2. Spacing grid: every padding, gap, margin and border-radius value must be a multiple of ${base}px${half}. Pills may use border-radius:9999px.
3. Typography: font sizes from this scale only: 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64. Line heights must be multiples of 4px, written in px. If you recognise the typeface use it via a Google Fonts <link>; otherwise use Inter.
4. Components: elements that repeat (cards, list rows, nav items, buttons, inputs, chips) must use identical markup and identical class names so they are detected as components. Use real <button> and <input> elements for buttons and fields.
5. Naming: use meaningful class names (e.g. "pricing-card", "nav-item", "hero") and add data-name="…" to major sections — they become Figma layer names.
6. Content: copy all visible text exactly. Recreate icons as small inline <svg> elements. For photos/illustrations use a <div data-name="Image"> with the dominant colour as background and the correct size.
7. Colours: match the screenshot closely; define them once as CSS custom properties in :root and reuse them.
8. Output ONLY the HTML document, starting with <!doctype html>. No explanations, no markdown fences.`;
  }

  function extractHTML(text) {
    const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
    let html = fence ? fence[1] : text;
    const start = html.search(/<!doctype html|<html/i);
    if (start > 0) html = html.slice(start);
    return html.trim();
  }

  /**
   * @param {Blob|string} image  File/Blob or data URL
   * @param {{apiKey:string, width:number, height:number, base?:4|8, model?:string, notes?:string, signal?:AbortSignal}} opts
   * @returns {Promise<string>} HTML
   */
  async function imageToHTML(image, opts) {
    if (!opts.apiKey) throw new Error('An Anthropic API key is required for AI image conversion.');
    const img = await prepareImage(image);
    const prompt = buildPrompt(opts) + (opts.notes ? `\n\nExtra notes from the designer: ${opts.notes}` : '');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        // required for calling the API straight from a browser with a user-supplied key
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: opts.model || DEFAULT_MODEL,
        max_tokens: 16000,
        output_config: { effort: opts.effort || 'medium' },
        fallbacks: 'default',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (body.error && body.error.message) || res.statusText;
      if (res.status === 401) throw new Error('Invalid Anthropic API key.');
      if (res.status === 429) throw new Error('Rate limited by the Anthropic API — try again shortly.');
      throw new Error(`Anthropic API error ${res.status}: ${msg}`);
    }
    if (body.stop_reason === 'refusal') {
      throw new Error('The model declined this image' + (body.stop_details && body.stop_details.explanation ? ': ' + body.stop_details.explanation : '.'));
    }
    const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (!text) throw new Error('The model returned no HTML.');
    if (body.stop_reason === 'max_tokens') console.warn('[h2f] AI output hit max_tokens; HTML may be truncated.');
    return extractHTML(text);
  }

  H2F.ai = { imageToHTML, prepareImage, buildPrompt, extractHTML, DEFAULT_MODEL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
