# Báo cáo kiểm tra vật lý (physics audit)

Sinh bởi `scripts/physics-audit.mjs` (chạy: `npm run audit`) vào 2026-11-17. Tiêu chí: `docs/physics-criteria.md`.
Thiết bị đo: bàn Club 9ft, gậy mặc định (Gậy thường) trừ khi ghi chú khác; các thông số là ước lượng, **không được chỉnh để đạt tiêu chí**.
Quy ước trạng thái: ĐẠT = trong dung sai của tiêu chí; MỘT PHẦN = trong 2× dung sai hoặc đúng chiều nhưng chưa kiểm hết; KHÔNG ĐẠT = ngoài khoảng đó hoặc sai chiều; CHƯA HỖ TRỢ = ngoài phạm vi mô hình (mục E).
Giá trị kỳ vọng trong tiêu chí là **[Unverified]** (xem đầu `physics-criteria.md`, Bản 2). Kỳ vọng phụ thuộc e dùng E_BALL của engine và `cushionRestitution` của bàn đang đo.

## Tóm tắt

ĐẠT: 26 · MỘT PHẦN: 4 · KHÔNG ĐẠT: 1 · CHƯA HỖ TRỢ: 2 (tổng 33)

Không đạt: B5
Một phần: B4, B6, B8, B10

## Chi tiết

