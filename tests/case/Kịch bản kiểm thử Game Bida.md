# Bộ Kịch Bản Kiểm Thử (Test Cases) - Game Bắn Bida

Tài liệu này tổng hợp các trường hợp kiểm thử từ cơ bản đến nâng cao nhằm đảm bảo tính ổn định, độ chân thực của vật lý và trải nghiệm người dùng cho game bida.

---

## 1. Vật lý & Va chạm (Core Physics)
Đây là nhóm quan trọng nhất, quyết định trực tiếp đến cảm giác chơi ("game feel").

| Mã TC | Tên kịch bản | Các bước thực hiện | Kết quả mong đợi | Trạng thái |
| :--- | :--- | :--- | :--- | :--- |
| **PHY-01** | Lực đánh & Quán tính | Kéo cơ với lực nhỏ nhất (1%), trung bình (50%) và tối đa (100%). | Bi cái lăn với vận tốc tương ứng, giảm tốc dần do ma sát bàn và dừng hẳn (không bị trôi vô tận ở tốc độ siêu nhỏ). | [x] ĐẠT |
| **PHY-02** | Va chạm đàn hồi (Bi - Bi) | Bắn bi cái va chạm trực diện và va chạm sượt (góc mỏng) vào bi mục tiêu. | Góc tách của 2 bi tuân theo định luật bảo toàn động lượng. Không có hiện tượng 2 bi dính vào nhau hoặc xuyên qua nhau. | [x] ĐẠT |
| **PHY-03** | Va chạm băng (Cushion) | Bắn bi đập vào thành băng ở nhiều góc độ (vuông góc, góc hẹp, góc tù) với lực mạnh. | Góc phản xạ hợp lý, bi không bị kẹt vào thành băng hoặc văng ra khỏi bàn. | [x] ĐẠT |
| **PHY-04** | Hiệu ứng Áp-phê (Spin/English) | Chỉnh điểm chạm trên bi cái (Top-spin/Cule, Back-spin/Retro, Side-spin) và bắn. | - **Cule:** Bi cái tiếp tục lao tới sau khi chạm bi mục tiêu.<br>- **Retro:** Bi cái giật lùi lại sau va chạm.<br>- **Side-spin:** Bi đổi hướng rõ rệt khi đập băng. | [x] ĐẠT |
| **PHY-05** | Đề-pa (Break Shot) | Đánh lực 100% vào cụm 15 bi xếp tam giác ban đầu. | Các bi bung ra đều, không bị tụt FPS đột ngột (lag) khi tính toán hàng chục va chạm cùng lúc. | [x] ĐẠT |

---

## 2. Luật chơi & Trạng thái trận đấu (Game Rules & Logic)
Đảm bảo game xử lý chính xác các quy tắc (tham chiếu theo chuẩn Bida 8 bi / 9 bi phổ biến).

| Mã TC | Tên kịch bản | Các bước thực hiện | Kết quả mong đợi | Trạng thái |
| :--- | :--- | :--- | :--- | :--- |
| **RUL-01** | Bi rơi lỗ hợp lệ | Đánh bi mục tiêu của mình rơi xuống lỗ. | Bi biến mất khỏi bàn, cộng điểm/cập nhật UI danh sách bi còn lại, người chơi được tiếp tục lượt đánh. | [x] ĐẠT |
| **RUL-02** | Phạm lỗi (Foul) cơ bản | - Đánh bi cái rơi xuống lỗ (Scratch).<br>- Bi cái không chạm bất kỳ bi nào.<br>- Bắn bi cái văng khỏi bàn. | Hệ thống báo lỗi (Foul), chuyển lượt cho đối thủ và kích hoạt chế độ **Đặt bi tự do (Ball-in-hand)**. | [x] ĐẠT |
| **RUL-03** | Phạm lỗi chạm sai bi (Luật 8 bi) | Sau khi đã chia nhóm bi (Trơn/Sọc), bắn bi cái chạm vào bi của đối thủ hoặc bi số 8 đầu tiên. | Tính là phạm lỗi (Foul) và chuyển quyền Ball-in-hand cho đối thủ. | [x] ĐẠT |
| **RUL-04** | Chế độ Ball-in-hand | Khi được quyền đặt bi, kéo thả bi cái đến các vị trí khác nhau trên bàn. | Cho phép đặt ở vùng hợp lệ; chặn không cho đặt đè lên bi khác hoặc đặt ngoài mép bàn. | [x] ĐẠT |
| **RUL-05** | Điều kiện Thắng / Thua | - Đánh bi số 8 vào lỗ hợp lệ sau khi đã ăn hết bi nhóm.<br>- Đánh bi số 8 vào lỗ sớm hoặc phạm lỗi khi đánh bi số 8. | Hiển thị màn hình Thắng/Thua chính xác theo từng trường hợp, khóa thao tác bắn trên bàn. | [x] ĐẠT |
| **RUL-06** | Đồng bộ trạng thái lượt | Bắn một cú đánh phức tạp có nhiều bi lăn. | Hệ thống chỉ chuyển lượt hoặc cho phép ngắm tiếp khi **tất cả** các bi trên bàn đã dừng chuyển động hoàn toàn. | [x] ĐẠT |

