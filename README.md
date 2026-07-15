# Firefox Remote Control (không Docker)

Node.js server chạy Firefox trên virtual display của VPS và stream/điều khiển GUI
đó qua trình duyệt, dùng x11vnc + noVNC (không cần cài đặt websockify riêng, proxy
được viết thẳng bằng Node `ws`).

## 1. Cài package hệ thống trên VPS (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y xvfb x11vnc fluxbox firefox-esr
```

Ghi chú:
- `xvfb`: màn hình ảo (không cần GPU/monitor).
- `x11vnc`: phát màn hình ảo ra giao thức VNC.
- `fluxbox`: window manager nhẹ, cho Firefox có viền cửa sổ (tuỳ chọn, có thể tắt bằng `useWindowManager: false`).
- `firefox-esr`: nếu VPS không có gói `firefox` thường, dùng `firefox-esr` và đổi lệnh spawn trong `sessionManager.js` từ `'firefox'` thành `'firefox-esr'`.

## 2. Cài Node dependencies

```bash
npm install
```

## 3. Cấu hình

```bash
cp .env.example .env
# sửa API_TOKEN thành 1 chuỗi bí mật thật trước khi mở ra internet
```

## 4. Chạy

```bash
node server.js
```

Mở `http://<ip-vps>:3000`, bấm **Bắt đầu phiên** để khởi động Firefox, màn hình sẽ
hiện ra và bạn điều khiển trực tiếp bằng chuột/bàn phím ngay trong trình duyệt.

## 5. Bảo mật khi deploy thật (quan trọng)

- **Không** mở port 5900 (x11vnc) ra internet — `sessionManager.js` đã bind `-localhost`
  cho x11vnc, chỉ Node proxy trên VPS mới gọi được vào đó.
- Đặt Node server sau **Nginx + TLS** (Let's Encrypt), chỉ expose port 443.
  Nginx cần forward cả HTTP lẫn WebSocket (`Upgrade`/`Connection` headers) tới port 3000.
- Bật `API_TOKEN` trong `.env` và set cùng giá trị đó vào biến `API_TOKEN` trong
  `public/index.html` (hoặc thay bằng cơ chế login/session thật, JWT, v.v. — token
  tĩnh trong file .env chỉ phù hợp demo/nội bộ).
- Giới hạn số session chạy song song vì mỗi Firefox + Xvfb tốn ~300–500MB RAM.

## 6. Chạy nền bằng systemd (khuyên dùng thay vì Docker)

Tạo `/etc/systemd/system/firefox-remote.service`:

```ini
[Unit]
Description=Firefox Remote Control
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/firefox-remote
ExecStart=/usr/bin/node server.js
Restart=on-failure
EnvironmentFile=/opt/firefox-remote/.env
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now firefox-remote
```

## 7. Mở rộng: điều khiển bằng script (ngoài điều khiển bằng tay)

Nếu sau này cần vừa cho người dùng xem/điều khiển thủ công qua noVNC, vừa
tự động hoá bằng code (VD: tự điền form, tự click theo lệnh API), có thể chạy
song song Playwright hoặc geckodriver, attach vào **cùng** `DISPLAY` và
`profilePath` mà `sessionManager.js` đang dùng — cả hai kênh điều khiển chung
1 Firefox instance mà không xung đột.

## Cấu trúc project

```
firefox-remote/
  server.js            # Express app + API start/stop + gắn proxy VNC
  sessionManager.js     # spawn/kill Xvfb, Firefox, x11vnc, fluxbox
  wsVncProxy.js         # relay WebSocket <-> TCP (thay cho websockify)
  public/
    index.html          # UI: nút start/stop + canvas noVNC
    novnc/              # thư viện noVNC client (từ @novnc/novnc)
  profiles/default/     # Firefox profile (tự tạo khi Firefox chạy lần đầu)
  .env.example
```
