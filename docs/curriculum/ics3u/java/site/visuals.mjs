// Lucide user-round/users-round geometry, covered by lucide-license.txt.
const roleIcons = {
  person: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  people: '<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>',
  // Locally drawn factory: a chimney, sawtooth roof, and workshop windows.
  factory: '<path d="M3 21V11l6 4v-4l6 4V3h4v18Z"/><path d="M6 18h1m3 0h1m3 0h1"/>',
  // Locally drawn game controller with a directional pad and two buttons.
  controller: '<path d="M7 7h10c2 0 3.3 1.2 3.8 3.2l1 5c.5 2.5-1.7 4.1-3.5 2.4L16 15H8l-2.3 2.6c-1.8 1.7-4 .1-3.5-2.4l1-5C3.7 8.2 5 7 7 7Z"/><path d="M7 10v4m-2-2h4"/><circle cx="16" cy="10.5" r=".7"/><circle cx="18.5" cy="12.5" r=".7"/>',
};
const roleSymbol = (x, y, symbol) => roleIcons[symbol]
  ? `<g transform="translate(${x - 40} ${y - 55}) scale(3.333)" fill="none" stroke="var(--blue)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><g class="diagram-role-icon">${roleIcons[symbol]}</g></g>`
  : text(x, y, symbol, 68, 'class="diagram-accent"');
