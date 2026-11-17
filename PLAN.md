# PLAN v3 — 1 vs 1 Online + sửa nhanh UX cảm ứng

Bản kế hoạch cũ (mô phỏng luyện tập) nằm ở `docs/plan-v1-practice-sim.md`.

## 0. Mục tiêu và phạm vi

Thêm chế độ **1 vs 1 Online** (hai người, hai thiết bị, phòng riêng bằng mã/liên kết mời) cho luật 9 bi và 8 bi,
dùng lại toàn bộ luồng trận đấu hiện có của chế độ Bot. Kèm 4 sửa nhanh UX đã đo được.

Ngoài phạm vi đợt này (KHÔNG làm): tài khoản, xếp hạng, ghép cặp ngẫu nhiên, chat, đồng hồ đánh, chống gian lận,
làm lại sảnh, làm lại bố cục trong trận.

## 1. Ràng buộc

- Client vẫn là JavaScript thuần ES modules, **không build step**, không thư viện ngoài ở phía trình duyệt.
- Server: Node.js >= 20, đúng **một** dependency: `ws`. Không framework.
- Chữ trên giao diện bằng tiếng Việt. Mã, comment, tên biến bằng tiếng Anh như code hiện có.
- Module thuần (không DOM, không socket) tách khỏi I/O để test bằng `node --test`.
- Không đổi hành vi các chế độ hiện có (Bot, Hero, Đấu 2 Bot, Luyện tập). `npm test` hiện tại phải vẫn qua.
- Mọi phần tử bấm được mới: cao tối thiểu 44px trên thiết bị cảm ứng. Giao diện mới phải dùng được ở
  375x812, 812x375, 768x1024, 1366x768, không tràn ngang.

## 2. Bố cục tệp

```
server/
  index.mjs            # HTTP tĩnh + WebSocket /ws (I/O), đọc PORT, ALLOWED_ORIGINS
  rooms.mjs            # RoomManager thuần (không socket): tạo/vào/rời/rejoin/dọn phòng
src/net/
  protocol.js          # thuần: hằng số, validate/parse message; dùng chung client + server
  client.js            # bọc WebSocket phía trình duyệt: connect, send, tự kết nối lại, sự kiện
  config.js            # tính URL server (mặc định cùng origin, ghi đè được)
src/features/
  pvp.js               # thuần: seeded rng, đóng gói/áp snapshot trận, ánh xạ ghế
tests/net/protocol.test.mjs
tests/server/rooms.test.mjs
tests/server/integration.test.mjs   # bật server thật ở cổng 0, hai client `ws`
tests/features/pvp.test.mjs
.env.example           # PORT, ALLOWED_ORIGINS
```

Sửa: `index.html`, `assets/style.css`, `src/app.js`, `src/ui/panel.js`, `sw.js`, `package.json`, `README.md`,
`.claude/launch.json` (thêm cấu hình `bida9-online`: `node server/index.mjs`, port 8787).

`package.json`:
- `"dependencies": { "ws": "^8" }`
- scripts: `"start": "node server/index.mjs"`, `"test": "node --test \"tests/**/*.test.mjs\""`
  (kiểm tra glob này chạy đủ cả test cũ trong `tests/core/`; `tests/case/test-suite.mjs` không khớp `*.test.mjs` nên không bị kéo vào).

## 3. Kiến trúc đồng bộ

**Người đánh là nguồn sự thật (shooter-authoritative), server chỉ chuyển tiếp.**

1. Trong lúc ngắm, người đang có lượt gửi `aim` (tối đa 10 lần/giây) để đối thủ thấy gậy, lực, điểm chạm, vị trí bi cái.
2. Khi đánh, người đánh gửi `shot` gồm toàn bộ vị trí bi trước cú đánh + tham số cú đánh + `seed`.
   Cả hai máy tự chạy `createSim(...)` từ cùng dữ liệu, với `rng` = `mulberry32(seed)` (hiện miscue dùng `Math.random`;
   `Sim` đã nhận `opts.rng`).
