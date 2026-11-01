// 브리핑 커넥터(MCP): Claude 예약 작업이 주간·월간 시장동향 같은 브리핑을 스페이스 레터로 보내는 입구.
// - claude.ai '사용자 지정 커넥터'에 https://withpluces.com/api/mcp/<BRIEFING_MCP_SECRET> 로 등록한다.
// - MCP 규격(Streamable HTTP, 상태 없음, JSON 응답) 가운데 필요한 부분만 구현한다.
// - 받는 사람(운영자 시험/구독자 전체)은 서버 설정 SPACELETTER_AUTO_AUDIENCE 로만 정한다. 이 도구로는 바꿀 수 없다.

const SERVER_INFO = { name: 'space-community-briefing', version: '1.2.0' };
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'briefing_publish',
    description: "시장동향 브리핑 전문을 스페이스커뮤니티 사이트에 공개 페이지로 올리고 주소를 돌려줍니다. 주간은 kind='weekly', period='YYYY-MM-DD'(금요일), 월간은 kind='monthly', period='YYYY-MM'. 같은 kind·period로 다시 올리면 내용을 고칩니다. 본문은 게시판 글 규칙: '## 소제목', '| 칸 | 칸 |' 표, **굵게**, [글](https://주소). 이메일의 '전문 보기' 링크에는 여기서 받은 주소를 쓰세요.",
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['weekly', 'monthly'], description: "'weekly'(주간) 또는 'monthly'(월간)" },
        period: { type: 'string', description: "주간: 금요일 날짜 'YYYY-MM-DD', 월간: 'YYYY-MM'" },
        title: { type: 'string', description: "페이지 제목. 예: '주간 시장동향 (10/26~10/30)'" },
        summary: { type: 'string', description: '(선택) 목록·검색에 보일 한두 문장 요약' },
        body: { type: 'string', description: '전문(게시판 글 규칙의 일반 텍스트)' },
      },
      required: ['kind', 'period', 'title', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'briefing_post_talk',
    description: "이미 사이트에 게시된 시장동향 브리핑의 요약과 전문 주소를 스페이스톡 '📈 시장동향 브리핑' 채널에 올립니다(briefing_publish가 새 브리핑을 자동으로 올리므로 보통은 필요 없고, 놓친 브리핑을 다시 올릴 때 씁니다). 같은 브리핑은 한 번만 올라갑니다.",
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['weekly', 'monthly'], description: "'weekly'(주간) 또는 'monthly'(월간)" },
        period: { type: 'string', description: "주간: 금요일 날짜 'YYYY-MM-DD', 월간: 'YYYY-MM'" },
      },
      required: ['kind', 'period'],
      additionalProperties: false,
    },
  },
  {
    name: 'spaceletter_status',
    description: '스페이스 레터 자동 브리핑의 현재 발송 대상(operator=운영자 시험 발송, subscribers=구독자 전체), 받는 인원, 오늘 보낸 수와 하루 한도, 진행 중인 발송이 있는지 알려 줍니다. 보내기 전에 먼저 확인하세요.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'spaceletter_send_briefing',
    description: '브리핑을 스페이스 레터 이메일로 보냅니다. 대상은 서버 설정으로 정해집니다(운영자 시험 발송이면 제목 앞에 [검토용]). 구독자 발송은 사이트 발송 대기열로 들어가 하루 한도 안에서 나뉘어 나가고, 수신거부 링크·발신자 정보가 자동으로 붙습니다. 같은 dedupe_key는 한 번만 보냅니다.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: "메일 제목(150자 이내). 예: '주간시장동향분석 및 전망 (10/26~10/30)'" },
        body: { type: 'string', description: '본문(일반 텍스트). 한 줄이 한 문단으로 보이도록 자동으로 띄어 씁니다.' },
        link_url: { type: 'string', description: "(선택) 본문 끝 '전문 보기' 링크 — briefing_publish가 돌려준 스페이스커뮤니티 주소" },
        dedupe_key: { type: 'string', description: "중복 방지 키(영문 소문자·숫자·-). 예: 'weekly-2026-10-30', 'monthly-2026-10'" },
      },
      required: ['subject', 'body', 'dedupe_key'],
      additionalProperties: false,
    },
  },
];

