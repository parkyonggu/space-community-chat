// 스페이스 톡: 단체 대화방·1:1 대화의 저장과 규칙 (Durable Object SQLite 위에서 동작, 테스트에서는 node:sqlite로 동작)
const { randomUUID, randomBytes } = require('node:crypto');

const DAY = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 90;
const MAX_ROOM_MEMBERS = 100;
const DEFAULT_ROOM_MEMBERS = 30;
const MAX_TEXT = 2000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const SENDER_DELETE_WINDOW = 5 * 60 * 1000;

class ChatError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const code = (bytes = 9) => randomBytes(bytes).toString('base64url');
const clean = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function createChatCore(sql, { now = Date.now } = {}) {
  const all = (query, ...params) => [...sql.exec(query, ...params)];
  const one = (query, ...params) => all(query, ...params)[0] || null;
  const run = (query, ...params) => { sql.exec(query, ...params); };
  const iso = () => new Date(now()).toISOString();

  run(`CREATE TABLE IF NOT EXISTS chat_users (id TEXT PRIMARY KEY, nickname TEXT NOT NULL, code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`);
  run(`CREATE TABLE IF NOT EXISTS chat_rooms (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, owner_id TEXT, max_members INTEGER NOT NULL,
    invite_code TEXT UNIQUE, dm_key TEXT UNIQUE, created_at TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0, last_at TEXT, last_preview TEXT)`);
  run(`CREATE TABLE IF NOT EXISTS chat_members (room_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL,
    joined_seq INTEGER NOT NULL DEFAULT 0, last_read_seq INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (room_id, user_id))`);
  run(`CREATE INDEX IF NOT EXISTS chat_members_user ON chat_members (user_id)`);
  run(`CREATE TABLE IF NOT EXISTS chat_messages (room_id TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT NOT NULL UNIQUE, user_id TEXT, nickname TEXT,
    kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', image_id TEXT, created_at TEXT NOT NULL, deleted_at TEXT, PRIMARY KEY (room_id, seq))`);
  run(`CREATE INDEX IF NOT EXISTS chat_messages_created ON chat_messages (created_at)`);
  run(`CREATE TABLE IF NOT EXISTS chat_images (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, user_id TEXT NOT NULL, type TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL)`);
  run(`CREATE TABLE IF NOT EXISTS chat_reports (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, message_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL,
    created_at TEXT NOT NULL, resolved_at TEXT, UNIQUE (message_id, user_id))`);
  run(`CREATE TABLE IF NOT EXISTS chat_push (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL)`);
  run(`CREATE TABLE IF NOT EXISTS chat_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  // 공지사항 columns were added after the first release: add them to existing databases.
  const roomColumns = all('PRAGMA table_info(chat_rooms)').map(column => column.name);
  for (const column of ['notice', 'notice_at', 'notice_by']) if (!roomColumns.includes(column)) run(`ALTER TABLE chat_rooms ADD COLUMN ${column} TEXT`);

  function ensureUser(user) {
    if (!user?.id) throw new ChatError(401, '로그인한 회원만 이용할 수 있습니다.');
    const existing = one('SELECT * FROM chat_users WHERE id = ?', user.id);
    if (!existing) run('INSERT INTO chat_users (id, nickname, code, created_at) VALUES (?, ?, ?, ?)', user.id, user.nickname, code(6), iso());
    else if (existing.nickname !== user.nickname) run('UPDATE chat_users SET nickname = ? WHERE id = ?', user.nickname, user.id);
    return one('SELECT id, nickname, code FROM chat_users WHERE id = ?', user.id);
  }

  function membership(roomId, userId) {
    const room = one('SELECT * FROM chat_rooms WHERE id = ?', String(roomId || ''));
    if (!room) throw new ChatError(404, '대화방을 찾을 수 없습니다.');
    const member = one('SELECT * FROM chat_members WHERE room_id = ? AND user_id = ?', room.id, userId);
    if (!member) throw new ChatError(403, '참여한 대화방만 볼 수 있습니다.');
    return { room, member };
  }

  function members(roomId) {
    return all(`SELECT m.user_id, u.nickname, m.role, m.last_read_seq, m.joined_seq FROM chat_members m JOIN chat_users u ON u.id = m.user_id
      WHERE m.room_id = ? ORDER BY m.role = 'owner' DESC, m.joined_at`, roomId)
      .map(row => ({ id: row.user_id, nickname: row.nickname, role: row.role, lastReadSeq: row.last_read_seq, joinedSeq: row.joined_seq }));
  }

  function roomView(room, userId) {
    const list = members(room.id);
    const me = list.find(entry => entry.id === userId);
    const member = one('SELECT muted, last_read_seq FROM chat_members WHERE room_id = ? AND user_id = ?', room.id, userId);
    const unread = member ? one('SELECT COUNT(*) AS count FROM chat_messages WHERE room_id = ? AND seq > ? AND (user_id IS NULL OR user_id != ?) AND kind != ?',
      room.id, member.last_read_seq, userId, 'system').count : 0;
    const other = room.kind === 'dm' ? list.find(entry => entry.id !== userId) : null;
    return {
      id: room.id, kind: room.kind, name: room.kind === 'dm' ? (other?.nickname || '대화 상대 없음') : room.name,
      ownerId: room.owner_id, maxMembers: room.max_members, memberCount: list.length, members: list,
      inviteCode: room.kind === 'group' ? room.invite_code : null, isOwner: me?.role === 'owner',
      lastSeq: room.last_seq, lastAt: room.last_at || room.created_at, lastPreview: room.last_preview || '', unread, muted: Boolean(member?.muted),
      notice: room.notice ? { text: room.notice, at: room.notice_at, by: room.notice_by } : null,
    };
  }

  function addMessage(room, { userId = null, nickname = null, kind = 'text', text = '', imageId = null }) {
    const seq = room.last_seq + 1;
    const message = { id: randomUUID(), roomId: room.id, seq, userId, nickname, kind, text, imageId, createdAt: iso(), deletedAt: null };
    run('INSERT INTO chat_messages (room_id, seq, id, user_id, nickname, kind, text, image_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      room.id, seq, message.id, userId, nickname, kind, text, imageId, message.createdAt);
    const preview = kind === 'image' ? '사진' : kind === 'system' ? text : text.slice(0, 80);
    run('UPDATE chat_rooms SET last_seq = ?, last_at = ?, last_preview = ? WHERE id = ?', seq, message.createdAt, preview, room.id);
    room.last_seq = seq;
    return message;
  }

  const messageView = row => ({
    id: row.id, roomId: row.room_id, seq: row.seq, userId: row.user_id, nickname: row.nickname, kind: row.kind,
    text: row.deleted_at ? '' : row.text, imageId: row.deleted_at ? null : row.image_id, createdAt: row.created_at, deletedAt: row.deleted_at,
  });

  function addMember(room, user, role = 'member') {
    run('INSERT INTO chat_members (room_id, user_id, role, joined_at, joined_seq, last_read_seq) VALUES (?, ?, ?, ?, ?, ?)',
      room.id, user.id, role, iso(), room.last_seq, room.last_seq);
  }

  return {
    ensureUser,
    membership,
    members,

    listRooms(user) {
      ensureUser(user);
      return all('SELECT r.* FROM chat_rooms r JOIN chat_members m ON m.room_id = r.id WHERE m.user_id = ?', user.id)
        .map(room => roomView(room, user.id))
        .sort((left, right) => right.lastAt.localeCompare(left.lastAt));
    },

    room(user, roomId) {
      ensureUser(user);
      return roomView(membership(roomId, user.id).room, user.id);
    },

    createGroup(user, { name, maxMembers } = {}) {
      ensureUser(user);
      const title = clean(name, 40);
      if (!title) throw new ChatError(400, '대화방 이름을 1~40자로 입력해 주세요.');
      const limit = Number.isInteger(Number(maxMembers)) ? Math.min(MAX_ROOM_MEMBERS, Math.max(2, Number(maxMembers))) : DEFAULT_ROOM_MEMBERS;
      const room = { id: randomUUID(), kind: 'group', name: title, owner_id: user.id, max_members: limit, invite_code: code(), created_at: iso(), last_seq: 0 };
      run('INSERT INTO chat_rooms (id, kind, name, owner_id, max_members, invite_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        room.id, room.kind, room.name, room.owner_id, room.max_members, room.invite_code, room.created_at);
      addMember(room, user, 'owner');
      const message = addMessage(room, { kind: 'system', text: `${user.nickname}님이 대화방을 만들었습니다.` });
      return { room: roomView(one('SELECT * FROM chat_rooms WHERE id = ?', room.id), user.id), message };
    },

    invitePreview(inviteCode) {
      const room = one('SELECT * FROM chat_rooms WHERE invite_code = ? AND kind = ?', String(inviteCode || ''), 'group');
      if (!room) throw new ChatError(404, '초대 링크가 올바르지 않거나 만료되었습니다.');
      return { name: room.name, memberCount: members(room.id).length, maxMembers: room.max_members };
    },

    join(user, inviteCode) {
      ensureUser(user);
      const room = one('SELECT * FROM chat_rooms WHERE invite_code = ? AND kind = ?', String(inviteCode || ''), 'group');
      if (!room) throw new ChatError(404, '초대 링크가 올바르지 않거나 만료되었습니다.');
      if (one('SELECT 1 AS ok FROM chat_members WHERE room_id = ? AND user_id = ?', room.id, user.id)) return { room: roomView(room, user.id), message: null, joined: false };
      if (members(room.id).length >= room.max_members) throw new ChatError(409, `대화방 정원(${room.max_members}명)이 가득 찼습니다.`);
      addMember(room, user);
      const message = addMessage(room, { kind: 'system', text: `${user.nickname}님이 들어왔습니다.` });
      return { room: roomView(one('SELECT * FROM chat_rooms WHERE id = ?', room.id), user.id), message, joined: true };
    },

    startDm(user, { code: targetCode, userId: targetId } = {}) {
      const me = ensureUser(user);
      const target = targetCode ? one('SELECT * FROM chat_users WHERE code = ?', String(targetCode)) : one('SELECT * FROM chat_users WHERE id = ?', String(targetId || ''));
      if (!target) throw new ChatError(404, '대화 상대를 찾을 수 없습니다. 상대가 스페이스 톡을 한 번 이상 열어야 합니다.');
      if (target.id === me.id) throw new ChatError(400, '나와의 1:1 대화는 만들 수 없습니다.');
      if (!targetCode) {
        // Without a personal link, a 1:1 chat can only start from someone you already share a group room with.
        const shared = one('SELECT 1 AS ok FROM chat_members a JOIN chat_members b ON a.room_id = b.room_id WHERE a.user_id = ? AND b.user_id = ?', me.id, target.id);
        if (!shared) throw new ChatError(403, '같은 대화방에 있는 회원이나 개인 링크로만 1:1 대화를 시작할 수 있습니다.');
      }
      const dmKey = [me.id, target.id].sort().join(':');
      let room = one('SELECT * FROM chat_rooms WHERE dm_key = ?', dmKey);
      if (!room) {
        room = { id: randomUUID(), kind: 'dm', name: '1:1 대화', owner_id: null, max_members: 2, dm_key: dmKey, created_at: iso(), last_seq: 0 };
        run('INSERT INTO chat_rooms (id, kind, name, owner_id, max_members, dm_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          room.id, room.kind, room.name, null, 2, dmKey, room.created_at);
      }
      for (const person of [me, target]) {
        if (!one('SELECT 1 AS ok FROM chat_members WHERE room_id = ? AND user_id = ?', room.id, person.id)) addMember(room, person);
      }
      return roomView(one('SELECT * FROM chat_rooms WHERE id = ?', room.id), me.id);
    },

    messages(user, roomId, { before, limit = 50 } = {}) {
      const { room, member } = membership(roomId, user.id);
      const max = Math.min(100, Math.max(1, Number(limit) || 50));
      const upper = Number.isInteger(Number(before)) && Number(before) > 0 ? Number(before) : room.last_seq + 1;
      const rows = all('SELECT * FROM chat_messages WHERE room_id = ? AND seq < ? AND seq > ? ORDER BY seq DESC LIMIT ?', room.id, upper, member.joined_seq, max);
      const hasMore = rows.length === max && rows.at(-1).seq > member.joined_seq + 1;
      return { messages: rows.reverse().map(messageView), hasMore, members: members(room.id) };
    },

    send(user, roomId, { text, imageId } = {}) {
      ensureUser(user);
      const { room } = membership(roomId, user.id);
      if (room.kind === 'dm' && members(room.id).length < 2) throw new ChatError(409, '상대가 대화방을 나가서 메시지를 보낼 수 없습니다.');
      let body = typeof text === 'string' ? text.trim() : '';
      if (imageId) {
        const image = one('SELECT id FROM chat_images WHERE id = ? AND room_id = ? AND user_id = ?', String(imageId), room.id, user.id);
        if (!image) throw new ChatError(400, '사진을 다시 올려 주세요.');
        body = '';
      } else if (!body || body.length > MAX_TEXT) {
        throw new ChatError(400, `메시지는 1~${MAX_TEXT.toLocaleString('ko-KR')}자로 입력해 주세요.`);
      }
      const message = addMessage(room, { userId: user.id, nickname: user.nickname, kind: imageId ? 'image' : 'text', text: body, imageId: imageId || null });
      run('UPDATE chat_members SET last_read_seq = ? WHERE room_id = ? AND user_id = ?', message.seq, room.id, user.id);
      return { message, memberIds: members(room.id).map(entry => entry.id) };
    },

    read(user, roomId, seq) {
      const { room, member } = membership(roomId, user.id);
      const value = Math.min(room.last_seq, Math.max(member.last_read_seq, Number(seq) || 0));
      if (value !== member.last_read_seq) run('UPDATE chat_members SET last_read_seq = ? WHERE room_id = ? AND user_id = ?', value, room.id, user.id);
      return { seq: value, changed: value !== member.last_read_seq, memberIds: members(room.id).map(entry => entry.id) };
    },

    deleteMessage(user, roomId, messageId) {
      const { room, member } = membership(roomId, user.id);
      const row = one('SELECT * FROM chat_messages WHERE id = ? AND room_id = ?', String(messageId || ''), room.id);
      if (!row || row.kind === 'system') throw new ChatError(404, '메시지를 찾을 수 없습니다.');
      const own = row.user_id === user.id && now() - Date.parse(row.created_at) <= SENDER_DELETE_WINDOW;
      if (!own && member.role !== 'owner' && !user.admin) throw new ChatError(403, '보낸 지 5분 안의 내 메시지, 또는 방장만 삭제할 수 있습니다.');
      run('UPDATE chat_messages SET deleted_at = ?, text = ? WHERE id = ?', iso(), '', row.id);
      if (row.image_id) run('DELETE FROM chat_images WHERE id = ?', row.image_id);
      return { messageId: row.id, memberIds: members(room.id).map(entry => entry.id) };
    },

    leave(user, roomId) {
      const { room, member } = membership(roomId, user.id);
      run('DELETE FROM chat_members WHERE room_id = ? AND user_id = ?', room.id, user.id);
      const rest = members(room.id);
      if (!rest.length) {
        run('DELETE FROM chat_messages WHERE room_id = ?', room.id);
        run('DELETE FROM chat_images WHERE room_id = ?', room.id);
        run('DELETE FROM chat_reports WHERE room_id = ?', room.id);
        run('DELETE FROM chat_rooms WHERE id = ?', room.id);
        return { message: null, memberIds: [] };
      }
      if (member.role === 'owner' && room.kind === 'group') {
        run('UPDATE chat_members SET role = ? WHERE room_id = ? AND user_id = ?', 'owner', room.id, rest[0].id);
        run('UPDATE chat_rooms SET owner_id = ? WHERE id = ?', rest[0].id, room.id);
      }
      const message = addMessage(room, { kind: 'system', text: `${user.nickname}님이 나갔습니다.${member.role === 'owner' && room.kind === 'group' ? ` 방장이 ${rest[0].nickname}님으로 바뀌었습니다.` : ''}` });
      return { message, memberIds: rest.map(entry => entry.id) };
    },

    kick(user, roomId, targetId) {
      const { room, member } = membership(roomId, user.id);
      if (room.kind !== 'group' || member.role !== 'owner') throw new ChatError(403, '방장만 내보낼 수 있습니다.');
      if (targetId === user.id) throw new ChatError(400, '나 자신은 내보낼 수 없습니다.');
      const target = members(room.id).find(entry => entry.id === targetId);
      if (!target) throw new ChatError(404, '대화방에 없는 회원입니다.');
      run('DELETE FROM chat_members WHERE room_id = ? AND user_id = ?', room.id, targetId);
      const message = addMessage(room, { kind: 'system', text: `방장이 ${target.nickname}님을 내보냈습니다.` });
      return { message, memberIds: members(room.id).map(entry => entry.id), removedId: targetId };
    },

    update(user, roomId, { name, resetInvite } = {}) {
      const { room, member } = membership(roomId, user.id);
      if (room.kind !== 'group' || member.role !== 'owner') throw new ChatError(403, '방장만 바꿀 수 있습니다.');
      let message = null;
      if (name !== undefined) {
        const title = clean(name, 40);
        if (!title) throw new ChatError(400, '대화방 이름을 1~40자로 입력해 주세요.');
        if (title !== room.name) {
          run('UPDATE chat_rooms SET name = ? WHERE id = ?', title, room.id);
          message = addMessage(room, { kind: 'system', text: `방장이 대화방 이름을 '${title}'(으)로 바꿨습니다.` });
        }
      }
      if (resetInvite) run('UPDATE chat_rooms SET invite_code = ? WHERE id = ?', code(), room.id);
      return { room: roomView(one('SELECT * FROM chat_rooms WHERE id = ?', room.id), user.id), message, memberIds: members(room.id).map(entry => entry.id) };
    },

    setNotice(user, roomId, text) {
      const { room, member } = membership(roomId, user.id);
      if (room.kind === 'group' && member.role !== 'owner' && !user.admin) throw new ChatError(403, '공지는 방장만 등록할 수 있습니다.');
      const body = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
      if (body) run('UPDATE chat_rooms SET notice = ?, notice_at = ?, notice_by = ? WHERE id = ?', body, iso(), user.nickname, room.id);
      else run('UPDATE chat_rooms SET notice = NULL, notice_at = NULL, notice_by = NULL WHERE id = ?', room.id);
      const message = addMessage(room, { kind: 'system', text: body ? `${user.nickname}님이 공지를 등록했습니다.` : `${user.nickname}님이 공지를 내렸습니다.` });
      return { room: roomView(one('SELECT * FROM chat_rooms WHERE id = ?', room.id), user.id), message, memberIds: members(room.id).map(entry => entry.id) };
    },

    mute(user, roomId, muted) {
      const { room } = membership(roomId, user.id);
      run('UPDATE chat_members SET muted = ? WHERE room_id = ? AND user_id = ?', muted ? 1 : 0, room.id, user.id);
      return { muted: Boolean(muted) };
    },

    report(user, roomId, messageId, reason) {
      const { room } = membership(roomId, user.id);
      const text = clean(reason, 200);
      if (!text) throw new ChatError(400, '신고 사유를 1~200자로 입력해 주세요.');
      const row = one('SELECT * FROM chat_messages WHERE id = ? AND room_id = ?', String(messageId || ''), room.id);
      if (!row || row.kind === 'system') throw new ChatError(404, '메시지를 찾을 수 없습니다.');
      if (row.user_id === user.id) throw new ChatError(400, '내 메시지는 신고할 수 없습니다.');
      if (one('SELECT 1 AS ok FROM chat_reports WHERE message_id = ? AND user_id = ?', row.id, user.id)) throw new ChatError(409, '이미 신고한 메시지입니다.');
      run('INSERT INTO chat_reports (id, room_id, message_id, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), room.id, row.id, user.id, text, iso());
      return { message: '신고가 접수되었습니다. 운영자가 검토합니다.' };
    },

    reports(user) {
      if (!user?.admin) throw new ChatError(403, '운영자만 볼 수 있습니다.');
      return all(`SELECT r.id, r.reason, r.created_at, m.id AS message_id, m.room_id, m.nickname, m.text, m.kind, m.deleted_at, room.name AS room_name, room.kind AS room_kind,
        (SELECT COUNT(*) FROM chat_reports x WHERE x.message_id = r.message_id) AS count
        FROM chat_reports r JOIN chat_messages m ON m.id = r.message_id JOIN chat_rooms room ON room.id = r.room_id
        WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 100`)
        .map(row => ({ id: row.id, reason: row.reason, createdAt: row.created_at, messageId: row.message_id, roomId: row.room_id, roomName: row.room_kind === 'dm' ? '1:1 대화' : row.room_name,
          nickname: row.nickname, text: row.deleted_at ? '(삭제된 메시지)' : row.kind === 'image' ? '(사진)' : row.text, deleted: Boolean(row.deleted_at), count: row.count }));
    },

    resolveReport(user, messageId, action) {
      if (!user?.admin) throw new ChatError(403, '운영자만 처리할 수 있습니다.');
      const row = one('SELECT * FROM chat_messages WHERE id = ?', String(messageId || ''));
      if (!row) throw new ChatError(404, '메시지를 찾을 수 없습니다.');
      if (action === 'delete') {
        run('UPDATE chat_messages SET deleted_at = ?, text = ? WHERE id = ?', iso(), '', row.id);
        if (row.image_id) run('DELETE FROM chat_images WHERE id = ?', row.image_id);
      } else if (action !== 'keep') {
        throw new ChatError(400, '처리 방법을 확인해 주세요.');
      }
      run('UPDATE chat_reports SET resolved_at = ? WHERE message_id = ?', iso(), row.id);
      return { roomId: row.room_id, messageId: row.id, deleted: action === 'delete', memberIds: members(row.room_id).map(entry => entry.id) };
    },

    saveImage(user, roomId, type, bytes) {
      const { room } = membership(roomId, user.id);
      if (!IMAGE_TYPES.includes(type)) throw new ChatError(415, '사진은 JPG, PNG, WEBP, GIF만 보낼 수 있습니다.');
      const size = bytes?.byteLength || 0;
      if (!size || size > MAX_IMAGE_BYTES) throw new ChatError(413, '사진은 2MB 이하로 보내 주세요.');
      const id = randomUUID();
      run('INSERT INTO chat_images (id, room_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, room.id, user.id, type, bytes, iso());
      return { imageId: id };
    },

    image(user, imageId) {
      const row = one('SELECT * FROM chat_images WHERE id = ?', String(imageId || ''));
      if (!row) throw new ChatError(404, '사진을 찾을 수 없습니다.');
      membership(row.room_id, user.id);
      return { type: row.type, data: row.data };
    },

    unreadSummary(user) {
      ensureUser(user);
      const rooms = this.listRooms(user).filter(room => room.unread > 0);
      const total = rooms.reduce((sum, room) => sum + room.unread, 0);
      const latest = rooms.filter(room => !room.muted)[0] || null;
      return { total, latest: latest ? { roomId: latest.id, name: latest.name, preview: latest.lastPreview, unread: latest.unread } : null };
    },

    savePush(user, endpoint) {
      ensureUser(user);
      if (typeof endpoint !== 'string' || !/^https:\/\/[^\s]{10,800}$/.test(endpoint)) throw new ChatError(400, '알림 구독 정보가 올바르지 않습니다.');
      run('INSERT OR REPLACE INTO chat_push (endpoint, user_id, created_at) VALUES (?, ?, ?)', endpoint, user.id, iso());
      return { ok: true };
    },
    removePush(endpoint) { run('DELETE FROM chat_push WHERE endpoint = ?', String(endpoint || '')); },
    pushTargets(roomId, userIds) {
      if (!userIds.length) return [];
      return all(`SELECT p.endpoint, p.user_id FROM chat_push p JOIN chat_members m ON m.user_id = p.user_id AND m.room_id = ?
        WHERE m.muted = 0 AND p.user_id IN (${userIds.map(() => '?').join(',')})`, roomId, ...userIds);
    },

    meta(key, value) {
      if (value === undefined) return one('SELECT value FROM chat_meta WHERE key = ?', key)?.value ?? null;
      run('INSERT OR REPLACE INTO chat_meta (key, value) VALUES (?, ?)', key, value);
      return value;
    },

    purge() {
      const cutoff = new Date(now() - RETENTION_DAYS * DAY).toISOString();
      run('DELETE FROM chat_messages WHERE created_at < ?', cutoff);
      run('DELETE FROM chat_images WHERE created_at < ?', cutoff);
      run('DELETE FROM chat_reports WHERE created_at < ?', cutoff);
      return { cutoff };
    },

    deleteUser(userId) {
      const rooms = all('SELECT room_id FROM chat_members WHERE user_id = ?', userId).map(row => row.room_id);
      const affected = [];
      for (const roomId of rooms) {
        const room = one('SELECT * FROM chat_rooms WHERE id = ?', roomId);
        const result = this.leave({ id: userId, nickname: '탈퇴한 회원' }, roomId);
        if (room && result.message) affected.push({ roomId, message: result.message, memberIds: result.memberIds });
      }
      run('UPDATE chat_messages SET nickname = ?, user_id = NULL WHERE user_id = ?', '탈퇴한 회원', userId);
      run('DELETE FROM chat_push WHERE user_id = ?', userId);
      run('DELETE FROM chat_users WHERE id = ?', userId);
      return affected;
    },
  };
}

module.exports = { createChatCore, ChatError, RETENTION_DAYS, MAX_ROOM_MEMBERS };
