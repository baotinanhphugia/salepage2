# 🛡️ HƯỚNG DẪN KHÔI PHỤC VÀ TÁI TẠO DỰ ÁN TỪ BẢN SAO LƯU (BACKUP)
**Dự án**: Phú Gia Diamond - Sale Page & CRM MISA eShop (Thị trường Việt Nam - phugiadiamond.vn)
**Ngày sao lưu**: 20/09/2026

---

## 1. Cấu trúc bản sao lưu trên ổ mạng D
Bản sao lưu đầy đủ trên ổ mạng `//192.168.1.109/D` bao gồm:
1. `Backup_Salepage_Vietnam_2026-09-20/`: Toàn bộ mã nguồn Landing Page (`index.html`), Web Admin (`admin.html`), Backend Google Apps Script (`Code.gs`), MISA Sync Runner (`misa_sync_runner.py`), hình ảnh (`images/`), cấu hình tự chạy launchd (`com.phugiadiamond.misasync.plist`).
2. `Backup_Skill_PhuGiaDiamond_Salepage_CRM_2026-09-20/`: Toàn bộ gói Skill Agent (`SKILL.md`, `references/`, `scripts/`) để nạp vào Antigravity / Gemini CLI trên máy mới.
3. `salepage-vietnam/`: Bản đồng bộ trực tiếp mới nhất tại thư mục gốc ổ D.

---

## 2. Quy trình Khôi phục trên Máy Mac Mới (5 Bước)

### Bước 1: Sao chép mã nguồn về máy
```bash
# 1. Tạo thư mục làm việc trên Mac:
mkdir -p /Users/edit/.gemini/antigravity/scratch/salepage-vietnam

# 2. Copy toàn bộ file từ ổ D vào máy:
cp -R "/Volumes/192.168.1.109/Backup_Salepage_Vietnam_2026-09-20/"* /Users/edit/.gemini/antigravity/scratch/salepage-vietnam/
```

### Bước 2: Khôi phục Skill cho Antigravity AI
```bash
mkdir -p ~/.gemini/config/skills/phugiadiamond-salepage-crm
cp -R "/Volumes/192.168.1.109/Backup_Skill_PhuGiaDiamond_Salepage_CRM_2026-09-20/"* ~/.gemini/config/skills/phugiadiamond-salepage-crm/
```

### Bước 3: Cài đặt và kích hoạt MISA Sync Runner tự khởi động cùng Mac
```bash
# Cấp quyền thực thi cho các script
chmod +x /Users/edit/.gemini/antigravity/scratch/salepage-vietnam/*.sh
chmod +x /Users/edit/.gemini/antigravity/scratch/salepage-vietnam/misa_sync_runner.py

# Cài đặt file LaunchAgent
cp /Users/edit/.gemini/antigravity/scratch/salepage-vietnam/com.phugiadiamond.misasync.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.phugiadiamond.misasync.plist 2>/dev/null || true
launchctl load -w ~/Library/LaunchAgents/com.phugiadiamond.misasync.plist
```

### Bước 4: Kiểm tra dịch vụ hoạt động
Mở trình duyệt hoặc terminal chạy lệnh:
```bash
curl http://127.0.0.1:8899/health
# Trả về: {"ok": true, "status": "running", "orders_in_queue": 0}
```

### Bước 5: Kiểm tra Website & Web Admin
- Trang bán hàng: `https://phugiadiamond.vn` (hoặc `https://baotinanhphugia.github.io/salepage2/`)
- Trang quản trị: `https://phugiadiamond.vn/admin.html` (Mật khẩu Admin: `123456`)

---

## 3. Các đường link & ID hệ thống quan trọng
- **GitHub Repository**: `https://github.com/baotinanhphugia/salepage2`
- **Google Sheet Dữ liệu**: `https://docs.google.com/spreadsheets/d/1ehOzggNRyYmcFnBGzQ9C8JE_XbIXacNSkgN3NeGwWtg/edit`
- **Apps Script Editor**: `https://script.google.com/u/0/home/projects/1nVKz_xyKHZ2fUXHOAwJRe_u7vAHPQdRxctzzJ-4FwAi48w-bUazcPB2c/edit`
- **Web App URL (Active Version 10)**: `https://script.google.com/macros/s/AKfycbyOi8Tt24hjx2iaJyGRD0tQhx4hYK3KRjYlFdWnQUyM1uf-TrGiGZwfyzEyY83_33LU/exec`
- **Telegram Bot**: `@BaoTinAnhPhuGia_Bot` (Token: `8658895620:AAE06m6t4C2PWSKILT8zAD6ElOZ45Lod3Fk`)
- **MISA eShop**: Chi nhánh `ChiNhanh01`, Kho hàng hóa `485b5d06-306c-11f0-b467-005056b34af7`