3. Máy người đánh chạy `finishShot()` như thường (luật, đổi lượt, tỉ số), rồi gửi `sync` (snapshot đầy đủ).
4. Máy đối thủ KHÔNG tự chấm luật. Khi hoạt ảnh của nó kết thúc VÀ đã nhận `sync` cùng `seq`, nó áp snapshot
   (đặt lại vị trí bi + trạng thái trận). `sync` đến trước thì giữ lại chờ hoạt ảnh xong; hoạt ảnh xong trước thì
   khóa điều khiển và chờ `sync` (quá 8 giây chưa có thì hiện "Đang đồng bộ…", tiếp tục chờ).
5. Xếp bi ván mới (có ngẫu nhiên): chỉ **chủ phòng** chạy `startBotRack`, rồi gửi `sync` lý do `rack`. Khách chờ.
6. Kết nối lại: bên còn trong phòng gửi `sync` lý do `resync` cho bên vừa quay lại.

Thiết bị trong trận online: cả hai dùng cố định `tablePreset('club-9ft')` và `cuePreset('standard')` (lấy id thật của
"Gậy thường" trong `CUE_PRESETS`), không ghi đè lựa chọn đã lưu của người dùng; thoát trận thì khôi phục. Nút "Thiết bị"
bị khóa trong trận online.

Giới hạn đã biết (ghi vào README): bên đánh có thể gian lận vì server không tự mô phỏng; chấp nhận cho bản đầu.

## 4. Giao thức (`src/net/protocol.js`)

JSON text frame, tối đa 16 KB. Mọi message có `t` (type). Export:
`MSG`, `MAX_BYTES`, `ROOM_CODE_RE`, `sanitizeName(s)`, `parseClientMessage(raw)`, `parseRelayPayload(obj)`,
`makeRoomCode(rng)`. Hàm parse trả `{ ok: true, msg }` hoặc `{ ok: false, error }`, không ném lỗi.

