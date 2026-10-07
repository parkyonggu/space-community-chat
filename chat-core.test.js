const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createChatCore } = require('./chat-core');

function memorySql() {
  const db = new DatabaseSync(':memory:');
  return { exec(query, ...params) {
    const values = params.map(value => (value instanceof ArrayBuffer ? new Uint8Array(value) : value));
    return db.prepare(query).all(...values)[Symbol.iterator]();
  } };
}
const users = {
  alice: { id: 'u-a', nickname: '앨리스' }, bob: { id: 'u-b', nickname: '밥' }, carol: { id: 'u-c', nickname: '캐럴' },
  admin: { id: 'u-z', nickname: '운영자', admin: true },
};

test('group rooms: invite, unread counts, read receipts, members-only history, owner powers', () => {
  let clock = Date.parse('2026-10-06T10:00:00Z');
  const chat = createChatCore(memorySql(), { now: () => clock });
  const { room } = chat.createGroup(users.alice, { name: '  동네  모임 ', maxMembers: 3 });
  assert.equal(room.name, '동네 모임');
  assert.equal(room.maxMembers, 3);
  assert.equal(chat.invitePreview(room.inviteCode).memberCount, 1);
  assert.throws(() => chat.messages(users.bob, room.id), /참여한 대화방/);
  const joined = chat.join(users.bob, room.inviteCode);
  assert.equal(joined.joined, true);
  assert.equal(chat.join(users.bob, room.inviteCode).joined, false, 'joining twice is a no-op');
  chat.join(users.carol, room.inviteCode);
  assert.throws(() => chat.join(users.admin, room.inviteCode), /정원\(3명\)/);

  clock += 1000;
  const first = chat.send(users.alice, room.id, { text: '안녕하세요' });
  assert.deepEqual(first.memberIds.sort(), ['u-a', 'u-b', 'u-c']);
  chat.send(users.alice, room.id, { text: '반가워요' });
  assert.equal(chat.listRooms(users.bob)[0].unread, 2);
  assert.equal(chat.listRooms(users.alice)[0].unread, 0, 'own messages are not unread');
  chat.read(users.bob, room.id, first.message.seq + 1);
  assert.equal(chat.listRooms(users.bob)[0].unread, 0);
  assert.equal(chat.read(users.bob, room.id, 999).seq, first.message.seq + 1, 'read position cannot pass the last message');

  const history = chat.messages(users.carol, room.id);
  assert.deepEqual(history.messages.map(message => message.kind), ['system', 'text', 'text']);
  assert.equal(history.messages[0].text, '캐럴님이 들어왔습니다.');
  assert.equal(history.members.find(member => member.id === 'u-b').lastReadSeq, first.message.seq + 1);

  assert.throws(() => chat.kick(users.bob, room.id, 'u-c'), /방장만/);
  assert.equal(chat.kick(users.alice, room.id, 'u-c').removedId, 'u-c');
  assert.throws(() => chat.update(users.bob, room.id, { name: 'x' }), /방장만/);
  const old = room.inviteCode;
  const updated = chat.update(users.alice, room.id, { name: '새 이름', resetInvite: true }).room;
  assert.equal(updated.name, '새 이름');
  assert.notEqual(updated.inviteCode, old);
  assert.throws(() => chat.join(users.carol, old), /초대 링크/);

  assert.throws(() => chat.setNotice(users.bob, room.id, '공지'), /방장만/);
  const noticed = chat.setNotice(users.alice, room.id, '  토요일 2시 도서관 3층  ');
  assert.equal(noticed.room.notice.text, '토요일 2시 도서관 3층');
  assert.equal(noticed.message.text, '앨리스님이 공지를 등록했습니다.');
  assert.equal(chat.room(users.bob, room.id).notice.by, '앨리스');
  assert.equal(chat.setNotice(users.alice, room.id, '').room.notice, null);
  const left = chat.leave(users.alice, room.id);
  assert.match(left.message.text, /방장이 밥님으로/);
  assert.equal(chat.room(users.bob, room.id).isOwner, true);
  chat.leave(users.bob, room.id);
  assert.throws(() => chat.room(users.bob, room.id), /찾을 수 없습니다/);
});

