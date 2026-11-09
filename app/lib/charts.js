const PALETTE = ['#6f8fb3', '#d93f3f', '#3fa96a', '#d9a33f', '#9b6fd9', '#4fb3c4'];

function escape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function niceMax(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) * magnitude;
}

function legend(series) {
  return `<ul class="legend">${series
    .map((s) => `<li><span class="swatch" style="background:${s.color}"></span>${escape(s.name)}</li>`)
    .join('')}</ul>`;
}

function barChart({ title, groups, series, format = (v) => v.toFixed(0), unit = '', height = 300 }) {
  const width = 920;
  const margin = { top: 18, right: 12, bottom: 54, left: 70 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const values = groups.flatMap((g) => series.map((s) => g.bars[s.name]).filter(Boolean).map((b) => Math.max(b.value, b.max ?? b.value)));
  const yMax = niceMax(Math.max(0, ...values) * 1.08);
  const y = (v) => margin.top + plotH - (v / yMax) * plotH;
  const groupW = plotW / Math.max(groups.length, 1);
  const barW = Math.min(30, (groupW * 0.78) / Math.max(series.length, 1));
  const parts = [];

  for (let i = 0; i <= 5; i += 1) {
    const v = (yMax / 5) * i;
    parts.push(`<line class="grid" x1="${margin.left}" x2="${width - margin.right}" y1="${y(v)}" y2="${y(v)}"/>`);
    parts.push(`<text class="tick" x="${margin.left - 8}" y="${y(v) + 4}" text-anchor="end">${escape(format(v))}</text>`);
  }
  if (unit) parts.push(`<text class="axis" x="14" y="${margin.top + plotH / 2}" transform="rotate(-90 14 ${margin.top + plotH / 2})" text-anchor="middle">${escape(unit)}</text>`);

  groups.forEach((g, gi) => {
    const center = margin.left + groupW * gi + groupW / 2;
    const startX = center - (barW * series.length) / 2;
    series.forEach((s, si) => {
      const bar = g.bars[s.name];
      if (!bar) return;
      const x = startX + barW * si;
      const top = y(bar.value);
      const tip = `${s.name} · ${g.name}${g.sub ? ` · ${g.sub}` : ''}: ${format(bar.value)}${unit ? ` ${unit}` : ''}`
        + (bar.min != null && bar.max !== bar.min ? ` (range ${format(bar.min)}–${format(bar.max)})` : '');
      parts.push(`<rect x="${x + 1}" y="${top}" width="${barW - 2}" height="${margin.top + plotH - top}" rx="2" fill="${s.color}"><title>${escape(tip)}</title></rect>`);
      if (bar.min != null && bar.max != null && bar.max !== bar.min) {
        const cx = x + barW / 2;
        parts.push(`<line class="whisker" x1="${cx}" x2="${cx}" y1="${y(bar.min)}" y2="${y(bar.max)}"/>`);
        parts.push(`<line class="whisker" x1="${cx - 4}" x2="${cx + 4}" y1="${y(bar.max)}" y2="${y(bar.max)}"/>`);
        parts.push(`<line class="whisker" x1="${cx - 4}" x2="${cx + 4}" y1="${y(bar.min)}" y2="${y(bar.min)}"/>`);
      }
    });
    parts.push(`<text class="group" x="${center}" y="${height - 32}" text-anchor="middle">${escape(g.name)}</text>`);
    if (g.sub) parts.push(`<text class="group-sub" x="${center}" y="${height - 16}" text-anchor="middle">${escape(g.sub)}</text>`);
  });

  parts.push(`<line class="baseline" x1="${margin.left}" x2="${width - margin.right}" y1="${y(0)}" y2="${y(0)}"/>`);

  return `<figure class="chart">
  <figcaption>${escape(title)}</figcaption>
  <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">${parts.join('')}</svg>
  ${legend(series)}
</figure>`;
}

module.exports = { barChart, PALETTE };