const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const text = (value, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });
const httpUrl = value => /^https?:\/\/[^\s"'<>()]+$/i.test(value);

// 일반 텍스트 본문 + 링크를 스페이스 레터 표기(newsletter-api renderMarkup)로 바꾼다.
// 휴대폰에서 읽기 쉽도록 한 줄을 한 문단으로 띄우고, 맨 위에 '제공 스페이스커뮤니티'를 밝힌다.
function briefingMarkup(subject, body, linkUrl) {
  const lines = String(body).replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)
    .map(line => line.replace(/^[·•]\s*/, '▪ '));
  return [
    `# ${subject}`,
    '제공: 스페이스커뮤니티',
    ...lines,
    linkUrl ? `**전문 보기** → [스페이스커뮤니티에서 전체 분석 읽기](${linkUrl})` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * @param {object} o
 * @param {() => Promise<object>} o.status
 * @param {(input:{subject:string, body:string, dedupeKey:string}) => Promise<object>} o.send
 */
const talkText = talk => {
  if (!talk) return '';
  if (talk.status === 'posted') return ` / 스페이스톡 '${talk.channel || '📈 시장동향 브리핑'}' 채널에 올렸습니다(받는 사람 ${talk.subscribers ?? 0}명).`;
  if (talk.status === 'skipped') return " / 스페이스톡: 이미 올라간 브리핑이라 다시 올리지 않았습니다.";
  return ` / 스페이스톡 게시 실패: ${talk.message || '알 수 없는 오류'}`;
};

function createBriefingMcp({ status, send, publish, postTalk }) {
  async function callTool(name, args) {
    if (name === 'briefing_publish') {
      if (typeof publish !== 'function') return text('브리핑 페이지 게시가 설정되지 않았습니다.', true);
      const outcome = await publish({ kind: args.kind, period: args.period, title: args.title, summary: args.summary, body: args.body });
      return text(`${outcome.updated ? '고쳐 올렸습니다' : '게시했습니다'}: ${outcome.url}${talkText(outcome.talk)}`);
    }
    if (name === 'briefing_post_talk') {
      if (typeof postTalk !== 'function') return text('스페이스톡 게시가 설정되지 않았습니다.', true);
      const outcome = await postTalk({ kind: args.kind, period: args.period });
      if (!outcome.found) return text(`게시된 브리핑이 없습니다: ${args.kind} ${args.period}. 먼저 briefing_publish로 올리세요.`, true);
      return text(`${outcome.url}${talkText(outcome.talk)}`, outcome.talk?.status === 'error');
    }
    if (name === 'spaceletter_status') return text(JSON.stringify(await status(), null, 2));
    if (name === 'spaceletter_send_briefing') {
      const subject = String(args.subject || '').trim();
      const body = String(args.body || '').trim();
      const link = String(args.link_url || '').trim();
      if (link && !httpUrl(link)) return text('link_url 형식이 올바르지 않습니다(https://…).', true);
      const outcome = await send({ subject, body: briefingMarkup(subject, body, link), dedupeKey: String(args.dedupe_key || '') });
      if (outcome.duplicate) return text(`이미 처리한 브리핑입니다(dedupe_key 중복). 처리 시각: ${outcome.at}, 대상: ${outcome.audience}, 인원: ${outcome.recipients}`);
      if (outcome.audience === 'operator') return text(`운영자 시험 발송 완료: [검토용] 메일 ${outcome.recipients}통${outcome.failed ? `, 실패 ${outcome.failed}통` : ''}. 구독자에게는 보내지 않았습니다(서버 설정 operator).`);
      return text(`구독자 발송을 시작했습니다: 확인된 구독자 ${outcome.recipients}명. 하루 ${outcome.dailyLimit}통 이내로 나누어 보내며, 결과는 뉴스레터 관리 화면 발송 기록에서 볼 수 있습니다.`);
    }
    return null;
  }

  async function one(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return failure(message?.id, -32600, 'Invalid Request');
    const notification = message.id === undefined || message.id === null;
    try {
      if (message.method === 'initialize') {
        const asked = message.params?.protocolVersion;
        return result(message.id, {
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO,
          instructions: '스페이스 커뮤니티 브리핑 커넥터입니다. 보내기 전에 spaceletter_status로 대상을 확인하세요. 대상은 서버 설정으로만 바뀝니다.',
        });
      }
      if (message.method === 'ping') return notification ? null : result(message.id, {});
      if (message.method === 'tools/list') return result(message.id, { tools: TOOLS.filter(tool => (tool.name !== 'briefing_publish' || typeof publish === 'function') && (tool.name !== 'briefing_post_talk' || typeof postTalk === 'function')) });
      if (message.method === 'tools/call') {
        const output = await callTool(message.params?.name, message.params?.arguments || {});
        return output ? result(message.id, output) : failure(message.id, -32602, `알 수 없는 도구: ${message.params?.name}`);
      }
      return notification ? null : failure(message.id, -32601, `Method not found: ${message.method}`);
    } catch (error) {
      if (message.method === 'tools/call') return result(message.id, text(`실패: ${error?.message || error}`, true));
      console.error('Briefing MCP failed:', error);
      return failure(message.id, -32603, 'Internal error');
    }
  }

  // HTTP 한 건: 반환값 { status, body? }
  return async function handle(method, body) {
    if (method !== 'POST') return { status: 405 };
    if (!body || typeof body !== 'object') return { status: 400, body: failure(null, -32700, 'Parse error') };
    if (Array.isArray(body)) {
      const outputs = (await Promise.all(body.map(one))).filter(Boolean);
      return outputs.length ? { status: 200, body: outputs } : { status: 202 };
    }
    const output = await one(body);
    return output ? { status: 200, body: output } : { status: 202 };
  };
}

module.exports = { createBriefingMcp, briefingMarkup, TOOLS };
