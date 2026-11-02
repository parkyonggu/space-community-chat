// 게시판 글 본문 꾸미기(브라우저·서버 공용).
// - 표: 한글·엑셀에서 표를 복사해 붙인 글(칸 사이가 탭), 칸을 | 로 나눈 글, 칸 사이를 두 칸 이상 띄워 맞춘 글(3줄 이상)을 표로 보여 준다.
// - 소제목: 줄 앞에 "## " 또는 "■" → 밑줄 있는 굵은 소제목
// - 밑줄: __글자__ , 굵게: **글자**
// - 주소(https://…)·[글](주소)는 링크로. 그 밖의 글자는 모두 이스케이프한다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.spaceRichText = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  // 한 줄을 표의 칸으로 나눈다. 표 줄이 아니면 null.
  function cellsOf(line, loose) {
    const text = line.replace(/\s+$/, '');
    if (!text.trim()) return null;
    if (text.includes('\t')) {
      const cells = text.split('\t').map(cell => cell.trim());
      while (cells.length > 1 && !cells[cells.length - 1]) cells.pop();
      return cells.length >= 2 ? cells : null;
    }
    if (/\S\s*\|\s*\S/.test(text)) {
      const cells = text.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(cell => cell.trim());
      if (cells.length >= 2 && !cells.every(cell => /^:?-{2,}:?$/.test(cell))) return cells;
      if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) return ['__divider__'];
      return null;
    }
    if (loose) {
      const cells = text.trim().split(/\s{2,}|　+/).map(cell => cell.trim()).filter(Boolean);
      return cells.length >= 3 ? cells : null;
    }
    return null;
  }

  // 글을 덩어리(문단·표·소제목)로 나눈다.
  function blocksOf(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];
    const flush = () => { if (paragraph.length) blocks.push({ type: 'p', lines: paragraph }); paragraph = []; };
    for (let index = 0; index < lines.length;) {
      const line = lines[index];
      let tabled = false;
      // 표: 탭·| 로 나눈 줄 2줄 이상, 또는 두 칸 띄어 맞춘 줄 3줄 이상
      for (const loose of [false, true]) {
        const rows = [];
        let end = index;
        while (end < lines.length) {
          const cells = cellsOf(lines[end], loose);
          if (!cells) break;
          rows.push(cells);
          end += 1;
        }
        const real = rows.filter(row => row[0] !== '__divider__');
        if (real.length >= (loose ? 3 : 2)) {
          flush();
          blocks.push({ type: 'table', rows: real, pipe: !loose && !lines[index].includes('\t') });
          index = end;
          tabled = true;
          break;
        }
      }
      if (tabled) continue;
      const heading = /^\s*(?:#{1,3}\s+|■\s*)(.+)$/.exec(line);
      if (heading && heading[1].trim()) {
        flush();
        blocks.push({ type: 'h', text: heading[1].trim().replace(/^#+\s*/, '') });
      } else if (!line.trim()) {
        flush();
      } else {
        paragraph.push(line.trim());
      }
      index += 1;
    }
    flush();
    return blocks;
  }

  // 링크·밑줄·굵게
  function inline(line) {
    const link = (url, label) => `<a href="${escapeHtml(url)}" rel="nofollow ugc noopener" target="_blank">${label}</a>`;
    const decorate = value => escapeHtml(value)
      .replace(/__([^_\n][^\n]*?)__/g, '<u>$1</u>')
      .replace(/\*\*([^*\n][^\n]*?)\*\*/g, '<strong>$1</strong>');
    const parts = [];
    let rest = String(line);
    const pattern = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/;
    let match;
    while ((match = pattern.exec(rest))) {
      parts.push(decorate(rest.slice(0, match.index)));
      if (match[2]) {
        parts.push(link(match[2], decorate(match[1])));
        rest = rest.slice(match.index + match[0].length);
      } else {
        const url = match[3].replace(/[.,)\]]+$/, '');
        parts.push(link(url, escapeHtml(url)));
        rest = rest.slice(match.index + url.length);
      }
    }
    parts.push(decorate(rest));
    return parts.join('');
  }

  const NUMERIC = /^[+\-−±]?\s*(?:HK\$|US\$|NT\$|\$|₩|€|¥)?\s*[\d,.]+\s*(?:%|%p|원|위안|달러|엔|배|건|명|개)?(?:\s*\(.*\))?$/;
  function tableHtml(rows, pipe = false) {
    const width = Math.max(...rows.map(row => row.length));
    const padded = rows.map(row => [...row, ...Array(width - row.length).fill('')]);
    // 첫 줄에 숫자 칸이 없고 다른 줄에는 있으면 머리줄로 본다.
    const hasNumber = row => row.some(cell => NUMERIC.test(cell));
    // 칸을 | 로 나눈 표(📋 표 넣기 포함)는 첫 줄이 늘 머리줄이다.
    const header = padded.length >= 2 && !hasNumber(padded[0]) && (pipe || padded.slice(1).some(hasNumber));
    // 숫자 칸의 괄호 부분(예: −5.30%(−1,424.06p))은 따로 감싸 둔다. 좁은 화면(시장동향 브리핑)에서는 괄호 부분만 다음 줄로 내린다.
    const numCell = value => {
      const split = /^(.*?)(\(.*\))$/.exec(value);
      return split && split[1].trim() ? `${inline(split[1])}<span class="num-sub">${inline(split[2])}</span>` : inline(value);
    };
    const cell = (tag, value) => tag === 'td' && NUMERIC.test(value) ? `<td class="num">${numCell(value)}</td>` : `<${tag}>${inline(value)}</${tag}>`;
    const head = header ? `<thead><tr>${padded[0].map(value => cell('th', value)).join('')}</tr></thead>` : '';
    const body = (header ? padded.slice(1) : padded).map(row => `<tr>${row.map(value => cell('td', value)).join('')}</tr>`).join('');
    return `<div class="rt-table"><table>${head}<tbody>${body}</tbody></table></div>`;
  }

  function toHtml(text) {
    return blocksOf(text).map(block => {
      if (block.type === 'table') return tableHtml(block.rows, block.pipe);
      if (block.type === 'h') return `<h3 class="rt-h">${inline(block.text)}</h3>`;
      return `<p>${block.lines.map(inline).join('<br>')}</p>`;
    }).join('\n');
  }

  // 꾸밈 기호를 뺀 글(요약·미리보기용). tables:false 이면 표는 빼고, 아니면 칸을 ' · '로 잇는다.
  function plain(text, { tables = true } = {}) {
    return blocksOf(text).map(block => {
      if (block.type === 'table') return tables ? block.rows.map(row => row.join(' · ')).join('\n') : '';
      const clean = value => String(value).replace(/__([^\n]+?)__/g, '$1').replace(/\*\*([^\n]+?)\*\*/g, '$1');
      if (block.type === 'h') return clean(block.text);
      return block.lines.map(clean).join('\n');
    }).filter(Boolean).join('\n\n');
  }

  return { toHtml, plain, escapeHtml };
});