test('1:1 chats need a personal link or a shared room; messages can be deleted, reported and moderated', () => {
  let clock = Date.parse('2026-10-06T10:00:00Z');
  const chat = createChatCore(memorySql(), { now: () => clock });
  const bob = chat.ensureUser(users.bob);
  chat.ensureUser(users.carol);
  assert.throws(() => chat.startDm(users.alice, { userId: 'u-c' }), /같은 대화방/);
  const dm = chat.startDm(users.alice, { code: bob.code });
  assert.equal(dm.kind, 'dm');
  assert.equal(dm.name, '밥');
  assert.equal(chat.startDm(users.bob, { userId: 'u-a' }).id, dm.id, 'same pair reuses the room');
  assert.throws(() => chat.startDm(users.bob, { code: bob.code }), /나와의/);

  const sent = chat.send(users.alice, dm.id, { text: '비밀 이야기' });
  assert.throws(() => chat.send(users.alice, dm.id, { text: ' ' }), /1~2,000자/);
  assert.throws(() => chat.deleteMessage(users.bob, dm.id, sent.message.id), /5분/);
  clock += 6 * 60 * 1000;
  assert.throws(() => chat.deleteMessage(users.alice, dm.id, sent.message.id), /5분/);
  assert.throws(() => chat.report(users.alice, dm.id, sent.message.id, '테스트'), /내 메시지/);
  chat.report(users.bob, dm.id, sent.message.id, '욕설');
  assert.throws(() => chat.report(users.bob, dm.id, sent.message.id, '욕설'), /이미 신고/);
  assert.throws(() => chat.reports(users.bob), /운영자만/);
  const [report] = chat.reports(users.admin);
  assert.equal(report.text, '비밀 이야기');
  chat.resolveReport(users.admin, report.messageId, 'delete');
  assert.equal(chat.messages(users.bob, dm.id).messages[0].deletedAt !== null, true);
  assert.equal(chat.reports(users.admin).length, 0);

  const fresh = chat.send(users.bob, dm.id, { text: '다시' });
  assert.equal(chat.deleteMessage(users.bob, dm.id, fresh.message.id).messageId, fresh.message.id);
  chat.leave(users.alice, dm.id);
  assert.throws(() => chat.send(users.bob, dm.id, { text: '여보세요' }), /상대가 대화방을 나가서/);
});

test('images, push targets, unread summary, retention and account deletion', () => {
  let clock = Date.parse('2026-10-06T10:00:00Z');
  const chat = createChatCore(memorySql(), { now: () => clock });
  const { room } = chat.createGroup(users.alice, { name: '사진방' });
  chat.join(users.bob, room.inviteCode);
  assert.throws(() => chat.saveImage(users.alice, room.id, 'text/html', new ArrayBuffer(10)), /JPG/);
  assert.throws(() => chat.saveImage(users.alice, room.id, 'image/png', new ArrayBuffer(3 * 1024 * 1024)), /2MB/);
  const { imageId } = chat.saveImage(users.alice, room.id, 'image/png', new Uint8Array([1, 2, 3]).buffer);
  assert.throws(() => chat.send(users.bob, room.id, { imageId }), /사진을 다시/);
  const sent = chat.send(users.alice, room.id, { imageId });
  assert.equal(sent.message.kind, 'image');
  assert.equal(chat.image(users.bob, imageId).type, 'image/png');
  assert.throws(() => chat.image(users.carol, imageId), /참여한 대화방/);
  assert.equal(chat.listRooms(users.bob)[0].lastPreview, '사진');

  chat.savePush(users.bob, 'https://push.example.com/abc1234567');
  assert.throws(() => chat.savePush(users.bob, 'http://insecure'), /알림 구독/);
  assert.deepEqual(chat.pushTargets(room.id, ['u-b']).map(row => row.user_id), ['u-b']);
  chat.mute(users.bob, room.id, true);
  assert.deepEqual(chat.pushTargets(room.id, ['u-b']), []);
  assert.equal(chat.unreadSummary(users.bob).total, 1);
  assert.equal(chat.unreadSummary(users.bob).latest, null, 'muted rooms are not announced');

  clock += 91 * 24 * 60 * 60 * 1000;
  chat.purge();
  assert.equal(chat.messages(users.bob, room.id).messages.length, 0);
  assert.throws(() => chat.image(users.bob, imageId), /사진을 찾을 수/);

  chat.send(users.bob, room.id, { text: '남은 메시지' });
  const affected = chat.deleteUser('u-b');
  assert.equal(affected[0].roomId, room.id);
  assert.equal(chat.messages(users.alice, room.id).messages.find(message => message.kind === 'text').nickname, '탈퇴한 회원');
  assert.deepEqual(chat.pushTargets(room.id, ['u-b']), []);
});
