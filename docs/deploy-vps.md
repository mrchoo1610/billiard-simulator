# Deploy lên VPS bằng Docker + GitHub Actions (Self-Hosted Runner) + Cloudflare Tunnel

Workflow `.github/workflows/ci-deploy.yml`:

1. `test`: `npm ci` + `npm test` (chạy trên GitHub Cloud `ubuntu-latest`).
2. `image`: build image Docker, chạy thử container và gọi `/healthz`; sau đó đẩy lên GHCR
   (`ghcr.io/<owner>/<repo>:<commit-sha>` và `:latest`) (chạy trên `ubuntu-latest`).
3. `deploy`: chạy trực tiếp trên **Self-Hosted Runner** đặt trên server VPS (`runs-on: [self-hosted, Linux]`),
   tự kéo image từ GHCR, cập nhật `docker-compose.yml`, khởi động lại container và kiểm tra `/healthz`.

Web và WebSocket đi qua **Cloudflare Tunnel**: Cloudflare lo HTTPS và DNS của hostname, máy chủ không cần mở cổng web hoặc cổng SSH ra ngoài Internet cho GitHub Actions.

## Cổng sử dụng

| Dùng cho | Cổng | Nghe ở đâu | Ghi chú |
|---|---|---|---|
| App (web + `/ws`) | `28787` | `127.0.0.1` của máy chủ | Đổi bằng `PORT` trong `.env`; nhớ sửa cả địa chỉ đích của tunnel |
| SSH quản trị | `22` hoặc tùy chọn | công khai/VPN | Chỉ dùng cho quản trị viên, CI/CD không cần SSH |
| Web 80 / 443 | không mở | – | Tunnel chỉ tạo kết nối đi ra |

## 1. Chuẩn bị trên VPS

1. Cài Docker Engine kèm plugin compose theo tài liệu chính thức: https://docs.docker.com/engine/install/
2. Cài đặt GitHub Actions Self-Hosted Runner trên VPS:
   - Vào GitHub Repo: **Settings → Actions → Runners → New runner**.
   - Chọn Linux / x64 và làm theo các bước tải, cấu hình và khởi chạy runner service.
   - Đảm bảo user chạy runner có quyền chạy Docker:
     ```bash
     sudo usermod -aG docker $USER
     # Nếu runner đã chạy dạng systemd service, khởi động lại service:
     sudo ./svc.sh restart # hoặc sudo systemctl restart actions.runner.*
     ```
3. Tạo thư mục chứa ứng dụng `/srv/bida` và file cấu hình môi trường `.env`:
   ```bash
   sudo mkdir -p /srv/bida
   sudo chown -R $USER:$USER /srv/bida
   cat > /srv/bida/.env <<'EOF'
   PORT=28787
   ALLOWED_ORIGINS=https://hostname-cua-tunnel
   GA_MEASUREMENT_ID=
   TUNNEL_TOKEN=
   EOF
   chmod 600 /srv/bida/.env
   ```
4. Cloudflare Tunnel, chọn một trong hai:
   - **cloudflared đang chạy sẵn trên máy chủ** (ngoài Docker): trỏ Public Hostname về `http://127.0.0.1:28787`
     (trên dashboard Cloudflare Zero Trust, hoặc bằng mẫu `scripts/deploy/cloudflared-config.yml`).
   - **cloudflared chạy bằng container của compose**: điền `TUNNEL_TOKEN` vào `.env`, trỏ Public Hostname trên
     dashboard về `http://app:28787`, rồi chạy:
     ```bash
     cd /srv/bida && IMAGE=$(cat current-image.txt) docker compose --profile tunnel up -d
     ```

## 2. Cấu hình trên GitHub (Tùy chọn)

Settings → Secrets and variables → Actions.

**Không cần Secrets SSH** (vì runner chạy trực tiếp trên server).

Variables (Tùy chọn):

| Tên | Giá trị mặc định | Ghi chú |
|---|---|---|
| `DEPLOY_PATH` | `/srv/bida` | Đường dẫn thư mục chứa compose và `.env` trên VPS |
| `DEPLOY_URL` | `http://127.0.0.1:28787` | Domain tunnel để test health check sau deploy |
| `DEPLOY_ENABLED` | `true` | Đặt `false` nếu muốn tạm dừng bước deploy |

Không cần tạo token riêng cho GHCR: workflow dùng `GITHUB_TOKEN` của chính lần chạy để đẩy image từ job `image` và kéo image trong job `deploy`.

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
