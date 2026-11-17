# Deploy lên VPS bằng Docker + GitHub Actions + Cloudflare Tunnel

Workflow `.github/workflows/ci-deploy.yml`:

1. `test`: `npm ci` + `npm test` (mọi push và PR).
2. `image`: build image Docker, chạy thử container và gọi `/healthz`; trên `main` thì đẩy lên GHCR
   (`ghcr.io/<owner>/<repo>:<commit-sha>` và `:latest`).
3. `deploy` (chỉ `main`, chỉ khi biến `DEPLOY_ENABLED=true`): chép `docker-compose.yml` lên VPS, SSH vào chạy
   `docker compose pull app` + `docker compose up -d app`, rồi gọi `/healthz` qua hostname của tunnel.

Web và WebSocket đi qua **Cloudflare Tunnel**: Cloudflare lo HTTPS và DNS của hostname, máy chủ không mở cổng web ra ngoài.

Trạng thái: image và compose đã build và chạy thử trên máy phát triển; workflow và các bước trên VPS **chưa chạy thử
trên GitHub/VPS thật**. Lệnh cài Docker và cấu hình `cloudflared` viết theo trí nhớ về tài liệu chính thức; hãy đối chiếu trước khi chạy.

## Cổng sử dụng (đều khác mặc định)

| Dùng cho | Cổng | Nghe ở đâu | Ghi chú |
|---|---|---|---|
| App (web + `/ws`) | `28787` | `127.0.0.1` của máy chủ | Đổi bằng `PORT` trong `.env`; nhớ sửa cả địa chỉ đích của tunnel |
| SSH cho deploy | `22022` (gợi ý) | công khai | Bạn tự đổi trong `sshd`; đặt secret `DEPLOY_PORT` cho khớp |
| Web 80 / 443 | không mở | – | Tunnel chỉ tạo kết nối đi ra |

## 1. Chuẩn bị một lần trên VPS

1. Cài Docker Engine kèm plugin compose theo tài liệu chính thức: https://docs.docker.com/engine/install/
2. Trên máy của bạn, tạo cặp khóa chỉ dùng cho deploy (không đặt mật khẩu):
   ```bash
   ssh-keygen -t ed25519 -f bida_deploy -C "bida-deploy" -N ""
   ```
3. Chép `scripts/deploy/server-setup.sh` lên VPS rồi chạy với **khóa công khai** (`bida_deploy.pub`):
   ```bash
   sudo bash server-setup.sh "ssh-ed25519 AAAA... bida-deploy"
   ```
   Script tạo user `bida` (thuộc nhóm `docker`), thư mục `/srv/bida` và tệp `/srv/bida/.env`.
   Lưu ý: thành viên nhóm `docker` có quyền tương đương root trên máy chủ, nên khóa deploy phải được giữ kín.
4. Sửa `/srv/bida/.env`:
   ```
   PORT=28787
   ALLOWED_ORIGINS=https://hostname-cua-tunnel
   GA_MEASUREMENT_ID=G-XXXXXXXXXX
   TUNNEL_TOKEN=
   ```
   `GA_MEASUREMENT_ID` là mã GA4 (hoặc `GTM-…`); để trống thì tắt thống kê. Mã không nằm trong repo.
5. Cloudflare Tunnel, chọn một trong hai:
   - **cloudflared đang chạy sẵn trên máy chủ** (ngoài Docker): trỏ Public Hostname về `http://127.0.0.1:28787`
     (trên dashboard, hoặc bằng mẫu `scripts/deploy/cloudflared-config.yml`).
   - **cloudflared chạy bằng container của compose này**: điền `TUNNEL_TOKEN` vào `.env`, trỏ Public Hostname trên
     dashboard về `http://app:28787`, rồi sau lần deploy đầu chạy một lần:
     ```bash
     cd /srv/bida && IMAGE=$(cat current-image.txt) docker compose --profile tunnel up -d
     ```
6. Đổi cổng SSH sang `22022` (tùy chọn): sửa `Port 22022` trong `/etc/ssh/sshd_config`, mở cổng mới trên tường lửa
   **trước**, khởi động lại `sshd`, và thử đăng nhập bằng cổng mới ở một phiên khác trước khi đóng phiên hiện tại.
7. Tường lửa: chỉ mở cổng SSH; không mở 80, 443 hay 28787:
   ```bash
   sudo ufw allow 22022/tcp && sudo ufw enable
   ```

## 2. Cấu hình trên GitHub

Settings → Secrets and variables → Actions.

Secrets:

| Tên | Giá trị |
|---|---|
| `DEPLOY_HOST` | IP của VPS (SSH đi thẳng vào VPS, không qua tunnel) |
| `DEPLOY_USER` | `bida` |
| `DEPLOY_SSH_KEY` | Toàn bộ nội dung tệp khóa riêng `bida_deploy` |
| `DEPLOY_KNOWN_HOSTS` | Kết quả của `ssh-keyscan -p 22022 -H <IP>` (kiểm tra dấu vân tay trước khi dán) |
| `DEPLOY_PORT` | `22022` (bỏ trống thì workflow dùng 22) |

Variables:

| Tên | Giá trị |
|---|---|
| `DEPLOY_PATH` | `/srv/bida` |
| `DEPLOY_URL` | `https://hostname-cua-tunnel` |
| `DEPLOY_ENABLED` | `true` (chưa đặt thì workflow chỉ test và build image, không deploy) |

Không cần tạo token riêng cho GHCR: workflow dùng `GITHUB_TOKEN` của chính lần chạy để đẩy image, và chuyển token đó
qua SSH cho máy chủ đăng nhập GHCR trong lúc kéo image rồi đăng xuất ngay.

## 3. Vận hành

- Chạy thử trên máy phát triển: `docker compose up --build` rồi mở `http://localhost:28787`
- Xem log: `cd /srv/bida && docker compose logs -f app`
- Trạng thái: `docker compose ps` (cột STATUS có `healthy`)
- Kiểm tra sống trên máy chủ: `curl http://127.0.0.1:28787/healthz` trả `ok`
- Image đang chạy: `cat /srv/bida/current-image.txt`
- Chạy lại bằng tay: `cd /srv/bida && IMAGE=$(cat current-image.txt) docker compose up -d app`
- Lùi phiên bản: chạy lệnh trên với `IMAGE=ghcr.io/<owner>/<repo>:<commit-sha-cũ>` (cần `docker login ghcr.io` nếu image
  chưa có sẵn trên máy), hoặc revert commit trên `main` rồi push.

## 4. Giới hạn

- Phòng chơi nằm trong bộ nhớ của tiến trình: mỗi lần deploy (tạo lại container) làm mất các phòng đang mở,
  trận đang chơi sẽ bị ngắt. Nên deploy vào lúc vắng người.
- Chỉ chạy được một container app; chưa nhân bản ngang.
- Trên hostname công khai app là "bản release": chế độ Đấu 2 Bot bị ẩn (xem `src/core/build.js`).
- SSH deploy vẫn cần GitHub Actions kết nối được tới cổng SSH của VPS; phần này không đi qua tunnel.
