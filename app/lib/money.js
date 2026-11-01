const TAX_BASIS_POINTS = 825;

function toCents(value) {
  const text = String(value ?? '0').trim();
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const cents = `${fraction}00`.slice(0, 2);
  const amount = (parseInt(whole || '0', 10) * 100) + parseInt(cents, 10);
  return negative ? -amount : amount;
}

function lineTotalCents(quantity, priceEach) {
  return Number(quantity) * toCents(priceEach);
}

function taxCents(subtotalCents) {
  return Math.round((subtotalCents * TAX_BASIS_POINTS) / 10000);
}

function toDecimal(cents) {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function format(cents) {
  const [whole, fraction] = toDecimal(cents).split('.');
  const grouped = whole.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${grouped}.${fraction}`;
}

module.exports = { TAX_BASIS_POINTS, toCents, lineTotalCents, taxCents, toDecimal, format };
