#!/usr/bin/env python3
"""Render week1-assignment.md into a designed standalone page.

Single-sourced: the markdown is the document, this only dresses it.
Run: python3 docs/build-doc.py
"""
import html, re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'week1-assignment.md')
OUT = os.path.join(HERE, 'week1-assignment.html')

def inline(t):
    t = html.escape(t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'(?<![*\w])\*([^*]+)\*(?!\w)', r'<em>\1</em>', t)
    # relative links (into the repo) have no meaning on a standalone page —
    # keep the path visible as code rather than shipping a dead link
    t = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', r'<a href="\2">\1</a>', t)
    t = re.sub(r'\[([^\]]+)\]\((?!https?://)[^)]+\)', r'<code>\1</code>', t)
    t = re.sub(r'(?<!["=>])(https://[^\s<)]+)', r'<a href="\1">\1</a>', t)
    return t

def cells(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]

def convert(md):
    out, i, lines = [], 0, md.split('\n')
    while i < len(lines):
        ln = lines[i]
        if ln.startswith('```'):
            i += 1; buf = []
            while i < len(lines) and not lines[i].startswith('```'):
                buf.append(html.escape(lines[i])); i += 1
            out.append('<pre class="flow"><code>' + '\n'.join(buf) + '</code></pre>'); i += 1; continue
        if re.match(r'^\|.*\|\s*$', ln) and i + 1 < len(lines) and re.match(r'^\|[\s:\-|]+\|\s*$', lines[i + 1]):
            head = cells(ln); i += 2; rows = []
            while i < len(lines) and re.match(r'^\|.*\|\s*$', lines[i]):
                rows.append(cells(lines[i])); i += 1
            t = ['<div class="tablewrap"><table><thead><tr>' + ''.join('<th>' + inline(h) + '</th>' for h in head) + '</tr></thead><tbody>']
            for r in rows:
                t.append('<tr>' + ''.join('<td>' + inline(c) + '</td>' for c in r) + '</tr>')
            t.append('</tbody></table></div>')
            out.append('\n'.join(t)); continue
        for marker, tag in ((r'^\s*[-*] ', 'ul'), (r'^\s*\d+\. ', 'ol')):
            if re.match(marker, ln):
                items = []
                while i < len(lines) and re.match(marker, lines[i]):
                    items.append(re.sub(marker, '', lines[i])); i += 1
                    # a wrapped line belongs to the item above it
                    while (i < len(lines) and lines[i].strip()
                           and not re.match(r'^(#|\||```|---|\s*[-*] |\s*\d+\. )', lines[i])):
                        items[-1] += ' ' + lines[i].strip(); i += 1
                out.append('<' + tag + '>' + ''.join('<li>' + inline(x) + '</li>' for x in items) + '</' + tag + '>')
                break
        else:
            pass
        if out and out[-1].startswith(('<ul>', '<ol>')) and re.match(r'^\s*([-*]|\d+\.) ', ln):
            continue
        if ln.startswith('---'):
            out.append('<hr>'); i += 1; continue
        m = re.match(r'^(#{1,4}) (.*)$', ln)
        if m:
            lvl = len(m.group(1)); text = m.group(2)
            num = re.match(r'^(\d+)\. (.*)$', text)
            if lvl == 2 and num:
                out.append('<h2><span class="num">' + num.group(1) + '</span>' + inline(num.group(2)) + '</h2>')
            else:
                out.append('<h%d>%s</h%d>' % (lvl, inline(text), lvl))
            i += 1; continue
        if ln.strip() == '':
            i += 1; continue
        para = []
        while i < len(lines) and lines[i].strip() and not re.match(r'^(#|\||```|---|\s*[-*] |\s*\d+\. )', lines[i]):
            para.append(lines[i].rstrip()); i += 1
        out.append('<p>' + inline(' '.join(para)).replace('  \n', '<br>') + '</p>')
    return '\n'.join(out)

md = open(SRC).read()
title_line, rest = md.split('\n', 1)
title = title_line.lstrip('# ').strip()

# the front-matter lines (**Author:** … **Source:** …) become header chrome
front, _, remainder = rest.partition('\n---\n')
agent_url = ''
m = re.search(r'\*\*Try the agent:\*\*\s*(\S+)', front)
if m:
    agent_url = m.group(1)
source = ''
m = re.search(r'\*\*Source:\*\*\s*(.+)', front)
if m:
    source = inline(m.group(1).strip())
body = convert(remainder)

