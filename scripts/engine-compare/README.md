# engine-compare

Chạy cùng một bộ cú đánh ([shots.json](shots.json)) trên engine của app và trên [pooltool](https://github.com/ekiefl/pooltool), rồi so quỹ đạo.
Hai engine nhận **cùng trạng thái ban đầu của bi cái** (vận tốc + xoáy), không qua mô hình cơ.

## Cài đặt (một lần, khoảng 600 MB)

```powershell
python -m venv tmp/.venv-pooltool
tmp/.venv-pooltool/Scripts/python -m pip install --extra-index-url https://archive.panda3d.org/ -r scripts/engine-compare/requirements.txt
```

`--extra-index-url` là bắt buộc: pooltool 0.6.0 cần `panda3d==1.11.0.dev3702`, bản này không có trên PyPI.

## Chạy

```powershell
node scripts/engine-compare/run-js.mjs
tmp/.venv-pooltool/Scripts/python scripts/engine-compare/run_pooltool.py
node scripts/engine-compare/compare.mjs
```

Kết quả: `docs/engine-compare/report.md` + một SVG/cú (nét liền: app, nét đứt: pooltool). Dữ liệu trung gian ở `tmp/engine-compare/`.

## Lưu ý
- `run_pooltool.py` đặt thông số pooltool (`u_s`, `u_r`, `e_c`, `f_c`, `e_b`) theo profile bàn của app; `u_b`, `u_sp` để mặc định của pooltool.
- Hình học lỗ / băng hai bên khác nhau: cú nào rơi lỗ hoặc chạm miệng lỗ sẽ lệch vì lý do hình học.
- pooltool 0.6.0 báo va chạm bi–bi giả khi hai bi nằm **đúng** trên một đường thẳng; các cú đánh thẳng trong `shots.json` lệch bi mục tiêu 0,01 mm để tránh. `compare.mjs` cảnh báo nếu thấy bi "dịch chuyển tức thời".
