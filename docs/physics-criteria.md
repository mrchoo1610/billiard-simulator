# Tiêu chí vật lý bida (pool) — danh sách kiểm thử

> Giá trị kỳ vọng lấy từ mô hình lý thuyết chuẩn (quả cầu đặc, ma sát Coulomb) và các số liệu phổ biến trong tài liệu bida.
> **[Unverified]** Các khoảng số đo thực tế (throw, squirt, băng) là ước lượng từ kiến thức nền, chưa đối chiếu nguồn trong dự án này.
> **Bản 2 (sau Giai đoạn 3):** B3/B5/B6/D2 tính kỳ vọng theo hệ số phục hồi thật (e < 1) thay vì lý tưởng e = 1; B4 dùng khoảng kinh nghiệm; B11/B12/D4 có ngưỡng định lượng.
> Cột "Trạng thái" do `scripts/physics-audit.mjs` điền: ĐẠT / MỘT PHẦN / KHÔNG ĐẠT / CHƯA HỖ TRỢ.

## A. Chuyển động bi trên mặt bàn

| ID | Hiệu ứng | Kỳ vọng (tiêu chí) | Cách test | Dung sai |
|---|---|---|---|---|
| A1 | Trượt → lăn (bi đánh giữa) | Vận tốc khi bắt đầu lăn = 5/7·v0 | Đánh giữa, đo v lúc slip≈0 | ±2 % |
| A2 | Quãng trượt | d = 12·v0² / (49·μs·g) | Đo quãng đến lúc lăn | ±5 % |
| A3 | Quãng lăn đến khi dừng | d = v² / (2·μr·g) | Bi lăn thuần, đo quãng dừng | ±5 % |
| A4 | Xoáy trên/dưới khi đánh | Đánh cao → bi tăng tốc nhẹ sau trượt; đánh thấp → giảm tốc nhanh hơn rồi lăn | So v lăn với 5/7·v0 | đúng chiều |
| A5 | Xoáy ngang suy giảm | Side spin giảm dần, không đổi hướng đường đi khi nâng cơ = 0 | Đánh má phê, θ=0 | lệch ngang < 1 mm/1 m (ngoài squirt) |

## B. Va chạm bi – bi

| ID | Hiệu ứng | Kỳ vọng | Cách test | Dung sai |
|---|---|---|---|---|
| B1 | Đánh dừng (stun) thẳng | Bi cái dừng tại điểm chạm | Stun, chạm gần | v_cue sau < 3 % v0 |
| B2 | Hệ số phục hồi bi–bi | Bi mục tiêu nhận ≈ (1+e)/2·v, e ≈ 0.93–0.98 | Đo v bi mục tiêu ngay sau chạm | trong khoảng |
| B3 | Quy tắc 90° (stun cắt), có tính e | Lệch so với tiếp tuyến ≈ atan(((1−e)/2)·cosα / sinα) (e = hệ số phục hồi bi–bi của bàn) | Cắt 15°/30°/45°, stun | ±2° so với giá trị tính theo e |
| B4 | Quy tắc 30° (bi lăn, cắt 1/4–3/4) | Góc lệch bi cái 27°–34° (quy tắc kinh nghiệm ~30°; công thức lý tưởng e=1 cho 33.7° chỉ ghi để tham khảo) | Bi lăn cắt 1/4, 1/2, 3/4 bi, đo hướng sau khi lăn lại | trong khoảng |
| B5 | Bi theo thẳng, có tính e | v cuối / v trước = (5·(1−e)/2 + 2)/7 (e=1 → 2/7) | Bi lăn, chạm thẳng | ±3 % |
| B6 | Bi kéo thẳng, có tính e | Bi cái quay ngược, v cuối = (5·v_sau + 2·R·ω)/7 với v_sau = (1−e)/2·v_trước | Đánh thấp, chạm thẳng | đúng chiều, ±5 % |
| B7 | Đường cong bi cái sau va chạm | Bi theo/kéo cắt góc → đường cong parabol, không gãy khúc | Kiểm tra độ cong của path | có cong |
| B8 | Bi mục tiêu trượt rồi lăn | Bi mục tiêu sau va chạm lăn ở 5/7 vận tốc ban đầu | Đo | ±3 % |
| B9 | Throw do cắt (CIT) | Bi mục tiêu bị kéo theo hướng bi cái trượt ngang (cắt mỏng hơn dự kiến), lớn nhất gần 1/2 bi, ~1–5° khi đánh chậm stun | Stun cắt 30°, đo lệch so với đường nối tâm | 0.5–5° và đúng chiều |
| B10 | Throw do má phê (SIT) | Má trái → bi mục tiêu lệch phải và ngược lại | Chạm thẳng + má phê | đúng chiều, 1–5° |
| B11 | Throw giảm khi đánh mạnh | Throw ở 5 m/s ≤ 0.6 × throw ở 1 m/s (stun cắt 30°) | So 1 m/s và 5 m/s | tỉ lệ ≤ 0.6 |
| B12 | Throw giảm khi bi cái lăn (theo/kéo) | CIT khi bi lăn (và khi kéo mạnh) ≤ 0.8 × CIT khi stun, cùng tốc độ | So stun / lăn / kéo, cắt 30° | tỉ lệ ≤ 0.8 |
| B13 | Truyền xoáy sang bi mục tiêu | Bi mục tiêu nhận một ít side spin ngược chiều | Đo w.z bi mục tiêu | có, đúng chiều |
| B14 | Bi chạm nhau liên tiếp (combo/cụm) | Không xuyên bi, bảo toàn động lượng | Combo 3 bi thẳng hàng | không chồng bi |

