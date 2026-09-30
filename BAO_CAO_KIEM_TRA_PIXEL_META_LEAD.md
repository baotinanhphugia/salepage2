# Báo cáo kiểm tra Pixel và Meta Lead

Ngày kiểm tra: 30/09/2026

## 1. Kết luận nhanh

Website production `https://phugiadiamond.vn/` đang lấy Pixel ID từ Google Apps Script/Google Sheet, không hardcode trong repo:

- Pixel ID production: `1591460902714248`
- API cấu hình: `https://script.google.com/macros/s/AKfycbyOi8Tt24hjx2iaJyGRD0tQhx4hYK3KRjYlFdWnQUyM1uf-TrGiGZwfyzEyY83_33LU/exec?action=config&market=VN`
- Repo: `baotinanhphugia/salepage2`
- Domain: `phugiadiamond.vn`

Pixel ID này đang hoạt động vì Meta đã nhận được các sự kiện website `ViewContent` và `InitiateCheckout` từ chiến dịch.

## 2. Lỗi phía website

### Không phải lỗi Pixel ID chính

Trong `index.html`, Pixel được khởi tạo bằng cấu hình động:

```js
if(c.facebookPixelId){
  initMetaPixel(c.facebookPixelId);
}
```

Cấu hình production trả về `1591460902714248`. Không tìm thấy Pixel ID khác trong repo.

### Lỗi cần dọn dẹp

`index.html` dòng 54 vẫn có placeholder cho trường hợp trình duyệt không chạy JavaScript:

```html
https://www.facebook.com/tr?id=YOUR_PIXEL_ID&ev=PageView&noscript=1
```

Điều này không giải thích việc Ads Manager đang ghi nhận 68 kết quả ViewContent, vì phần JavaScript chính vẫn chạy. Tuy nhiên nên thay placeholder bằng Pixel ID thật hoặc bỏ phần noscript nếu chỉ dùng cấu hình động.

### Event hiện tại

Website đang bắn:

- `PageView` khi khởi tạo Pixel.
- `ViewContent` khi tải trang sản phẩm.
- `InitiateCheckout` khi khách bấm mua/đi tới form.
- `Purchase` và `Lead` sau khi API trả về đơn hàng thành công.

Vị trí bắn `Lead`/`Purchase` trong code là sau khi gửi form thành công, đây là logic đúng cho đơn COD.

## 3. Lỗi phía Meta Ads

Tài khoản: `ADS 1` / `act_968081432672633`

Chiến dịch: `chuyển đổi kkhuyêntai`

- Campaign ID: `120252179162260180`
- Mục tiêu: `OUTCOME_LEADS`
- Ngân sách ngày: `100.000 VND`

Dữ liệu 23–29/09/2026:

- Số tiền đã chi tiêu: `69.817 VND`
- `Link clicks`: `104`
- `ViewContent`: `68`
- `InitiateCheckout`: `21`
- `Lead`: chưa có dữ liệu ghi nhận
- `Purchase`: chưa có dữ liệu ghi nhận
- Cost per result đang tham chiếu `offsite_conversion.fb_pixel_view_content`

Vì vậy Ads Manager hiển thị 68 “Kết quả” là 68 lượt xem nội dung, không phải 68 Lead. Tên mục tiêu là Leads nhưng sự kiện kết quả/optimization event của nhóm quảng cáo đang là `ViewContent`.

## 4. Cách cài lại để tối ưu Lead

### Bước A — Kiểm tra Events Manager

1. Mở Meta Events Manager.
2. Chọn Dataset/Pixel ID `1591460902714248`.
3. Vào Test events.
4. Mở `https://phugiadiamond.vn/` bằng URL có tham số test nếu Meta yêu cầu.
5. Điền form bằng thông tin test và bấm `ĐẶT MUA NGAY`.
6. Xác nhận xuất hiện event `Lead` sau khi form báo đặt hàng thành công.
7. Đồng thời kiểm tra `Purchase` nếu muốn đo đơn hàng hoàn tất.
8. Không coi `ViewContent` là chuyển đổi chính.

### Bước B — Sửa nhóm quảng cáo

Với từng nhóm quảng cáo trong campaign `chuyển đổi kkhuyêntai`:

- Nhóm `ads 1 4 chấu` — ID `120252179162280180`
- Nhóm `ads 2 4 chấu 2222` — ID `120252179752750180`
- Nhóm `ads 3 4 chấu -333` — ID `120252179752730180`

Mở **Chỉnh sửa → Chuyển đổi** và đặt:

- Vị trí chuyển đổi: `Website`
- Dataset/Pixel: `1591460902714248`
- Sự kiện tối ưu hóa: `Lead`
- Attribution setting: giữ theo quy ước hiện tại của tài khoản, không đổi nhiều thứ cùng lúc.

Nếu Meta không cho đổi optimization event trên campaign hiện tại, hãy **nhân bản campaign**, đặt sự kiện `Lead`, chạy kiểm tra, sau đó mới cân nhắc giảm/tắt campaign cũ. Không xóa campaign cũ.

### Bước C — Cột báo cáo cần xem

Trong Ads Manager, chọn cột tùy chỉnh có:

- `Results` / Kết quả, phải hiện `Leads`
- `Cost per result`
- `Link clicks`
- `Landing page views`
- `ViewContent`
- `InitiateCheckout`
- `Leads`
- `Purchases`
- `Amount spent`

Sau khi sửa, kết quả phải có dạng `Leads`, và Cost per result phải tính theo Lead; không còn tham chiếu `offsite_conversion.fb_pixel_view_content`.

## 5. Checklist nghiệm thu

- [ ] Website trả về đúng Pixel ID `1591460902714248`.
- [ ] Events Manager nhận `PageView`.
- [ ] Events Manager nhận `ViewContent`.
- [ ] Events Manager nhận `InitiateCheckout`.
- [ ] Gửi form thành công nhận `Lead`.
- [ ] Campaign/ad set dùng Pixel `1591460902714248`.
- [ ] Optimization event là `Lead`, không phải `ViewContent`.
- [ ] Ads Manager hiển thị kết quả là `Leads`.
- [ ] Không phát sinh event `Lead` khi khách chỉ xem trang hoặc chỉ mở form.
- [ ] Xóa cache/localStorage sau khi đổi cấu hình Pixel nếu website còn giữ cấu hình cũ.

## 6. Lưu ý kỹ thuật

Repo đang có fallback `no-cors`: nếu request API gặp lỗi mạng, frontend vẫn coi request là thành công rồi bắn `Purchase` và `Lead`. Cơ chế này có thể làm đếm dư Lead/Purchase trong một số lỗi mạng; nên xử lý riêng sau khi xác nhận event Lead đã chạy đúng.

## 7. Xác nhận trực tiếp từ Events Manager

Trong tài khoản ADS 1, Events Manager đang hiển thị:

- Dataset `khuyên tai S925` — ID `1591460902714248` — có `523` sự kiện trong 28 ngày qua, có cả Meta Pixel và API Chuyển đổi.
- Dataset `khuyên vip s925` — ID `909886545318614` — có `0` sự kiện, chưa từng nhận sự kiện.

Do đó khi cài nhóm quảng cáo, phải chọn Dataset `khuyên tai S925` / ID `1591460902714248`. Không chọn Dataset `khuyên vip s925` / ID `909886545318614`.
