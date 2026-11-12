# Ghi chú vật lý

Đơn vị: mm, giây. Mọi giá trị trong `src/core/equipment.js` là ước lượng để luyện tập, chưa xác minh.

## Cú đánh (src/core/physics.js, computeLaunch)

- Lực 0..1 = tốc độ gậy v_stick từ 0,5 đến 9 m/s.
- Tốc độ bi cái: v = (1 + e_tip) * m_cue / (m_cue + m_bi) * v_stick, m_bi = 170 g.
- Điểm chạm `tip` là độ lệch so với tâm bi, tính theo tỉ lệ bán kính R (vòng tròn đơn vị). Xoáy: spin = 2,5 * tip * v * spinEfficiency.
- Squirt: hướng xuất phát = hướng ngắm xoay một góc -squirtDegPerFullSide * tip.x (độ). Effet phải đẩy bi sang trái, nên bù bằng cách ngắm lệch phải.
- Miscue: |tip| > miscueLimit thì bi chạy 30% tốc độ, lệch ngẫu nhiên +-3 độ, không xoáy. Bản xem trước dùng góc lệch 0.

## Bàn (src/core/table.js, buildTable)

- Kích thước 7ft 1980x990, 8ft 2240x1120, 9ft 2540x1270 mm.
- Miệng lỗ = khoảng cách giữa hai đầu mút băng. Lỗ góc: đầu mút cách góc mouth/sqrt(2) dọc băng. Lỗ giữa: mouth/2 mỗi bên.
- Bán kính hút = 0,5 * mouth * pocketCaptureScale.
- Đầu mút băng là điểm chắn đối với tâm bi (khoảng cách < R thì nảy), nên khe thực cho tâm bi hẹp hơn miệng lỗ (mouth - 2R), như bàn thật.

## Ngắm tự do (src/core/geometry.js, firstHit)

Dò tia tâm bi cái theo hướng đã cộng squirt; bi đầu tiên có khoảng cách tâm 2R là bi bị chạm. Góc cắt = góc giữa tia và hướng bi mục tiêu đi; độ dày = 1 - sin(góc cắt). Băng không được xét: nếu bi cái chạm băng trước bi, ứng dụng báo "Không chạm bi nào".

## Mô hình xoáy 3D (Phase 3)

- Hệ toạ độ: x phải, y xuống, z xuống (vào mặt vải), thuận tay phải. Mỗi bi có vận tốc góc w = (wx, wy, wz) rad/s và quaternion hướng q.
- Điểm tiếp xúc r = (0,0,+R); độ trượt u = v + w × r = (vx + R·wy, vy − R·wx). Lăn thuần khi u = 0.
- Trượt: F = −μs·m·g·û; v += F/m·dt; w += (r × F)/I·dt, I = 2/5·m·R². Khi độ trượt sắp đổi dấu trong một bước thì xoá hẳn (v −= 2/7·u).
- Lăn: giảm tốc μr·g; wz tắt dần theo sideSpinDecay.
- Cú đánh: xung J dọc cơ d = (cosθ·aim, sinθ) (cơ đi xuống), điểm chạm p = R·(a·phải + b·lên' − √(1−a²−b²)·d), w = (p × J)/I · spinEfficiency. Thành phần ngang của J cho v (tốc độ không đổi theo θ), thành phần đứng bị bàn hấp thụ. θ > 0 và a ≠ 0 cho w có thành phần ngang → trượt ngang → bi cong (swerve) về phía effet.
- Throw (Giai đoạn 4): n = pháp tuyến bi 1→2, r1 = +R·n, r2 = −R·n. Vận tốc tương đối điểm tiếp xúc (3D) vrel = (v1 + w1×r1) − (v2 + w2×r2); vt = vrel − (vrel·n)n gồm cả thành phần đứng do xoáy trên/dưới. μ(|vt|) = hệ số_nhân·(a + b·exp(−c·|vt|)), |vt| theo m/s (a, b, c = ballFrictionA/B/C trong TableProfile, mặc định 0,01 / 0,108 / 1,088: **[Unverified]** ước lượng một đường khớp đã công bố). Xung Jt = min(μ·Jn, m·|vt|/7) theo −v̂t. Lên vận tốc thẳng chỉ áp phần nằm ngang (phần đứng do bàn hấp thụ, không có nảy bi); lên vận tốc góc áp đủ 3D: w1 += (r1 × F)/I, w2 += (r2 × −F)/I. Hệ quả: throw giảm khi tốc độ tăng, và giảm khi bi cái lăn/kéo (vt nghiêng lên phương đứng nên phần nằm ngang nhỏ lại). Thời điểm va chạm được tính lại trong bước (lùi hai bi về lúc cách nhau đúng 2R).
- Băng: xoáy lăn có thành phần pháp tuyến bị đảo và giảm; effet wz đẩy bi dọc băng và giảm một nửa.
- Quaternion: q ← dq(w·dt)·q (bước trục-góc chính xác), chuẩn hoá mỗi bước. Số, sọc, chấm đỏ là đặc trưng gắn vào thân bi, chiếu trực giao lên màn hình.

## Bộ giải ngắm bù (src/core/aim-solver.js)

solveAim bắt đầu từ đường bi ma, mô phỏng từ lúc đánh đến lần chạm bi đầu tiên + 50 ms, đo sai lệch hướng bi mục tiêu so với đường tới lỗ, rồi dò nghiệm theo góc ngắm bằng phương pháp cát tuyến (±8°, ≤ 12 vòng, dung sai 0,02°). Các thành phần: squirt = góc xoay hướng xuất phát; cong = góc giữa hướng xuất phát và hướng từ điểm đầu tới tâm bi cái lúc chạm; throw = góc giữa hướng bi mục tiêu và đường nối tâm lúc chạm. Dấu + = lệch sang phải hướng bi đi (xoay cùng chiều kim đồng hồ trên màn hình). Bảng thông tin hiện squirt+cong (độ lệch bi cái) và throw (bi mục tiêu) ở hai dòng riêng; "Ngắm bù" là góc xoay ngắm thực sự, một kết quả tổng hợp — không bằng tổng các góc thành phần.

## Giới hạn

Không có bi nhảy / massé mạnh, throw chỉ phụ thuộc tốc độ trượt (không có độ bẩn/phấn), giới hạn dính |vt|/7 dùng chung cho cả phương đứng (gần đúng), squirt tuyến tính, lỗ không có má cong. Đường kính đầu cơ, độ cứng đầu cơ và loại ngọn chỉ để ghi nhớ trong giao diện.