Mã phòng: 5 ký tự từ `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (bỏ I, O, 0, 1). Tên: cắt khoảng trắng, tối đa 15 ký tự,
bỏ ký tự điều khiển; rỗng thì thành "Người chơi".

Client → server:

| t | Trường | Ý nghĩa |
|---|---|---|
| `create` | `name`, `game` ('9ball'\|'8ball'), `raceTo` (0,1,3,5,7,9,11) | Tạo phòng |
| `join` | `code`, `name` | Vào phòng |
| `rejoin` | `code`, `token` | Quay lại sau khi rớt mạng |
| `relay` | `p` (payload, xem dưới) | Chuyển cho đối thủ |
| `leave` | – | Rời phòng |

Server → client:

| t | Trường |
|---|---|
| `created` | `code`, `token`, `seat: 1` |
| `joined` | `code`, `token`, `seat: 2`, `hostName`, `game`, `raceTo` |
| `peer-joined` | `name` |
| `peer-left` | `graceMs` (đối thủ rớt mạng, còn thời gian chờ) |
| `peer-back` | – |
| `room-closed` | `reason` ('left' \| 'timeout') |
| `relay` | `p` |
| `error` | `code` ('bad-message' \| 'no-room' \| 'room-full' \| 'bad-token' \| 'rate-limit') |

Payload `relay.p` (validate ở cả server lẫn client nhận):

| k | Trường |
|---|---|
| `aim` | `angle`, `power`, `tip {x,y}`, `elev`, `cue {x,y}` |
| `shot` | `seq`, `seed`, `balls [{id,x,y}]`, `aimDir {x,y}`, `power`, `tip`, `elev` |
| `sync` | `seq`, `reason` ('result'\|'rack'\|'resync'), `balls [{id,x,y,q?}]`, `potted [id]`, `match {...}`, `toast?` |
| `rematch` | `accept: boolean` |
| `resign` | – |

`match` = tập con của `state.bot`: `game, raceTo, scorePlayer, scoreBot, rack, breaker, turn, onBreak, ballInHand,
isFoul, matchOver, groups, statusText` + `targetId`. Mọi số phải hữu hạn (`Number.isFinite`), mảng bi tối đa 16 phần tử.

## 5. Server

`server/rooms.mjs` — `createRoomManager({ now, rng, graceMs = 60000, idleMs = 30 * 60000 })`, thuần:
- `create(connId, {name, game, raceTo})` → `{ code, token, seat: 1 }`
- `join(connId, {code, name})` → `{ ok, error?, token, seat: 2, room }`
- `rejoin(connId, {code, token})` → `{ ok, error?, seat }`
- `disconnect(connId)` → `{ room, seat, peerConnId }` (giữ ghế trong `graceMs`)
- `leave(connId)` → đóng phòng, trả `peerConnId`
- `peerOf(connId)` → connId đối thủ hoặc null
- `sweep()` → danh sách phòng hết hạn (rớt quá `graceMs` hoặc không hoạt động quá `idleMs`), trả các connId cần báo.
- Token: 16 byte ngẫu nhiên dạng hex (inject được để test). Giới hạn 2 người/phòng.

`server/index.mjs`:
- `http.createServer` phục vụ tệp tĩnh từ gốc dự án với danh sách cho phép: `index.html`, `sw.js`, `assets/**`, `src/**`
  (chặn `..`, không phục vụ `server/`, `tests/`, `docs/`, `scripts/`, tệp ẩn, `package.json`). Content-Type đúng cho
  `.html .js .mjs .css .svg .webmanifest .json`. `GET /healthz` trả `ok`.
- `WebSocketServer` ở path `/ws`, `maxPayload` 16 KB. Kiểm tra `Origin` nếu có `ALLOWED_ORIGINS` (danh sách cách nhau bằng dấu phẩy).
- Ping mỗi 25 giây, đóng kết nối không pong. Rate limit mỗi kết nối: 40 message/giây (vượt thì `error rate-limit`, bỏ message).
- `setInterval` gọi `sweep()` mỗi 10 giây.
- Export `startServer({ port, ... })` trả `{ port, close() }` để test tích hợp; chỉ tự chạy khi là entry
  (`import.meta.url` khớp `process.argv[1]`).

## 6. Client

`src/net/config.js`: `serverUrl()` — ưu tiên `?server=` trên URL, rồi `localStorage['bida9-server']`, mặc định
`ws(s)://<location.host>/ws`. Chỉ nhận scheme `ws:`/`wss:`.

`src/net/client.js`: `createNetClient({ url, onMessage, onStatus })` → `{ connect(), send(obj), close(), status }`.
Trạng thái: `idle | connecting | open | reconnecting | closed`. Rớt giữa trận thì tự kết nối lại (lùi dần 1s, 2s, 4s, tối đa 8s,
tổng 60s) và gửi `rejoin` bằng `{code, token}` lưu trong `sessionStorage['bida9-room']`.

`src/features/pvp.js` (thuần):
- `mulberry32(seed)`
- `packBalls(balls, { withQuat })`, `unpackBalls(list, createBall)`
- `packMatch(state)`, `applyMatch(state, match)` — chỉ đụng các trường liệt kê ở mục 4
- `seatToWho(seat)` → `1 → 'player'`, `2 → 'bot'` (dùng lại khóa sẵn có trong `state.bot.groups` và tỉ số)
- `createShotGate()` — ghép "hoạt ảnh xong" với "đã nhận sync cùng seq": `animationDone(seq)`, `syncArrived(sync)`, gọi `onReady(sync)` đúng một lần

Tích hợp `src/app.js` (thay đổi tối thiểu, không viết lại luồng trận):
- `state.bot.matchType` thêm giá trị `'pvp'`; thêm `state.pvp = { seat, myWho, names: {player, bot}, code, connected, peerOnline, seq, waitingSync, rematch }`.
- `isPvpMode()`; `isBotTurn()` trong pvp = `state.bot.turn !== state.pvp.myWho` (tức "không phải lượt mình").
  `scheduleBotTurn()` phải thoát ngay khi pvp (không cho AI chạy).
- `botNameOf(who)` trả tên người chơi khi pvp. Ở `finishShot`, mọi nhánh chuỗi `isBvb ? ... : ...` dùng nhánh trung lập theo tên
  cho pvp (`const neutral = isBvb || isPvp`), để chuỗi gửi sang máy kia vẫn đúng. Riêng nhánh foul trong pvp: nếu người
  được đặt bi là mình thì gọi `aimAtTargetFor`.
- Không gọi `recordHeroProgress`/`isHeroWho` trong pvp.
- `doShot()` khi pvp và là lượt mình: tăng `seq`, sinh `seed`, gửi `shot`, tạo sim với `rng: mulberry32(seed)`.
- Nhận `shot`: đặt lại `state.balls` theo payload, đặt aim/power/tip/elev, chạy cùng đường `doShot` (cho phép dù không phải lượt mình), với cùng seed.
- `finishShot()` khi pvp: nếu mình là người đánh → chạy như hiện tại rồi gửi `sync` (`reason: 'result'`, kèm chuỗi toast);
  nếu không → bỏ qua phần chấm luật, báo `animationDone(seq)` cho gate; khi gate sẵn sàng thì `applyMatch` + đặt bi + toast + `syncControls()`.
- Ván mới: timer `startBotRack(rackWinner)` chỉ chạy ở chủ phòng (seat 1), xong gửi `sync` `reason: 'rack'`.
- `aim`: gửi trong `frame()`/`invalidate` khi là lượt mình, giới hạn 100 ms, chỉ khi giá trị đổi. Nhận thì đặt
  `aimMode='manual'`, `aimAngle`, `power`, `tip`, `botElevation`, vị trí bi cái, rồi `invalidate({ pred: false })`.
- Kéo bi cái (bi trong tay / phá bi) chỉ cho phép ở lượt mình (đã được `isPlayerReady()` che; kiểm tra lại đường `input.js`).
- Tia ngắm hỗ trợ trong pvp: dùng mức `botAidFor('medium')` cho cả hai, tôn trọng nút "Tia ngắm".
- `resign`: bên gửi thua trận; hiện modal thắng ở bên kia. `rematch`: cả hai đồng ý thì chủ phòng đặt lại tỉ số, `startBotRack('player')`, gửi `sync`.
- Thoát trận online (về sảnh, đổi chế độ, đóng tab `beforeunload`) gửi `leave`.

## 7. Giao diện

Sảnh (`index.html`, `#lobby`): thêm thẻ **"1 vs 1 Online"** đặt ngay sau thẻ "Bắn với Bot". `.lobby-cards` đổi sang
`grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))` để 4 thẻ không vỡ ở desktop/tablet.
- Ô tên (nhớ trong `localStorage['bida9-name']`), chọn 9 Bi / 8 Bi, chọn "Chạm".
- Nút **Tạo phòng** → trạng thái chờ: mã phòng chữ to, nút "Sao chép liên kết" (dùng `navigator.share` nếu có, không thì clipboard),
  dòng "Đang chờ đối thủ…", nút "Hủy".
- Ô nhập mã + nút **Vào phòng**. Lỗi hiện ngay dưới ô bằng tiếng Việt (không có phòng / phòng đầy / mất kết nối máy chủ).
- Liên kết mời: `…/#room=ABCDE`. `loadFromHash()` gặp `room=` thì mở sảnh, điền sẵn mã, focus ô tên. Không đụng định dạng hash chia sẻ thế bi hiện có.

Thanh chế độ trên cùng: thêm nút `data-app="pvp"` "1 vs 1". `body[data-app="pvp"]`.

Trong trận: dùng lại `#botHud` và `#tvScoreboard` với tên hai người; nhãn phụ trên bảng TV: "CHỦ PHÒNG" / "KHÁCH".
- Ẩn `.bot-controls` (Luật/Độ khó/Chạm/Trận mới) và `#bvbControls` khi pvp.
- Thêm hàng `#pvpControls`: pill kết nối (`Đã kết nối` / `Đối thủ mất kết nối – chờ 60s` / `Đang kết nối lại…`), nút "Xin thua", nút "Rời phòng" (có xác nhận).
- Pill lượt: "Lượt bạn" / "Lượt <tên>". Khi không phải lượt mình: khóa Đánh, lực, điểm chạm, xoay ngắm (dùng `panel.setTurnLocked`).
- Modal thắng: nút "Chơi lại" gửi `rematch`, hiện "Đang chờ đối thủ đồng ý…"; ẩn "Chơi tiếp (Tự do)" khi pvp.
- Phòng bị đóng (`room-closed`): toast + về sảnh.

Sửa nhanh UX (đã đo được ở bản hiện tại):
1. `assets/style.css`: thêm `[hidden] { display: none !important; }` — hiện `.bot-bvb-controls { display: flex }` đè `hidden`,
   làm nút Tạm dừng / 1x / Đổi tên của Đấu 2 Bot hiện trong Bắn với Bot. Sau khi thêm, rà lại không có phần tử nào
   dựa vào việc "hidden nhưng vẫn hiện".
2. `@media (pointer: coarse)`: `min-height: 44px` cho `.btn`, `.seg-mini button`, `select`, `.nudge`, `.lobby-game button`,
   `.lobby-diff button`, `.lobby-cta`, ô nhập trong sảnh. Kiểm tra `.view-ctl` không che bàn nhiều hơn hiện nay ở 375px (cho phép xuống dòng).
3. `.main-modes` ở màn hẹp: `overflow-x: auto`, ẩn thanh cuộn, `scroll-snap`; khi đổi chế độ gọi `scrollIntoView({ inline: 'center', block: 'nearest' })` cho nút đang chọn.
4. `index.html`: bỏ `user-scalable=no` khỏi meta viewport (giữ `touch-action` trên canvas để không zoom nhầm khi kéo).

`sw.js`: thêm các tệp `src/net/*.js`, `src/features/pvp.js` vào `SHELL`, tăng `CACHE_VERSION`; không can thiệp request tới `/ws` và `/healthz`.
Tăng `?v=` của `style.css` và `app.js` trong `index.html`.

## 8. Kiểm thử

- `tests/net/protocol.test.mjs`: message hợp lệ/không hợp lệ cho từng loại, quá cỡ, số không hữu hạn, tên bẩn, mã phòng.
- `tests/server/rooms.test.mjs` (đồng hồ giả): tạo, vào, phòng đầy, sai mã, rớt rồi rejoin trong hạn, rejoin sai token, hết hạn bị dọn, leave đóng phòng.
- `tests/server/integration.test.mjs`: `startServer({ port: 0 })`, hai client `ws`: create → join → relay hai chiều → một bên đóng → `peer-left` → rejoin → `peer-back`; message rác nhận `error`; tệp tĩnh `/index.html` trả 200, `/server/index.mjs` và `/package.json` trả 404.
- `tests/features/pvp.test.mjs`: `mulberry32` lặp lại được; pack/unpack bi; `applyMatch(packMatch(s))` giữ nguyên; `createShotGate` cả hai thứ tự đến; **tính tất định**: hai `createSim` cùng bi + cùng shot + cùng seed (kể cả cú miscue) cho vị trí cuối trùng nhau.
- `npm test` phải qua toàn bộ (test cũ + mới).

## 9. Định nghĩa hoàn thành

- `npm test` qua hết.
- `npm start` rồi mở hai tab `http://localhost:8787`: tạo phòng ở tab A, vào bằng mã ở tab B, chơi hết một ván 9 bi:
  phá bi, đổi lượt, foul → bi trong tay cho đối thủ, ăn bi 9 → sang ván mới, tỉ số hai bên giống nhau sau mỗi cú.
- Tắt tab B giữa trận rồi mở lại liên kết: trận tiếp tục đúng trạng thái.
- Các chế độ cũ chạy như trước; nút của Đấu 2 Bot không còn hiện trong Bắn với Bot.
- README có mục "1 vs 1 Online": chạy server, biến môi trường, cách deploy (một dịch vụ Node phục vụ cả web lẫn `/ws`;
  hoặc web tĩnh + server riêng qua `?server=`), giới hạn đã biết.