| ID | Hiệu ứng | Kỳ vọng | Đo được | Trạng thái | Ghi chú |
|---|---|---|---|---|---|
| A1 | Trượt → lăn (bi đánh giữa) | v lăn = 5/7·v0 (±2 %) | v0=1796 mm/s; v lăn=1283; tỉ lệ=0,7141 (5/7=0,7143) | **ĐẠT** |  |
| A2 | Quãng trượt | d = 12·v0²/(49·μs·g) (±5 %) | đo=404,5 mm; lý thuyết=402,6 mm; sai lệch=0,46 % | **ĐẠT** |  |
| A3 | Quãng lăn đến khi dừng | d = v²/(2·μr·g) (±5 %) | đo=636,6 mm; lý thuyết=637,1 mm; sai lệch=-0,08 % | **ĐẠT** |  |
| A4 | Xoáy trên/dưới khi đánh | cao: v lăn > 5/7·v0 (tăng tốc); thấp: v lăn < 5/7·v0 | cao 50 %: v lăn/v0=1,036; thấp 50 %: 0,393 (5/7=0,714) | **ĐẠT** |  |
| A5 | Xoáy ngang suy giảm (θ=0) | wz giảm dần; lệch ngang < 1 mm/1 m (không squirt) | lệch ngang tại 1 m=0,000 mm; wz(1 s)/wz(0)=0,632 | **ĐẠT** | squirt=0 để cô lập; tốc độ ban đầu 2022 mm/s |
| B1 | Đánh dừng (stun) thẳng | v bi cái sau chạm < 3 % v0 | v_cue sau/v_cue trước=2,35 % (v0=2248 mm/s) | **ĐẠT** | Còn lại 2,5 % là do e=0,95: (1−e)/2 |
| B2 | Hệ số phục hồi bi–bi | e hiệu dụng 0,93–0,98 | v_obj/v_cue=0,9736; e=0,9472 | **ĐẠT** |  |
| B3 | Quy tắc 90° (stun cắt), có tính e | lệch so với tiếp tuyến = atan(((1−e)/2)·cosα/sinα), e=0.95 (±2°) | 15°: đo 5,63° / lý thuyết 5,33° (sai 0,30°); 30°: đo 2,60° / lý thuyết 2,48° (sai 0,13°); 45°: đo 1,49° / lý thuyết 1,43° (sai 0,06°) | **ĐẠT** | e bi–bi là hằng số của engine (E_BALL), không nằm trong TableProfile |
| B4 | Quy tắc 30° (bi lăn, cắt 1/4–3/4 bi) | góc lệch bi cái 27°–34° (khoảng kinh nghiệm) | 25 % bi (cắt 48,6°): 26,92°; 50 % bi (cắt 30,0°): 33,35°; 75 % bi (cắt 14,5°): 27,39° | **MỘT PHẦN** | MỘT PHẦN = lệch ra ngoài khoảng ≤ 2°; công thức lý tưởng e=1 (33,7°) chỉ để tham khảo |
| B5 | Bi theo thẳng, có tính e | v cuối/v trước = (5·(1−e)/2+2)/7 = 0,3036 với e=0.95 (±3 %) | v cuối/v trước=0,2808; sai lệch=-7,49 % | **KHÔNG ĐẠT** | Lý thuyết bỏ qua ma sát bi–bi theo phương đứng (xoáy trên bị bào mòn nhẹ khi chạm) |
| B6 | Bi kéo thẳng, có tính e | v cuối = (5·v_sau + 2·R·ω)/7, v_sau=(1−e)/2·v_trước (e=0.95); ngược chiều, ±5 % | R·ω trước=-2043 mm/s; v_sau=56; v cuối=-507; kỳ vọng=-544; tỉ lệ=0,933 | **MỘT PHẦN** | Lý thuyết bỏ qua ma sát bi–bi theo phương đứng (làm giảm xoáy lùi khi chạm) |
| B7 | Đường cong bi cái sau va chạm (bi theo cắt) | có cong (tổng đổi hướng > 3°), không gãy khúc (bước < 3°) | tổng đổi hướng=19,38°; bước lớn nhất=1,30° | **ĐẠT** |  |
| B8 | Bi mục tiêu trượt rồi lăn | v lăn = 5/7·v sau va chạm (±3 %) | v sau chạm=1819; v lăn=1236; tỉ lệ=0,6797 | **MỘT PHẦN** |  |
| B9 | Throw do cắt (CIT) | lệch về phía hướng bi cái đi, 0,5–5° (stun cắt 30°) | lệch so với đường nối tâm=-1,64° (− = về phía đường ngắm) | **ĐẠT** |  |
| B10 | Throw do má phê (SIT) | má trái → bi mục tiêu lệch phải (+y), má phải → lệch trái; 1–5° | má trái 50 %: 0,73°; má phải 50 %: -0,73° | **MỘT PHẦN** | Squirt=0 để cô lập throw |
| B11 | Throw giảm khi đánh mạnh | throw(5 m/s) ≤ 0,6 × throw(1 m/s) (stun cắt 30°) | ~1 m/s: 4,09° (v chạm 951); ~5 m/s: 0,98° (v chạm 4990); tỉ lệ=0,240 | **ĐẠT** | MỘT PHẦN = tỉ lệ ≤ 0,7. Ma sát bi–bi μ(v)=a+b·exp(−c·v) theo tốc độ trượt tiếp xúc |
| B12 | Throw giảm khi bi cái lăn / kéo | CIT (lăn) và CIT (kéo) ≤ 0,8 × CIT (stun), cùng tốc độ, cắt 30° | stun: 4,05°; bi lăn: 1,86° (tỉ lệ 0,458); kéo: 1,88° (tỉ lệ 0,463); v chạm stun/lăn/kéo=548/623/548 mm/s | **ĐẠT** | MỘT PHẦN = tỉ lệ xấu nhất ≤ 0,9 |
| B13 | Truyền xoáy sang bi mục tiêu | bi mục tiêu nhận side spin ngược chiều bi cái | wz bi cái trước chạm=106,6 rad/s; wz bi mục tiêu sau chạm=-2,7 rad/s | **ĐẠT** |  |
| B14 | Combo / cụm bi thẳng hàng | không chồng bi (khoảng cách ≥ 2R), bảo toàn động lượng | khoảng cách nhỏ nhất=57,150 mm (2R=57,150); động lượng sau chuỗi/ngay sau chạm đầu=1,0000 | **ĐẠT** | So sánh tổng vx ngay sau lần chạm 1 với ngay sau lần chạm 3 (bỏ qua ma sát vải giữa hai lần) |
| C1 | Squirt | má phải → lệch trái (y<0); \|thường\| > \|LD\| > \|carbon\| | thường=-1,50°; LD=-0,90°; carbon=-0,60° | **ĐẠT** | Góc đo từ vị trí bi sau 0,5 s so với điểm xuất phát |
| C2 | Swerve (nâng cơ + má phải) | θ=0: không cong; θ>0: cong về phải (+), tăng theo θ | độ lệch ngang so với hướng xuất phát: θ0=-0,00; θ5=67,16; θ15=204,69; θ25=360,80 mm | **ĐẠT** |  |
| C3 | Trượt cơ (miscue) | tip > giới hạn → 30 % tốc độ, ≤ 3° lệch, không xoáy | miscue=true; tốc độ=30,0 %; lệch=3,00°; \|w\|=0,000 | **ĐẠT** |  |
| C4 | Khối lượng gậy | gậy nặng → bi nhanh hơn | 539 g: 3962 mm/s; 595 g: 4053 mm/s | **ĐẠT** |  |
| C5 | Xoáy tối đa hợp lý | R·\|ω\| ≤ 2,5·v·b (b = độ lệch điểm chạm) | R\|ω\|/(2,5·v·b) tại θ=0/5/15°: 0,900 / 0,903 / 0,932 (spinEfficiency=0.9) | **ĐẠT** | Tại θ>0 ω lớn hơn 1/cosθ lần vì xung J được nhân 1/cosθ để giữ nguyên tốc độ ngang |
| D1 | Phục hồi băng | v pháp tuyến sau/trước 0,70–0,85 | đo=0,7497 (profile club-9ft: 0.75) | **ĐẠT** |  |
| D2 | Góc phản xạ không xoáy, có tính e + ma sát băng (45°, bi lăn) | v_n' = e·v_n; v_t' = v_t − min(μ_băng·(1+e)·v_n, (1+sinφ)·v_t/3,5) → 49,52° với e=0.75, μ_băng=0.25 (±3°) | góc ra so với băng=49,52° (vào 45°) ngay sau chạm; sai=0,00° | **ĐẠT** |  |
| D3 | Má phê xuôi/ngược ở băng | vận tốc dọc băng: xuôi > không effet > ngược | vx/vy sau băng: xuôi=1,170; không=0,853; ngược=0,750 | **ĐẠT** | xuôi = má phải khi bi chạy +x dọc băng trên |
| D4 | Xoáy trên/dưới qua băng | theo: góc với băng giảm dần (0,05 s → 0,35 s); kéo: góc tăng dần | theo: 46,54° → 45,11° (đúng chiều); kéo: 46,07° → 51,94° (đúng chiều) | **ĐẠT** |  |
| D5 | Lỗ góc: lệch mép lỗ | lệch 0/20 mm vào, 50 mm bị bật ra; đi sát băng vào được | lệch 0: vào; 20: vào; 50: không; sát băng: vào | **ĐẠT** |  |
| D6 | Lỗ giữa khó hơn khi góc lớn | góc 30° vào; góc 70° bị từ chối | 30°: vào; 70°: không (bắn thẳng vào tâm lỗ) | **ĐẠT** |  |
| D7 | Lắc miệng lỗ (pocket jaw rattle) | đánh lệch vào má lỗ bị nảy qua lại ≥ 2 lần và bật ra | số lần đập má lỗ=2; vào lỗ=không | **ĐẠT** |  |
| E2 | Bi bẩn / phấn trên bi (kick/skid) | ngoài phạm vi | không đo | **CHƯA HỖ TRỢ** | Ma sát đồng nhất, không có độ bẩn |
| E3 | Mặt bàn nghiêng, vải mòn theo hướng | ngoài phạm vi | không đo | **CHƯA HỖ TRỢ** | Mặt bàn phẳng, ma sát đẳng hướng |
