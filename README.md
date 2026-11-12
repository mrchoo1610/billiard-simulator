# Bida 9 bi – Tập luyện

Ứng dụng web (PWA) giúp tập bida 9 bi: đặt bi cái và bi mục tiêu, xem **bi ma (ghost ball)**, **góc cắt**, **độ dày**,
đường đi dự đoán, rồi đánh thử với lực và điểm chạm (spin) tùy chọn. Viết bằng JavaScript thuần (ES modules),
không cần build, không có thư viện ngoài. Giao diện ưu tiên điện thoại (bàn xoay dọc khi màn hình dọc), dùng được trên máy tính.

## Chạy trên máy

Cần một máy chủ tĩnh bất kỳ (ES modules không chạy được qua `file://`):

```bash
cd billiard-simulator
python -m http.server 8765
```

Mở `http://localhost:8765`.

### Mở trên điện thoại (cùng Wi-Fi)

1. Tìm IP LAN của máy tính (`ipconfig` trên Windows, ví dụ `192.168.1.20`).
2. Chạy máy chủ như trên (cho phép Python qua tường lửa nếu được hỏi).
3. Trên điện thoại mở `http://<IP-LAN>:8765`.

Lưu ý: Service worker / "Thêm vào màn hình chính" chỉ hoạt động qua HTTPS hoặc `localhost`; qua `http://<IP-LAN>` ứng dụng vẫn chạy bình thường nhưng không cài được như PWA.

## Triển khai

Đây là site tĩnh, chỉ cần đưa toàn bộ thư mục (trừ `tests/`, `docs/`) lên:

- **GitHub Pages**: đẩy lên repo, vào *Settings → Pages*, chọn nhánh và thư mục gốc. Mọi đường dẫn đều tương đối nên chạy được trong thư mục con.
- **Netlify**: kéo-thả thư mục vào Netlify Drop, hoặc kết nối repo (build command để trống, publish directory là `.`).

Khi sửa file, tăng `CACHE_VERSION` trong `sw.js` để người dùng nhận bản mới.

## Cấu trúc thư mục

```
index.html          giao diện (giữ ở thư mục gốc)
sw.js               service worker (phải ở thư mục gốc để có scope toàn site)
package.json        lệnh npm test
assets/             style.css, icon.svg, manifest.webmanifest
src/app.js          trạng thái + nối các phần với nhau
src/core/           vec, table, geometry, physics, aim-solver, equipment (thuần, không DOM)
src/ui/             render, input, panel, settings, keyboard, render3d (three.js), view3d-math
assets/vendor/three three.js r164 (MIT)
src/features/       drills, share
tests/core/         *.test.mjs (node --test)
docs/               physics-notes.md
```

## Cách dùng