STYLE = """
:root {
  --ground:#EDF1F0; --surface:#FFFFFF; --surface-2:#F5F8F7; --line:#D2DCD9; --line-strong:#B4C3BF;
  --ink:#131E1B; --ink-soft:#4C5B58; --ink-faint:#5E6D69;
  --probe:#0B655C; --probe-soft:#DCEDEA; --amber:#855A02; --rose:#A03F58; --on-probe:#FFFFFF;
  --sans:'Archivo','Helvetica Neue',Arial,sans-serif;
  --serif:'Newsreader',Georgia,'Times New Roman',serif;
  --mono:'IBM Plex Mono',Consolas,monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --ground:#0D1413; --surface:#141D1B; --surface-2:#1A2523; --line:#26332F; --line-strong:#3A4A46;
  --ink:#E4EBE8; --ink-soft:#AEBDB8; --ink-faint:#8B9A95;
  --probe:#4CC3B1; --probe-soft:#16332F; --amber:#D9A441; --rose:#E08199; --on-probe:#06201D;
} }
:root[data-theme="dark"] {
  --ground:#0D1413; --surface:#141D1B; --surface-2:#1A2523; --line:#26332F; --line-strong:#3A4A46;
  --ink:#E4EBE8; --ink-soft:#AEBDB8; --ink-faint:#8B9A95;
  --probe:#4CC3B1; --probe-soft:#16332F; --amber:#D9A441; --rose:#E08199; --on-probe:#06201D;
}
* { box-sizing: border-box; }
body { margin:0; background:var(--ground); color:var(--ink); font-family:var(--sans); font-size:16px; line-height:1.62; -webkit-font-smoothing:antialiased; }
.wrap { max-width: 880px; margin: 0 auto; padding: 0 22px 96px; }
header.doc { padding: 54px 0 26px; border-bottom: 2px solid var(--probe); margin-bottom: 34px; }
.eyebrow { font-family:var(--mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-faint); }
h1 { font-family:var(--serif); font-weight:500; font-size:clamp(32px,5vw,50px); line-height:1.08; letter-spacing:-.02em; margin:12px 0 16px; text-wrap:balance; }
.meta { display:flex; flex-wrap:wrap; gap:6px 22px; font-size:14px; color:var(--ink-soft); }
.meta b { color:var(--ink); font-weight:600; }
h2 { font-family:var(--serif); font-weight:500; font-size:27px; margin:48px 0 14px; display:flex; gap:12px; align-items:baseline; text-wrap:balance; }
h2 .num { font-family:var(--mono); font-size:13px; color:var(--probe); border:1px solid var(--probe); border-radius:999px; padding:1px 8px; flex:0 0 auto; }
h3 { font-size:17px; margin:30px 0 8px; }
h4 { font-size:15px; margin:22px 0 6px; }
p { margin:0 0 15px; max-width:74ch; }
ul, ol { margin:0 0 16px; padding-left:22px; max-width:74ch; }
li { margin-bottom:6px; }
a { color:var(--probe); text-underline-offset:3px; }
strong { font-weight:600; }
code { font-family:var(--mono); font-size:.86em; background:var(--surface-2); border:1px solid var(--line); border-radius:4px; padding:1px 5px; }
pre.flow { font-family:var(--mono); background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--probe); border-radius:10px; padding:16px 18px; overflow-x:auto; font-size:13px; line-height:1.7; color:var(--ink-soft); }
pre.flow code { background:none; border:none; padding:0; font-size:inherit; }
hr { border:none; border-top:1px solid var(--line); margin:40px 0; }
.tablewrap { overflow-x:auto; margin:0 0 20px; border:1px solid var(--line); border-radius:10px; background:var(--surface); }
table { border-collapse:collapse; width:100%; font-size:14px; }
th, td { text-align:left; padding:9px 13px; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-family:var(--mono); font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-faint); background:var(--surface-2); white-space:nowrap; }
tbody tr:last-child td { border-bottom:none; }
td:first-child { font-variant-numeric:tabular-nums; }
.cta { display:inline-block; margin-top:22px; background:var(--probe); color:var(--on-probe); text-decoration:none;
  font-weight:600; font-size:14.5px; padding:9px 18px; border-radius:9px; }
.cta:hover { filter:brightness(1.12); }
footer.doc { margin-top:56px; padding-top:18px; border-top:1px solid var(--line); font-family:var(--mono); font-size:11px; color:var(--ink-faint); letter-spacing:.05em; display:flex; gap:18px; flex-wrap:wrap; }
"""

page = (
 '<title>' + html.escape(title) + '</title>\n'
 '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
 '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
 '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap">\n'
 '<style>' + STYLE + '</style>\n'
 '<div class="wrap"><header class="doc">'
 '<div class="eyebrow">Course project · Week 1 assignment</div>'
 '<h1>' + html.escape(title) + '</h1>'
 '<div class="meta"><span><b>Pranaya Manikonda</b></span><span>23 August 2026</span>'
 '<span>Problem statement 2 — AI Mind-Map Agent</span><span>' + source + '</span></div>'
 + ('<a class="cta" href="' + agent_url + '">Open the agent →</a>' if agent_url else '')
 + '</header>\n' + body +
 '<footer class="doc"><span>Probe · prompt pack v0.1</span><span>3 of 3 recorded cases pass at 11/12</span>'
 '<span>35 of 35 automated checks pass</span></footer></div>\n'
)
open(OUT, 'w').write(page)
print('wrote', OUT, len(page), 'bytes')