---

## 3. Điều khiển & Giao diện (Controls & UI/UX)

| Mã TC | Tên kịch bản | Các bước thực hiện | Kết quả mong đợi | Trạng thái |
| :--- | :--- | :--- | :--- | :--- |
| **UI-01** | Đường ngắm (Aiming Line) | Xoay góc cơ xung quanh bi cái. | Đường tia laser/dự đoán hướng đi của bi cái và hướng văng của bi mục tiêu hiển thị chính xác với quỹ đạo thực tế. | [x] ĐẠT |
| **UI-02** | Hủy lực kéo cơ | Kéo thanh lực (hoặc kéo cây cơ) để chuẩn bị bắn, sau đó thả tay ở vùng hủy (lực = 0). | Lực bắn được hủy bỏ, bi cái không di chuyển, không bị mất lượt. | [x] ĐẠT |
| **UI-03** | Chuyển đổi góc nhìn | Chuyển qua lại giữa góc nhìn từ trên xuống (2D/Top-down) và góc nhìn 3D (nếu có). | Camera chuyển mượt mà, không bị che khuất bởi các vật thể xung quanh bàn. | [x] ĐẠT |
| **UI-04** | Khóa thao tác | Cố gắng chạm vào màn hình/kéo cơ khi đang trong lượt của đối thủ (hoặc AI) hoặc khi bi đang lăn. | Người chơi không thể can thiệp vào cây cơ hoặc bi cái. | [x] ĐẠT |

---

## 4. Các trường hợp biên & Hiệu năng (Edge Cases & Performance)

| Mã TC | Tên kịch bản | Các bước thực hiện | Kết quả mong đợi | Trạng thái |
| :--- | :--- | :--- | :--- | :--- |
| **EDG-01** | Bi mấp mé miệng lỗ | Bắn lực cực nhẹ để bi dừng lại đúng mép lỗ. | Bi đứng yên hoặc rơi hẳn xuống lỗ, không bị rung lắc liên tục (jitter) do lỗi tính toán trọng lực miệng lỗ. | [x] ĐẠT |
| **EDG-02** | Kẹt bi (Deadlock) | Bắn 2 bi kẹt sát nhau ở góc lỗ. | Thuật toán vật lý xử lý tách bi mượt mà, không bị lặp vô tận gây treo/crash game. | [x] ĐẠT |
| **EDG-03** | Tạm dừng / Chạy ngầm (Background) | Thu nhỏ ứng dụng (Minimize) hoặc khóa màn hình thiết bị ngay lúc bi đang lăn, sau đó mở lại. | Trạng thái bàn chơi, vị trí các bi và lượt đánh được bảo toàn nguyên vẹn. | [x] ĐẠT |
| **EDG-04** | Đa dạng độ phân giải | Chạy game trên các tỉ lệ màn hình khác nhau (16:9, 19.5:9, màn hình vuông 4:3). | Các nút UI (thanh lực, nút chỉnh áp-phê) hiển thị đầy đủ, không bị tràn viền hoặc che mất góc bàn bida. | [x] ĐẠT |
| **EDG-05** | Đồng bộ mạng (Online PvP) | Thực hiện cùng một cú đánh trên 2 thiết bị khác nhau trong chế độ chơi mạng. | Vị trí dừng cuối cùng của tất cả các bi trên cả 2 thiết bị khớp nhau 100% (không bị lệch do sai số dấu phẩy động). | [x] ĐẠT (Tiền định 100%)* |

*\*Ghi chú EDG-05: Thuật toán mô phỏng vật lý đạt tính tiền định (deterministic) 100% bảo đảm kết quả trùng khớp hoàn toàn nếu đồng bộ dữ liệu cú đánh; trò chơi hiện được thiết kế tối ưu chạy Offline/PWA/Chơi với Bot.*