- **Kéo** bi để di chuyển. **Chạm** bi để chọn bi mục tiêu; **chạm vào lỗ** để chọn lỗ (mặc định tự chọn lỗ tốt nhất).
- **Lực**: thanh trượt = tốc độ gậy (0,5–9 m/s); **Điểm chạm**: vòng tròn mô phỏng mặt bi cái (trên = đẩy/follow, dưới = kéo/draw, trái/phải = effet). Vòng đỏ nét đứt là giới hạn trượt cơ (miscue) của gậy đang chọn. Chạm đúp để về giữa.
- **Ngắm**: "Tự động" ngắm bi ma tới bi mục tiêu/lỗ, có **Lệch ngắm** ±5°. Kéo trên nền bàn trống (không trúng bi) hoặc bấm ◀◀ ◀ ▶ ▶▶ (±1° / ±0,1°, giữ để lặp) sẽ chuyển sang **Tự do**: xoay hướng ngắm quanh bi cái (kéo càng xa càng mịn), ứng dụng dò tia để tìm bi chạm đầu tiên và hiện góc cắt/độ dày; không chạm bi nào thì báo "Không chạm bi nào". Gậy được vẽ phía sau bi cái, lùi theo lực. Chế độ Tự do chỉ dùng ở "Tự do" và "Điều bi cái".
- **Nâng cơ** (0–30°, mặc định 5°, chỉ chỉnh được ở chế độ Tự do; các bài tập cố định 5°): nâng đuôi cơ. Khi có effet trái/phải, bi cái sẽ **cong (swerve)** về phía effet sau khi bị squirt; nâng cơ 0° thì bi đi thẳng.
- **Tự bù effet** (mặc định bật ở "Tự do" và "Điều bi cái"; tắt ở "Bù squirt" và "Đoán độ dày"): ngắm tự động dò bằng chính bộ mô phỏng (tối đa ±8°, dừng mỗi lần thử ngay sau lần chạm bi đầu tiên + 50 ms) để tìm hướng ngắm đưa bi mục tiêu về lỗ, bù **squirt + cong + throw**. Bảng thông tin hiện "Ngắm bù effet: x,xx° phải/trái" (so với đường bi ma) và "Lệch bi cái (squirt · cong)" và "Throw bi mục tiêu" (góc từng hiệu ứng; + = lệch sang phải hướng bi đi; "–" khi không áp dụng). "Ngắm bù" là kết quả tổng hợp, không phải tổng cộng các góc. Không áp dụng ở chế độ ngắm Tự do (xoay tay). Kết quả được lưu đệm theo trạng thái và giới hạn tần suất tính (~90 ms) để mượt trên điện thoại.
- **Bi lăn**: số, sọc bi 9 và hai chấm đỏ trên bi cái quay theo chuyển động thật (mô hình xoáy 3D + quaternion), nên thấy rõ bi trượt / lăn / xoáy tại chỗ. Đường đi (dự đoán và vệt khi bi đang chạy) tô **cam khi bi đang trượt**, **trắng/màu bi khi đang lăn**; vòng tròn nhỏ đánh dấu nơi bi bắt đầu **lăn tự nhiên**.
- **Đánh** để mô phỏng; **Đặt lại** trả bi về vị trí trước cú đánh.
- **Ngẫu nhiên**, **Xếp 9 bi** (hình thoi, bi 1 ở đỉnh, bi 9 ở giữa), **Chia sẻ** (sao chép liên kết chứa vị trí bi, bàn `tb=`, gậy `cu=`, góc ngắm `a=` trong `#hash`).
- Chế độ **Đoán độ dày**: đoán Đầy / 3/4 / 1/2 / 1/4 / 1/8 / Lướt, rồi xem đáp án và cú đánh tự chạy.
- Chế độ **Điều bi cái**: đánh bi vào lỗ và để bi cái dừng trong vòng vàng (bán kính 150 mm).
- Chế độ **Bù squirt**: bài đánh với effet; chỉnh Lệch ngắm để bù squirt của gậy, tính điểm theo vào lỗ. "Gợi ý" cho biết góc cần bù.
- Luật 9 bi: bi cái phải chạm bi số nhỏ nhất trước, nếu không báo "Chạm sai bi trước".
- Điểm và thiết bị đã chọn được lưu trong `localStorage`.

### Điều khiển bằng bàn phím

Dành cho máy tính (bấm **H** hoặc **?** để xem bảng trợ giúp ngay trong ứng dụng). Trên máy tính có thêm bảng HUD ở góc bàn (lực, góc ngắm, điểm chạm, nâng cơ), nhãn giá trị hiện thoáng qua khi đổi và dòng gợi ý phím (bấm × để ẩn, được nhớ lại). Giao diện điện thoại không đổi.

| Phím | Tác dụng |
|---|---|
| ← / → | Xoay hướng ngắm 0,1° (Shift 1°, Alt 0,02°); tự chuyển sang ngắm Tự do |
| ↑ / ↓ | Lực ±1 % (Shift ±5 %) |
| Ctrl + mũi tên, hoặc W A S D | Dời điểm chạm trên bi cái: ← trái, ↑ cao (follow), ↓ thấp (draw); bước 0,05 (Shift 0,1). Dừng ở vòng trượt cơ; nhấn thêm một lần để vượt qua |
| C | Điểm chạm về giữa |
| Space | Đánh; khi bi đang chạy: tua nhanh ×4 (bấm lại để về tốc độ thường) |
| PageUp / PageDown | Nâng cơ ±1° (chế độ Tự do) |
| Tab / Shift + Tab | Bi mục tiêu tiếp theo / trước đó (chế độ Tự do; chuyển về ngắm Tự động) |
| 1 – 9 | Chọn bi đó làm mục tiêu nếu còn trên bàn |
| P / Shift + P | Lỗ tiếp theo / về tự chọn lỗ |
| M | Chuyển ngắm Tự động / Tự do |
| R · N · F | Đặt lại · Ngẫu nhiên · Bật/tắt dự đoán đường đi |
| H hoặc ? | Hiện/ẩn trợ giúp |
| Esc | Đóng trợ giúp / bảng Thiết bị |
| Lăn chuột trên bàn | Xoay hướng ngắm 0,1° mỗi nấc (Shift 1°) (ở góc nhìn 3D: zoom) |
| V · K | Góc nhìn 2D/3D · Chế độ camera 3D (Tự động / Cố định / Theo bi cái) |
| `[` `]` · `-` `=` | Camera 3D: độ cao mắt · khoảng cách (Shift bước lớn) |

