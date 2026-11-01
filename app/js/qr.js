/* Generador de QR mínimo: modo byte, corrección de errores M, versiones 1-10 (hasta ~213 bytes). */
(function (w) {
  'use strict';
  var ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // codewords de corrección por bloque (nivel M)
  var BLK = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];              // nº de bloques (nivel M)

  function rawModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) { var a = Math.floor(v / 7) + 2; r -= (25 * a - 10) * a - 55; if (v >= 7) r -= 36; }
    return r;
  }
  function dataCw(v) { return Math.floor(rawModules(v) / 8) - ECC[v] * BLK[v]; }

  function mul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z;
  }
  function rsDiv(n) {
    var r = [], i, j, root = 1;
    for (i = 0; i < n; i++) r.push(0);
    r[n - 1] = 1;
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) { r[j] = mul(r[j], root); if (j + 1 < n) r[j] ^= r[j + 1]; }
      root = mul(root, 2);
    }
    return r;
  }
  function rsRem(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      div.forEach(function (c, i) { r[i] ^= mul(c, f); });
    });
    return r;
  }

  function utf8(s) {
    var u = unescape(encodeURIComponent(s)), b = [];
    for (var i = 0; i < u.length; i++) b.push(u.charCodeAt(i));
    return b;
  }

  function codewords(bytes, ver) {
    var bits = [], cap = dataCw(ver) * 8, i;
    function put(val, n) { for (var k = n - 1; k >= 0; k--) bits.push((val >>> k) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
      data.push(v);
    }
    // bloques + Reed-Solomon + intercalado
    var nb = BLK[ver], eccLen = ECC[ver], raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), blocks = [], k2 = 0, rs = rsDiv(eccLen);
    for (i = 0; i < nb; i++) {
      var dat = data.slice(k2, k2 + shortLen - eccLen + (i < nShort ? 0 : 1));
      k2 += dat.length;
      var ecc = rsRem(dat, rs);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (i = 0; i < blocks[0].length; i++)
      for (var j = 0; j < nb; j++)
        if (i !== shortLen - eccLen || j >= nShort) out.push(blocks[j][i]);
    return out;
  }

  function bit(x, i) { return (x >>> i) & 1; }

  function build(text) {
    var bytes = utf8(text), ver;
    for (ver = 1; ver <= 10; ver++) if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= dataCw(ver) * 8) break;
    if (ver > 10) throw new Error('QR demasiado largo');
    var cw = codewords(bytes, ver);
    var size = ver * 4 + 17, m = [], fn = [], x, y, i, j;
    for (y = 0; y < size; y++) { m.push([]); fn.push([]); for (x = 0; x < size; x++) { m[y].push(0); fn[y].push(0); } }
    function set(x, y, d) { m[y][x] = d ? 1 : 0; fn[y][x] = 1; }

    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var pos = [];
    if (ver > 1) {
      var na = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      pos = [6];
      for (var p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
    }
    for (i = 0; i < pos.length; i++) for (j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
        set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

    function format(mask) {                              // nivel M = 00
      var data = (0 << 3) | mask, rem = data;
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412;
      for (var a = 0; a <= 5; a++) set(8, a, bit(bits, a));
      set(8, 7, bit(bits, 6)); set(8, 8, bit(bits, 7)); set(7, 8, bit(bits, 8));
      for (a = 9; a < 15; a++) set(14 - a, 8, bit(bits, a));
      for (a = 0; a < 8; a++) set(size - 1 - a, 8, bit(bits, a));
      for (a = 8; a < 15; a++) set(8, size - 15 + a, bit(bits, a));
      set(8, size - 8, 1);
    }
    format(0);
    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (ver << 12) | rem;
      for (i = 0; i < 18; i++) {
        var c = bit(vb, i), a2 = size - 11 + i % 3, b2 = Math.floor(i / 3);
        set(a2, b2, c); set(b2, a2, c);
      }
    }

    var k = 0;                                           // colocación en zigzag
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        x = right - j;
        y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && k < cw.length * 8) { m[y][x] = bit(cw[k >>> 3], 7 - (k & 7)); k++; }
      }
    }

    function applyMask(mask) {
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
        var inv;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = x * y % 2 + x * y % 3 === 0; break;
          case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
        }
        if (!fn[y][x] && inv) m[y][x] ^= 1;
      }
    }
    function penalty() {
      var s = 0, dark = 0, line, r, c, run;
      for (r = 0; r < size; r++) for (c = 0; c < size; c++) {
        dark += m[r][c];
        if (r + 1 < size && c + 1 < size && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) s += 3;
      }
      for (var t = 0; t < 2; t++) for (r = 0; r < size; r++) {
        line = ''; run = 1;
        for (c = 0; c < size; c++) {
          var v = t ? m[c][r] : m[r][c];
          line += v;
          if (c > 0 && v === (t ? m[c - 1][r] : m[r][c - 1])) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1;
        }
        var q = 0, f;
        while ((f = line.indexOf('10111010000', q)) >= 0) { s += 40; q = f + 1; }
        q = 0;
        while ((f = line.indexOf('00001011101', q)) >= 0) { s += 40; q = f + 1; }
      }
      return s + (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
    }
    var best = 0, bestP = 1e9;
    for (var mask = 0; mask < 8; mask++) {
      applyMask(mask); format(mask);
      var pen = penalty();
      if (pen < bestP) { bestP = pen; best = mask; }
      applyMask(mask);
    }
    applyMask(best); format(best);
    return m;
  }

  // SVG en una sola <path> (runs horizontales), con zona de silencio de 4 módulos.
  function svg(text) {
    var m = build(text), n = m.length, d = '';
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (!m[y][x]) continue;
        var s = x;
        while (x + 1 < n && m[y][x + 1]) x++;
        d += 'M' + (s + 4) + ' ' + (y + 4) + 'h' + (x - s + 1) + 'v1h-' + (x - s + 1) + 'z';
      }
    }
    var t = n + 8;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + t + ' ' + t + '" shape-rendering="crispEdges">' +
      '<rect width="' + t + '" height="' + t + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
  }

  w.QR = { svg: svg, matrix: build };
})(window);