const text = (x, y, label, size = 32, extra = '') => `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" data-size="${size}" ${extra}>${label}</text>`;
const box = (x, y, width, height, label, symbol) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" class="diagram-box"/>${symbol ? roleSymbol(x + width / 2, y + height / 2, symbol) : ''}${text(x + width / 2, y + height - 30, label, 30, label.length > 16 ? 'class="diagram-long-label"' : '')}`;
const arrow = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" class="diagram-arrow" marker-end="url(#arrow)"/>`;
const diagram = (label, content) => {
  const id = 'arrow-' + label.toLowerCase().replace(/[^a-z]+/g, '-');
  return `<div class="slide-visual" role="img" aria-label="${label.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"><svg viewBox="0 0 1200 560" aria-hidden="true"><defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10" fill="var(--blue)"/></marker></defs>${content.replaceAll('url(#arrow)', `url(#${id})`)}</svg></div>`;
};
const three = (labels, symbols) => box(30, 210, 300, 230, labels[0], symbols[0]) + arrow(360, 320, 420, 320) + box(450, 210, 300, 230, labels[1], symbols[1]) + arrow(780, 320, 840, 320) + box(870, 210, 300, 230, labels[2], symbols[2]);
export function renderVisual(type) {
  const title = label => text(600, 100, label, 64, 'font-weight="750"');
  const visuals = {
    intro: () => diagram('Java: source code becomes a running program.', title('Java') + box(110, 220, 390, 240, 'Source code', '&lt;/&gt;') + arrow(540, 340, 660, 340) + box(700, 220, 390, 240, 'Running program', '▶')),
    instructions: () => diagram('Programming: instructions are carried out by a computer to produce a result, such as an average.', title('Programming') + three(['Instructions', 'Computer', 'Result'], ['1 · 2 · 3', '&gt;_', '87%'])),
    roles: () => diagram('The programmer creates the program; the user interacts with it.', title('Who does what?') + box(30, 210, 300, 230, 'Programmer', 'person') + arrow(360, 340, 420, 340) + text(390, 285, 'creates', 26) + box(450, 210, 300, 230, 'Program', 'controller') + arrow(840, 340, 780, 340) + text(810, 285, 'uses', 26) + box(870, 210, 300, 230, 'User', 'people')),
    syntax: () => diagram('Java syntax example: System.out.println("Hello!");. Capitalization, quotes, and the semicolon matter.', title('Syntax') + `<rect x="70" y="205" width="1060" height="165" rx="22" class="diagram-box"/><text x="600" y="305" text-anchor="middle" font-size="50" font-family="ui-monospace,monospace"><tspan class="diagram-accent" font-weight="750">S</tspan><tspan>ystem.out.println(</tspan><tspan class="diagram-accent" font-weight="750">&quot;Hello!&quot;</tspan><tspan>)</tspan><tspan class="diagram-accent" font-weight="750">;</tspan></text>` + text(220, 440, 'Case', 30) + text(600, 440, 'Quotes', 30) + text(980, 440, 'Punctuation', 30)),
    editor: () => diagram('We write and run Java using the CodeHS online editor, and may also use Replit. The environment combines editor, run, and error tools.', title('CodeHS') + `<rect x="190" y="180" width="820" height="295" rx="22" class="diagram-box"/><path d="M190 245 H1010 M730 245 V475" class="diagram-divider"/>` + text(430, 350, '&lt;/&gt;', 84, 'class="diagram-accent"') + text(430, 430, 'Editor', 30) + text(865, 340, '▶', 68, 'class="diagram-accent"') + text(865, 430, 'Run · Errors', 30) + text(600, 535, 'Also: Replit', 26, 'class="diagram-muted"')),
    compiler: () => diagram('The compiler translates Java source code, a .java file, into bytecode, a .class file.', title('Compile') + three(['Source code', 'Compiler', 'Bytecode'], ['.java', 'factory', '.class'])),
    jvm: () => diagram('The Java Virtual Machine executes bytecode to run the program.', title('Run') + three(['Bytecode', 'Java Virtual Machine', 'Program'], ['.class', 'JVM', '▶'])),
    portable: () => diagram('One set of bytecode can run on Windows, macOS, or Linux when each has a compatible JVM.', box(440, 20, 320, 160, 'Bytecode', '.class') + `<path d="M600 190 V245 M220 245 H980" class="diagram-arrow"/>` + arrow(220, 245, 220, 285) + arrow(600, 245, 600, 285) + arrow(980, 245, 980, 285) + box(60, 310, 320, 200, 'Windows', 'JVM') + box(440, 310, 320, 200, 'macOS', 'JVM') + box(820, 310, 320, 200, 'Linux', 'JVM')),
    recall: () => diagram('Check your understanding: explain source code, compiler, and JVM. Can a program run successfully and still be wrong?', title('Explain the journey') + three(['Source code?', 'Compiler?', 'JVM?'], ['&lt;/&gt;', 'factory', '▶']) + text(600, 525, 'Runs ≠ correct?', 34, 'class="diagram-accent"')),
  };
  if (!visuals[type]) throw new Error(`Unknown presentation visual: ${type}`);
  const node = (symbol, label) => `<div class="mobile-node"><span>${roleIcons[symbol] ? `<svg class="role-icon" viewBox="0 0 24 24" aria-hidden="true">${roleIcons[symbol]}</svg>` : symbol}</span><strong>${label}</strong></div>`;
  const down = '<div class="mobile-arrow">↓</div>';
  const flow = (...nodes) => nodes.join(down);
  const mobile = {
    intro: ['Java', flow(node('&lt;/&gt;', 'Source code'), node('▶', 'Running program'))],
    instructions: ['Programming', flow(node('1 · 2 · 3', 'Instructions'), node('&gt;_', 'Computer'), node('87%', 'Result'))],
    roles: ['Who does what?', node('person', 'Programmer') + '<div class="mobile-arrow">↓ creates</div>' + node('controller', 'Program') + '<div class="mobile-arrow">↑ uses</div>' + node('people', 'User')],
    syntax: ['Syntax', '<div class="mobile-code"><code><b>S</b>ystem.out.println(<br><b>&quot;Hello!&quot;</b>)<b>;</b></code></div><div class="mobile-legend">Case · Quotes · Punctuation</div>'],
    editor: ['CodeHS', flow(node('&lt;/&gt;', 'Editor'), node('▶', 'Run · Errors')) + '<div class="mobile-legend">Also: Replit</div>'],
    compiler: ['Compile', flow(node('.java', 'Source code'), node('factory', 'Compiler'), node('.class', 'Bytecode'))],
    jvm: ['Run', flow(node('.class', 'Bytecode'), node('JVM', 'Java Virtual Machine'), node('▶', 'Program'))],
    portable: ['', node('.class', 'Bytecode') + down + '<div class="mobile-platforms">' + node('JVM', 'Windows') + node('JVM', 'macOS') + node('JVM', 'Linux') + '</div>'],
    recall: ['Explain the journey', flow(node('&lt;/&gt;', 'Source code?'), node('factory', 'Compiler?'), node('▶', 'JVM?')) + '<div class="mobile-legend">Runs ≠ correct?</div>'],
  }[type];
  return visuals[type]().replace('</svg></div>', `</svg><div class="mobile-visual" aria-hidden="true"><div class="visual-title">${mobile[0]}</div>${mobile[1]}</div></div>`);
}