Giữ phím để lặp (sau 250 ms, mỗi 40 ms); giữ hơn 1 giây thì bước nhân ×5 (ngắm) / ×3 (lực). Phím không hoạt động khi đang gõ trong ô nhập hoặc khi bảng Thiết bị đang mở; Ctrl + chữ (Ctrl+R, Ctrl+C...) luôn dành cho trình duyệt. Khi bi đang chạy chỉ có Space, H, Esc.

### Góc nhìn 3D

Nút **Góc nhìn 2D | 3D** ở góc trên bên phải bàn (hoặc phím **V**) chuyển sang góc nhìn 3D "Mắt cơ thủ" dựng bằng three.js: bàn 7/8/9 ft theo thiết bị đã chọn, băng và lỗ theo đúng hình học vật lý, bi có số/vạch/chấm đỏ xoay đúng theo mô phỏng, ánh sáng đèn bida và bóng đổ, gậy với đầu gậy chạm đúng điểm chạm (effet) và nâng cơ. Đường ngắm, bi ma, tiếp tuyến, đường dự đoán... vẫn theo các ô chọn trong "Hiển thị". Lựa chọn 2D/3D được nhớ lại. three.js chỉ được tải lần đầu mở 3D ("Đang tải 3D…"); nếu thiết bị không có WebGL sẽ báo "Thiết bị không hỗ trợ 3D" và ở lại 2D.

| Thao tác | Tác dụng |
|---|---|
| Kéo ngang (chuột trái / một ngón) | Xoay hướng ngắm (chuyển sang ngắm Tự do) |
| Lăn chuột / chụm hai ngón, hoặc phím `-` `=` | Lùi xa / tiến gần bi cái (0,25 – 2 m) |
| Chuột phải kéo dọc / hai ngón kéo dọc, hoặc phím `[` `]` | Hạ / nâng độ cao mắt (6 – 80 cm) |
| Chạm bi (chế độ Tự do) | Chọn làm bi mục tiêu |
| Bản đồ nhỏ ở góc dưới | Chạm để về 2D (đặt bi vẫn làm ở 2D) |
| **K** hoặc nút Camera | Tự động → Cố định → Theo bi cái |

Camera **Tự động** (mặc định): lúc ngắm ở sau bi cái; khi đánh giữ nguyên góc nhìn trong lúc vung gậy và thêm ~250 ms rồi chuyển mượt (~0,6 s) lên góc nhìn từ trên xuống thấy cả bàn (trục dài khớp cạnh dài của màn hình); khi các bi dừng chờ 300 ms rồi trở về sau bi cái (bi cái xuống lỗ: ở lại góc trên cao lâu hơn để thấy bi được đặt lại). Mọi thao tác xoay ngắm / kéo / zoom bỏ qua hiệu ứng chuyển. **Cố định**: giữ góc nhìn lúc đánh rồi trở về sau bi cái. **Theo bi cái**: bám bi cái theo hướng đi. Mục **Chất lượng 3D** (Cao / Thấp): Thấp tắt bóng đổ và giảm độ phân giải (mặc định Thấp trên màn hình cảm ứng).

Mã nguồn 3D: `src/ui/render3d.js` (tải lười), phần tính toán thuần có kiểm thử `src/ui/view3d-math.js`. Thư viện **three.js r164** (MIT, © 2010-2024 three.js authors) nằm sẵn trong `assets/vendor/three/` kèm tệp `LICENSE`; không dùng CDN.

### Chọn bàn và gậy (Thiết bị)

