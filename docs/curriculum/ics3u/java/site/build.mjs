import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { renderVisual } from './visuals.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assetVersion = file => createHash('sha256').update(readFileSync(join(here, file))).digest('hex').slice(0, 12);
const lesson = readFileSync(join(here, '../01-java-explained.md'), 'utf8');
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = text => escape(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
const parts = lesson.trim().split(/^## /m).slice(1);
if (!parts.length) throw new Error('The lesson needs headings starting with ##.');

function renderBody(source) {
  const lines = source.trim().split('\n');
  const output = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const kind = line.slice(3).trim();
      const block = [];
      while (++i < lines.length && lines[i] !== '```') block.push(lines[i]);
      if (i >= lines.length) throw new Error('Unclosed Markdown code fence.');
      if (kind === 'flow') {
        output.push('<ol class="pipeline" aria-label="Java compilation and execution">' + block.map((row, index) => {
          const columns = row.split('|').map(value => value.trim());
          if (columns.length !== 3) throw new Error('Flow rows need three columns.');
          return `<li><span class="step">0${index + 1}</span><strong>${inline(columns[0])}</strong><code>${inline(columns[1])}</code><span>${inline(columns[2])}</span></li>`;
        }).join('') + '</ol>');
      } else if (kind === 'platforms') {
        output.push('<ul class="platforms" aria-label="Compatible virtual machines">' + block.map(row => {
          const columns = row.split('|').map(value => value.trim());
          if (columns.length !== 2) throw new Error('Platform rows need two columns.');
          return `<li><strong>${inline(columns[0])}</strong><span>${inline(columns[1])}</span></li>`;
        }).join('') + '</ul>');
      } else {
        output.push(`<pre aria-label="${escape(kind || 'Text')} example"><code>${escape(block.join('\n'))}</code></pre>`);
      }
    } else if (line.startsWith('- ')) {
      const rows = [line.slice(2)];
      while (i + 1 < lines.length && lines[i + 1].startsWith('- ')) rows.push(lines[++i].slice(2));
      output.push('<ul class="questions">' + rows.map(row => `<li>${inline(row)}</li>`).join('') + '</ul>');
    } else if (line.startsWith('> ')) {
      output.push(`<aside class="prompt">${inline(line.slice(2))}</aside>`);
    } else {
      const paragraph = [line];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(?:```|- |> )/.test(lines[i + 1])) paragraph.push(lines[++i]);
      output.push(`<p>${inline(paragraph.join(' '))}</p>`);
    }
  }
  return output.join('\n');
}

const sections = parts.map((part, index) => {
  const newline = part.indexOf('\n');
  const title = part.slice(0, newline).trim();
  const level = index === 0 ? 1 : 2;
  const visual = part.match(/```visual\n([a-z-]+)\n```/);
  const body = part.slice(newline + 1).replace(/```visual\n[a-z-]+\n```/, '');
  return `<section class="lesson-section${index === 0 ? ' opener' : ''}" id="section-${index + 1}" aria-labelledby="heading-${index + 1}"><div class="read-heading"><div class="section-label">${index === 0 ? 'ICS3U / 1.1' : 'Java explained / ' + String(index + 1).padStart(2, '0')}</div><h${level} id="heading-${index + 1}">${inline(title)}</h${level}></div>${visual ? renderVisual(visual[1]) : ''}<div class="read-detail">${renderBody(body)}</div></section>`;
}).join('\n');

// Lucide icon geometry, lucide-react 0.562.0 (ISC license).
const icon = (name, nodes, extra = '') => `<svg ${extra} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon icon-${name}">${nodes}</svg>`;
const maximize = icon('maximize', '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>');
const minimize = icon('minimize', '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>', 'hidden');
const printer = icon('printer', '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>');
const ellipsis = icon('ellipsis', '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>');
const book = icon('book-open', '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>');
const slides = icon('presentation', '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="A concise ICS3U introduction to programming, syntax, and how Java runs."><title>Java explained · ICS3U</title><link rel="stylesheet" href="theme.css?v=${assetVersion('theme.css')}"><script src="presentation.js?v=${assetVersion('presentation.js')}" defer></script></head>
<body><a class="skip" href="#lesson">Skip to lesson</a>
<div class="reading-layout"><main id="lesson">${sections}<div class="references"><p>Further reading</p><a href="https://codehs.com/documentation/new/java-main">CodeHS Java documentation</a><a href="https://dev.java/learn/jvm/tools/core/javac/">Java compiler documentation</a></div></main></div>
<footer class="viewer-footer" aria-label="Lesson controls"><div class="footer-inner"><span id="progress" role="status" aria-live="polite" aria-label="Page"></span><div class="view-toggle" role="group" aria-label="Lesson view"><button id="reading" class="icon-button" type="button" aria-label="Read" aria-pressed="true" title="Read">${book}</button><button id="present" class="icon-button" type="button" aria-label="Present" aria-pressed="false" title="Present. Arrow keys to move, Escape to read.">${slides}</button></div><div class="footer-actions"><button id="fullscreen" class="icon-button" type="button" aria-label="Enter fullscreen" title="Enter fullscreen">${maximize}${minimize}</button><details id="options" class="options"><summary class="icon-button" aria-label="More options" title="More options">${ellipsis}</summary><div class="options-panel"><p>Appearance</p><div class="theme-toggle" role="group" aria-label="Appearance"><button type="button" data-theme-choice="light" aria-pressed="true">Light</button><button type="button" data-theme-choice="dark" aria-pressed="false">Dark</button></div><button id="print" class="menu-action" type="button">${printer}<span>Print lesson</span></button><a id="notes" href="?notes=1" target="java-notes" class="notes-button">Open presenter’s notes</a><a href="lesson.md" download>Download Markdown</a></div></details></div></div></footer></body></html>`;

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist/index.html'), html);
writeFileSync(join(here, 'dist/lesson.md'), lesson.replace(/```visual\n[a-z-]+\n```\n/g, ''));
for (const file of ['theme.css', 'presentation.js', 'lucide-license.txt']) copyFileSync(join(here, file), join(here, 'dist', file));
console.log(`Built ${parts.length} sections from the Markdown lesson.`);