## C. Gậy và điểm chạm

| ID | Hiệu ứng | Kỳ vọng | Cách test | Dung sai |
|---|---|---|---|---|
| C1 | Squirt | Má phải → bi cái lệch trái so với đường ngắm; ngọn LD/carbon lệch ít hơn ngọn thường | Đánh má phê θ=0 | đúng chiều + thứ tự |
| C2 | Swerve (cong do nâng cơ) | Nâng cơ + má phải → bi cong về phải (ngược squirt); θ=0 → không cong | θ=15°, đo độ lệch ngang theo thời gian | đúng chiều, tăng theo θ |
| C3 | Trượt cơ (miscue) | Điểm chạm vượt giới hạn → bi yếu, lệch, không xoáy | tip > limit | đúng |
| C4 | Khối lượng gậy | Gậy nặng → bi nhanh hơn cùng tốc độ vung | So 539 g vs 595 g | nhanh hơn |
| C5 | Xoáy tối đa hợp lý | Đánh thấp tối đa không làm bi quay ngược nhanh hơn ~2.5·v·b/R | Đo ω sau đánh | đúng công thức |

## D. Băng và lỗ

| ID | Hiệu ứng | Kỳ vọng | Cách test | Dung sai |
|---|---|---|---|---|
| D1 | Phục hồi băng | Vận tốc pháp tuyến sau băng ≈ 0.7–0.85 trước | Đánh vuông góc vào băng | trong khoảng |
| D2 | Góc phản xạ không xoáy, có tính e băng | tan(góc ra) ≈ e_băng·tan(góc vào) (bi bật ra ngắn hơn) | 45°, bi lăn | ±3° |
| D3 | Má phê xuôi/ngược ở băng | Má xuôi (running) → góc ra mở rộng; má ngược → góc ra hẹp | So 3 trường hợp | đúng thứ tự |
| D4 | Xoáy trên/dưới qua băng | Sau khi bật băng: bi theo cong về phía băng (góc với băng giảm dần); bi kéo cong ra xa băng (góc tăng dần) | Đo góc với băng tại 0.05 s và 0.35 s sau chạm | đúng chiều cả hai |
| D5 | Lỗ: bi chạm mép lỗ (jaw) | Bi vào lỗ góc khi lệch nhỏ; đi sát băng vào lỗ được; bị bật ra khi lệch lớn | Lệch 0/20/50 mm | đúng |
| D6 | Lỗ giữa khó hơn khi góc lớn | Bi vào lỗ giữa góc > ~60° bị từ chối | Góc 30° vs 70° | đúng |

## E. Ngoài phạm vi mô hình hiện tại (CHƯA HỖ TRỢ, liệt kê để biết)
- Bi nhảy (jump shot), massé mạnh
- Bi bẩn / phấn trên bi (kick/skid)
- Mặt bàn nghiêng (table roll), vải mòn theo hướng
- Bi lắc trong miệng lỗ (rattle)
- (Ma sát bi–bi phụ thuộc tốc độ: đã được hỗ trợ từ Giai đoạn 4, xem B11/B12.)