Bấm nút trên thanh đầu trang (ví dụ "Bàn: Club 9ft · Gậy: Fury TK-03") để mở bảng **Thiết bị**:

- Tab **Bàn**: Pro 9ft (vải nhanh, lỗ hẹp), Club 9ft (mặc định), Quán 7ft (vải chậm, lỗ rộng), Tuỳ chỉnh. Đổi kích thước bàn (7/8/9 ft) sẽ co giãn vị trí bi theo tỉ lệ. Miệng lỗ quyết định khe hở trên băng và bán kính hút của lỗ.
- Tab **Gậy**: Gậy thường, Ngọn LD, Ngọn carbon, Gậy phá bi và **Gậy của tôi** (mặc định tên "Fury TK-03", mặc định gậy được chọn).
- Mục **Nâng cao** có thanh trượt cho mọi thông số. Sửa gậy có sẵn sẽ tạo bản nháp, bấm **Lưu thành gậy của tôi** để giữ lại (đổi tên được).
- Mọi thông số là **ước lượng để luyện tập**, không phải số đo thực tế. Thông số Fury TK-03 lấy từ cửa hàng bán lẻ, chưa xác minh với hãng.
- Thông tin cú đánh hiện "Bù squirt: x,x°" khi có effet; đường cam nét đứt là đường bi cái thực tế sau squirt, đường trắng là đường ngắm.

## Kiểm thử

```bash
npm test
```

(chạy `node --test "tests/core/*.test.mjs"`; với Node 24, `node --test tests/` không chạy được vì coi `tests` là một module.)

## Giới hạn của mô hình vật lý

- **Throw** (bi–bi): ma sát Coulomb phụ thuộc tốc độ trượt tiếp xúc, μ(v) = a + b·exp(−c·v) (mặc định a=0,01, b=0,108, c=1,088, v tính bằng m/s; **ước lượng, chưa xác minh**; chỉnh được ở Bàn → Nâng cao, "Ma sát bi–bi" là hệ số nhân). Vận tốc tương đối của hai điểm tiếp xúc tính theo 3D (có cả xoáy trên/dưới nên trượt theo phương đứng): throw giảm khi đánh mạnh và khi bi cái lăn/kéo. Xung ma sát chỉ tác dụng nằm ngang lên vận tốc thẳng (phần đứng do bàn hấp thụ), đủ 3D lên vận tốc góc. Không phụ thuộc độ bẩn của bi.
- **Squirt** là mô hình đơn giản (góc lệch tuyến tính theo độ lệch effet, không phụ thuộc lực). **Swerve** chỉ xuất hiện do nâng cơ + effet (tính từ xoáy 3D và ma sát vải), không có massé mạnh và **không có bi nhảy (jump shot)**: phần xung theo phương đứng coi như bàn hấp thụ. Effet còn ảnh hưởng khi va băng.
- Va chạm bi–bi: khối lượng bằng nhau, hệ số phục hồi 0,95, xoáy ngang (hướng lăn) giữ nguyên (tạo ra hiệu ứng follow/draw tự nhiên), xoáy trục đứng đổi theo ma sát bi–bi. Thời điểm va chạm được nội suy trong bước thời gian để hướng bi không bị nhiễu theo tốc độ.
- **Tự bù effet** dựa trên chính bộ mô phỏng nên bù đúng theo mô hình này, không phải theo bàn thật; bù tối đa ±8°, thất bại nếu bi cái chạm băng/bi khác trước bi mục tiêu.
- Va băng đơn giản hóa (hệ số theo bàn, effet làm đổi góc nảy); không mô phỏng mũi băng hay độ nảy khi bi bay. Hai đầu mút băng ở miệng lỗ là điểm chắn: bi chạm vào sẽ nảy ra.
- **Lỗ đơn giản hóa**: khe hở và bán kính hút suy ra từ độ rộng miệng lỗ, không có má lỗ (jaw) cong; bi lăn sát băng qua miệng lỗ có thể không rơi.
- Đường "lăn ~30°" chỉ là **xấp xỉ** của quy tắc 30°.
- Ma sát trượt/lăn là hằng số theo bàn, không tính độ mòn vải hay nhiệt độ. Mọi thông số bàn/gậy là ước lượng. Xem `docs/physics-notes.md`.
