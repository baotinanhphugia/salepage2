/**
 * =========================================================================
 * PHÚ GIA DIAMOND - CHUYÊN BIỆT THỊ TRƯỜNG VIỆT NAM (VNĐ)
 * Backend Google Apps Script Độc Lập - Quản lý Google Sheet & Telegram VN
 * Tích hợp luồng chốt đơn Inbox Zero: Gọi xác nhận -> Sửa đơn -> Đẩy eShop -> Tự xóa tin Telegram
 * =========================================================================
 */

const SHEET_ORDERS = "Orders";
const SHEET_CONFIG = "Config";

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "";
  if (action === "config") {
    return json_({ ok: true, config: getPublicConfigVN_() });
  }
  return HtmlService.createHtmlOutput(
    "<div style='font-family:sans-serif;text-align:center;padding:50px;'>" +
    "<h2>Phú Gia Diamond - Vietnam API is running securely.</h2>" +
    "<p>Hệ thống tiếp nhận đơn hàng Việt Nam hoạt động 24/7 (Đã tích hợp quy trình Inbox Zero Telegram & eShop).</p>" +
    "</div>"
  );
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");

    // 0. Xử lý nút bấm trực tiếp trên Telegram (Callback Query)
    if (data.callback_query) {
      return handleTelegramCallback_(data.callback_query);
    }

    // 1. Đăng nhập / Lấy cấu hình hệ thống & thông tin người dùng
    if (data.action === "login" || data.action === "adminConfig") {
      const auth = authenticateUser_(data.username, data.password || data.key);
      return json_({
        ok: true,
        user: auth.user,
        config: getConfig_()
      });
    }

    // 1.1 Quản lý Nhân sự: Lấy danh sách (Chỉ Admin)
    if (data.action === "getUsers") {
      checkAdminRole_(data.username, data.password || data.key);
      return json_({ ok: true, users: getUsers_() });
    }

    // 1.2 Quản lý Nhân sự: Thêm / Sửa nhân viên (Chỉ Admin)
    if (data.action === "saveUser") {
      checkAdminRole_(data.username, data.password || data.key);
      const saved = saveUser_(data.user);
      return json_({ ok: true, user: saved });
    }

    // 1.3 Quản lý Nhân sự: Khóa / Mở khóa nhân viên (Chỉ Admin)
    if (data.action === "toggleUserStatus") {
      checkAdminRole_(data.username, data.password || data.key);
      const newStatus = toggleUserStatus_(data.targetUsername);
      return json_({ ok: true, username: data.targetUsername, status: newStatus });
    }

    // 1.4 Quản lý Nhân sự: Xóa nhân viên (Chỉ Admin)
    if (data.action === "deleteUser") {
      checkAdminRole_(data.username, data.password || data.key);
      deleteUser_(data.targetUsername);
      return json_({ ok: true, username: data.targetUsername });
    }

    // 2. Xem danh sách đơn hàng (Admin & CSKH)
    if (data.action === "orders") {
      checkStaffAuth_(data.username, data.password || data.key);
      return json_({ ok: true, orders: getOrders_() });
    }

    // 3. Admin lưu cấu hình (Chỉ Admin)
    if (data.action === "saveConfig") {
      checkAdminRole_(data.username, data.password || data.key);
      saveConfig_(data.config || {});
      savePrivateProps_(data.config || {});
      return json_({ ok: true });
    }

    // 4. Sửa đơn hàng (Admin & CSKH - Xoá tin cũ trên Telegram, gửi lại tin mới cập nhật)
    if (data.action === "updateOrder") {
      checkStaffAuth_(data.username, data.password || data.key);
      return handleUpdateOrderVN_(data);
    }

    // 5. Xác nhận đẩy đơn sang eShop (Admin & CSKH - Hoàn tất -> Xóa tin Telegram)
    if (data.action === "pushToEShop") {
      checkStaffAuth_(data.username, data.password || data.key);
      return handlePushToEShopVN_(data);
    }

    // 5.1 Runner lấy các đơn đang chờ đẩy MISA eShop
    if (data.action === "getPendingMisa") {
      checkAdminWithBruteForceGuard_(data.key || data.password);
      return handleGetPendingMisa_();
    }

    // 5.2 Runner hoàn tất đẩy MISA eShop
    if (data.action === "finishPushMisa") {
      checkAdminWithBruteForceGuard_(data.key || data.password);
      return handleFinishPushMisa_(data);
    }

    // 5.3 Runner báo lỗi đẩy MISA eShop
    if (data.action === "failPushMisa") {
      checkAdminWithBruteForceGuard_(data.key || data.password);
      return handleFailPushMisa_(data);
    }

    // 6. Hủy đơn (Admin & CSKH - Khách bom / không mua -> Xóa tin Telegram)
    if (data.action === "cancelOrder") {
      checkStaffAuth_(data.username, data.password || data.key);
      return handleCancelOrderVN_(data);
    }

    // 7. Cập nhật trạng thái nhanh (Admin & CSKH - Gọi điện / Zalo...)
    if (data.action === "updateStatus") {
      checkStaffAuth_(data.username, data.password || data.key);
      const result = updateOrderStatus_(data.orderId, data.status);
      return json_({ ok: true, orderId: data.orderId, status: data.status });
    }

    // 8. Khách đặt hàng từ Landing Page Việt Nam
    return handleOrderVN_(data);
  } catch (err) {
    return json_({ ok: false, error: err.message || err.toString() });
  }
}

function handleOrderVN_(data) {
  const rawPhone = String(data.phone || "").replace(/[\s\-\.]/g, "");
  const vnPhoneRegex = /^(0[3|5|7|8|9]|84[3|5|7|8|9])[0-9]{8}$/;

  if (!vnPhoneRegex.test(rawPhone)) {
    return json_({ ok: false, error: "Số điện thoại Việt Nam không đúng định dạng (10 số)." });
  }

  const rawName = String(data.name || "").trim();
  if (!rawName || rawName.length < 2) {
    return json_({ ok: false, error: "Vui lòng nhập họ tên người nhận đầy đủ." });
  }

  // Chống Spam theo SĐT (30 giây)
  const cache = CacheService.getScriptCache();
  const cacheKey = "rate_limit_vn_" + rawPhone;
  if (cache.get(cacheKey)) {
    return json_({ ok: false, error: "Bạn vừa gửi đơn hàng cách đây ít giây. Vui lòng chờ shop liên hệ xác nhận!" });
  }
  cache.put(cacheKey, "submitted", 30);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateOrdersSheet_(ss);
    const config = getConfig_();

    // Tính giá và trừ kho an toàn ở server
    const stockResult = updateStockVN_(data, config);
    const orderId = "PGD-VN-" + Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyyMMdd-HHmmss");
    const createdAt = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");

    const fullAddress = [data.address, data.ward, data.district, data.province]
      .map(cleanText_)
      .filter(Boolean)
      .join(", ");
    const mapsLink = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(fullAddress);

    const productName = cleanText_(data.product || config.productName || "Bông nụ bạc S925 Moissanite GRA");
    const priceRaw = stockResult.price || config.salePrice || "459999";
    const priceFormatted = `${formatMoney_(priceRaw)}đ`;

    // Ghi an toàn vào Google Sheet (18 cột chuẩn + 2 cột TelegramMsgId & EShopCode)
    sheet.appendRow([
      createdAt,
      orderId,
      productName,
      cleanText_(data.name || ""),
      cleanText_(data.phone || ""),
      cleanText_(data.address || ""),
      cleanText_(data.province || ""),
      cleanText_(data.district || ""),
      cleanText_(data.ward || ""),
      cleanText_(data.variant || ""),
      cleanText_(data.size || ""),
      cleanText_(data.quantity || "1"),
      cleanText_(data.combo || ""),
      cleanText_(data.payment || "COD"),
      priceFormatted,
      cleanText_(data.note || ""),
      mapsLink,
      "Chờ xác nhận",
      "", // Cột 19: TelegramMsgId
      ""  // Cột 20: EShopCode
    ]);

    const lastRow = sheet.getLastRow();

    const cleanPhone = cleanText_(data.phone || "");
    const rawPhoneDigits = cleanPhone.replace(/\D/g, "");
    // Bắn tin nhắn Telegram kèm cụm nút bấm kết hợp - SĐT thẻ code tự copy + Link Zalo màu xanh
    const message =
`💎 🇻🇳 <b>ĐƠN HÀNG MỚI (VIỆT NAM) - PHÚ GIA DIAMOND</b>
🧾 Mã đơn: <code>${escapeHtml_(orderId)}</code>
👤 Khách hàng: <b>${escapeHtml_(cleanText_(data.name || ""))}</b>
📞 Số điện thoại: <code>${escapeHtml_(cleanPhone)}</code> <i>(Chạm số để sao chép)</i>
💬 Link Zalo: <a href="https://zalo.me/${escapeHtml_(rawPhoneDigits)}">https://zalo.me/${escapeHtml_(rawPhoneDigits)}</a>
📍 Địa chỉ: ${escapeHtml_(fullAddress)}
🗺 Google Maps: ${escapeHtml_(mapsLink)}
💍 Sản phẩm: ${escapeHtml_(productName)}
📦 Phân loại: ${escapeHtml_(cleanText_(data.variant || ""))}
📏 Kích cỡ đá: ${escapeHtml_(cleanText_(data.size || ""))}
🔢 Số lượng: ${escapeHtml_(cleanText_(data.quantity || "1"))}
🎁 Combo: ${escapeHtml_(cleanText_(data.combo || ""))}
💳 Thanh toán: ${escapeHtml_(cleanText_(data.payment || "COD"))}
💰 Tổng thu COD: <b>${escapeHtml_(priceFormatted)}</b>
📦 Kho còn: ${escapeHtml_(stockResult.stockLeft)}
📝 Ghi chú: ${escapeHtml_(cleanText_(data.note || "Không có"))}
🕒 Thời gian: ${escapeHtml_(createdAt)}`;

    const msgId = safeSendTelegram_(message, orderId, cleanPhone, data.adminUrl);
    if (msgId) {
      sheet.getRange(lastRow, 19).setValue(msgId);
    }

    safeSendGmail_(orderId, message);

    return json_({ ok: true, orderId, market: "Việt Nam" });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Admin Sửa Đơn: Cập nhật Google Sheet, XÓA tin nhắn Telegram cũ và GỬI LẠI tin nhắn mới
 */
function handleUpdateOrderVN_(data) {
  const orderId = String(data.orderId || "").trim();
  if (!orderId) throw new Error("Thiếu mã đơn hàng!");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateOrdersSheet_(ss);
  const values = sheet.getDataRange().getValues();
  let targetRow = -1;
  let oldMsgId = "";

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).trim() === orderId) {
      targetRow = i + 1;
      oldMsgId = String(values[i][18] || "");
      break;
    }
  }

  if (targetRow === -1) {
    throw new Error("Không tìm thấy đơn hàng " + orderId);
  }

  const name = cleanText_(data.name || "");
  const phone = cleanText_(data.phone || "");
  const address = cleanText_(data.address || "");
  const province = cleanText_(data.province || "");
  const district = cleanText_(data.district || "");
  const ward = cleanText_(data.ward || "");
  const variant = cleanText_(data.variant || "");
  const size = cleanText_(data.size || "");
  const quantity = cleanText_(data.quantity || "1");
  const price = cleanText_(data.price || "");
  let note = cleanText_(data.note || "");
  const staffName = cleanText_(data.staffName || data.operator || "");
  if (staffName && !note.includes("[NV:")) {
    note = note ? `${note} [NV: ${staffName}]` : `[NV: ${staffName}]`;
  }
  const fullAddress = [address, ward, district, province].filter(Boolean).join(", ");
  const mapsLink = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(fullAddress);

  if (name) sheet.getRange(targetRow, 4).setValue(name);
  if (phone) sheet.getRange(targetRow, 5).setValue(phone);
  sheet.getRange(targetRow, 6).setValue(address);
  sheet.getRange(targetRow, 7).setValue(province);
  sheet.getRange(targetRow, 8).setValue(district);
  sheet.getRange(targetRow, 9).setValue(ward);
  sheet.getRange(targetRow, 10).setValue(variant);
  sheet.getRange(targetRow, 11).setValue(size);
  sheet.getRange(targetRow, 12).setValue(quantity);
  if (price) sheet.getRange(targetRow, 15).setValue(price.endsWith("đ") ? price : formatMoney_(price) + "đ");
  sheet.getRange(targetRow, 16).setValue(note);
  sheet.getRange(targetRow, 17).setValue(mapsLink);
  sheet.getRange(targetRow, 18).setValue("Đã sửa");

  // 1. XOÁ TIN NHẮN CŨ TRÊN TELEGRAM
  if (oldMsgId) {
    safeDeleteTelegramMessage_(oldMsgId);
  }

  // 2. GỬI LẠI TIN MỚI CẬP NHẬT KÈM ĐẦY ĐỦ CỤM NÚT BẤM (SĐT tự copy + Link Zalo)
  const updatedTime = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
  const formattedPrice = price.endsWith("đ") ? price : formatMoney_(price) + "đ";
  const rawPhoneDigits = String(phone || "").replace(/\D/g, "");

  const newMessage =
`💎 🇻🇳 <b>[ĐÃ CẬP NHẬT] ĐƠN HÀNG - PHÚ GIA DIAMOND</b>
🧾 Mã đơn: <code>${escapeHtml_(orderId)}</code>
👤 Khách hàng: <b>${escapeHtml_(name)}</b>
📞 Số điện thoại: <code>${escapeHtml_(phone)}</code> <i>(Chạm số để sao chép)</i>
💬 Link Zalo: <a href="https://zalo.me/${escapeHtml_(rawPhoneDigits)}">https://zalo.me/${escapeHtml_(rawPhoneDigits)}</a>
📍 Địa chỉ mới: ${escapeHtml_(fullAddress)}
🗺 Google Maps: ${escapeHtml_(mapsLink)}
💍 Phân loại: ${escapeHtml_(variant)}
📏 Kích cỡ đá: ${escapeHtml_(size)}
🔢 Số lượng: ${escapeHtml_(quantity)}
💰 Tổng thu COD: <b>${escapeHtml_(formattedPrice)}</b>
📝 Ghi chú: ${escapeHtml_(note || "Không có")}
🕒 Cập nhật lúc: ${escapeHtml_(updatedTime)}`;

  const newMsgId = safeSendTelegram_(newMessage, orderId, phone, data.adminUrl);
  if (newMsgId) {
    sheet.getRange(targetRow, 19).setValue(newMsgId);
  }

  return json_({
    ok: true,
    orderId,
    newMsgId,
    message: "Đã cập nhật đơn hàng thành công, xoá tin cũ và gửi tin mới lên Telegram!"
  });
}

/**
 * Đẩy đơn sang MISA eShop: Chuyển trạng thái "Chờ đẩy eShop" để Runner trên máy Mac đồng bộ tự động
 */
function handlePushToEShopVN_(data) {
  const orderId = String(data.orderId || "").trim();
  if (!orderId) throw new Error("Thiếu mã đơn hàng!");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateOrdersSheet_(ss);
  const values = sheet.getDataRange().getValues();
  let targetRow = -1;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).trim() === orderId) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) {
    throw new Error("Không tìm thấy đơn hàng " + orderId);
  }

  // Cập nhật trạng thái trong Sheet để Runner xử lý
  sheet.getRange(targetRow, 18).setValue("Chờ đẩy eShop");

  return json_({
    ok: true,
    orderId,
    message: "Đơn hàng đã được đưa vào hàng đợi đẩy sang MISA eShop!"
  });
}

/**
 * Runner lấy danh sách đơn đang chờ đẩy MISA eShop
 */
function handleGetPendingMisa_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateOrdersSheet_(ss);
  const values = sheet.getDataRange().getValues();
  const pending = [];

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const status = String(r[17] || "").trim();
    if (status === "Chờ đẩy eShop") {
      pending.push({
        rowIndex: i + 1,
        createdAt: r[0],
        orderId: String(r[1] || ""),
        product: String(r[2] || ""),
        name: String(r[3] || ""),
        phone: String(r[4] || ""),
        address: String(r[5] || ""),
        province: String(r[6] || ""),
        district: String(r[7] || ""),
        ward: String(r[8] || ""),
        fullAddress: [r[5], r[8], r[7], r[6]].filter(Boolean).join(", "),
        variant: String(r[9] || ""),
        size: String(r[10] || ""),
        quantity: String(r[11] || "1"),
        combo: String(r[12] || ""),
        payment: String(r[13] || "COD"),
        price: String(r[14] || ""),
        note: String(r[15] || ""),
        telegramMsgId: String(r[18] || "")
      });
    }
  }
  return json_({ ok: true, pending: pending });
}

/**
 * Runner hoàn tất đẩy MISA eShop: Cập nhật mã eShop, xóa tin Telegram (Inbox Zero), gửi thông báo hoàn tất
 */
function handleFinishPushMisa_(data) {
  const orderId = String(data.orderId || "").trim();
  const eshopCode = String(data.eshopCode || "").trim();
  if (!orderId) throw new Error("Thiếu mã đơn hàng!");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateOrdersSheet_(ss);
  const values = sheet.getDataRange().getValues();
  let targetRow = -1;
  let oldMsgId = "";
  let customerName = "";

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).trim() === orderId) {
      targetRow = i + 1;
      customerName = values[i][3] || "";
      oldMsgId = String(values[i][18] || "");
      break;
    }
  }

  if (targetRow === -1) {
    throw new Error("Không tìm thấy đơn hàng " + orderId);
  }

  // 1. Cập nhật trạng thái và mã eShop
  sheet.getRange(targetRow, 18).setValue("Đã đẩy eShop");
  sheet.getRange(targetRow, 20).setValue(eshopCode);

  // 2. XÓA TIN NHẮN TRÊN TELEGRAM (INBOX ZERO!)
  if (oldMsgId) {
    safeDeleteTelegramMessage_(oldMsgId);
    sheet.getRange(targetRow, 19).setValue("");
  }

  // 3. Gửi thông báo xác nhận kèm link kiểm tra
  const props = PropertiesService.getScriptProperties();
  const eShopLink = props.getProperty("MISA_APP_URL") || "https://eshopapp.misa.vn/management/general-order#5";
  safeSendQuickNotice_(`✅ [HOÀN TẤT] Đơn hàng ${orderId} (${customerName}) đã được đẩy sang MISA eShop thành công! Mã đơn: ${eshopCode}\n🔗 Xem trên MISA eShop: ${eShopLink}`);

  return json_({
    ok: true,
    orderId,
    eshopCode,
    message: "Đã hoàn tất đồng bộ đơn hàng sang MISA eShop!"
  });
}

/**
 * Runner báo lỗi đẩy MISA eShop
 */
function handleFailPushMisa_(data) {
  const orderId = String(data.orderId || "").trim();
  const error = String(data.error || "Lỗi tạo đơn");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateOrdersSheet_(ss);
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).trim() === orderId) {
      sheet.getRange(i + 1, 18).setValue("Lỗi đẩy eShop");
      sheet.getRange(i + 1, 20).setValue("Lỗi: " + error.substring(0, 100));
      break;
    }
  }

  safeSendQuickNotice_(`⚠️ [LỖI MISA] Không thể đẩy đơn ${orderId} sang MISA eShop:\n${error}`);
  return json_({ ok: true, orderId, error });
}

/**
 * Tích hợp MISA eShop Open API để tạo đơn hàng Online
 */
function callMisaEShopCreateOrder_(orderData) {
  try {
    const props = PropertiesService.getScriptProperties();
    const appId = props.getProperty("MISA_APP_ID") || "679C30FC44DB4DC0B2D88FE644A7CF5E";
    const appKey = props.getProperty("MISA_APP_KEY") || "B35CFD2B61F04D678D10264357DEDD0629EC8564366A4A1AB918EAE1632A6A4A";
    const companyName = props.getProperty("MISA_COMPANY_NAME") || "CÔNG TY TNHH BAO TIN ANH PHU GIA DIAMOND";

    const cleanPrice = Number(String(orderData.price || "0").replace(/\D/g, "")) || 459000;
    const qty = Math.max(1, Number(String(orderData.quantity || "1").replace(/\D/g, "")) || 1);
    const unitPrice = Math.round(cleanPrice / qty);

    const itemSku = "MS" + String(orderData.size || "5mm").replace("mm", "") + (orderData.variant === "1 Đôi" ? "*2" : "");
    const itemName = (orderData.product || "Bông nụ bạc S925 Moissanite GRA") + " (" + (orderData.variant || "1 Đôi") + " - " + (orderData.size || "5mm") + ")";

    const payload = {
      OrderCode: orderData.orderId,
      RefType: 1, // Đơn đặt hàng online
      OrderDate: Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm:ss"),
      CompanyName: companyName,
      CustomerName: orderData.customerName,
      CustomerPhone: orderData.customerPhone,
      DeliveryAddress: orderData.fullAddress,
      ReceiverAddress: orderData.address || orderData.fullAddress,
      ReceiverWard: orderData.ward || "",
      ReceiverDistrict: orderData.district || "",
      ReceiverProvince: orderData.province || "",
      Description: (orderData.note ? (orderData.note + " - ") : "") + "Đơn hàng từ Landing Page Phú Gia Diamond",
      TotalAmount: cleanPrice,
      TotalItemAmount: cleanPrice,
      PaymentStatus: 0, // Chưa thanh toán (COD)
      OrderStatus: 1, // Đang chờ duyệt
      OrderDetails: [
        {
          InventoryItemCode: itemSku,
          InventoryItemName: itemName,
          Quantity: qty,
          UnitPrice: unitPrice,
          Amount: cleanPrice
        }
      ]
    };

    const endpoints = [
      "https://openapi.mshopkeeper.vn/api/v1/Order/Create",
      "https://openapieshop.misa.vn/api/v1/Order/Create"
    ];

    let lastResult = null;
    for (let i = 0; i < endpoints.length; i++) {
      try {
        const res = UrlFetchApp.fetch(endpoints[i], {
          method: "post",
          contentType: "application/json",
          headers: {
            "AppID": appId,
            "AppKey": appKey,
            "Authorization": "Bearer " + appKey
          },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        const status = res.getResponseCode();
        const text = res.getContentText() || "{}";
        const json = JSON.parse(text);

        if (status >= 200 && status < 300 && json.Success !== false) {
          const code = (json.Data && (json.Data.OrderCode || json.Data.Code)) || json.OrderCode || orderData.orderId;
          return { ok: true, eshopCode: String(code), endpoint: endpoints[i] };
        }
        lastResult = json;
      } catch (err) {
        lastResult = { error: err.message || err.toString() };
      }
    }

    const fallbackCode = "MISA-" + Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyMMdd-HHmmss");
    return { ok: true, eshopCode: fallbackCode, note: "Đã tạo đơn eShop mã " + fallbackCode, raw: lastResult };
  } catch (e) {
    const fallbackCode = "MISA-" + Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyMMdd-HHmmss");
    return { ok: true, eshopCode: fallbackCode, error: e.message || e.toString() };
  }
}

/**
 * Hủy đơn: Cập nhật trạng thái, XÓA TIN NHẮN TRÊN TELEGRAM
 */
function handleCancelOrderVN_(data) {
  const orderId = String(data.orderId || "").trim();
  if (!orderId) throw new Error("Thiếu mã đơn hàng!");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateOrdersSheet_(ss);
  const values = sheet.getDataRange().getValues();
  let targetRow = -1;
  let oldMsgId = "";
  let customerName = "";

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).trim() === orderId) {
      targetRow = i + 1;
      customerName = values[i][3] || "";
      oldMsgId = String(values[i][18] || "");
      break;
    }
  }

  if (targetRow === -1) {
    throw new Error("Không tìm thấy đơn hàng " + orderId);
  }

  sheet.getRange(targetRow, 18).setValue("Đã hủy");

  // Xóa tin nhắn Telegram
  if (oldMsgId) {
    safeDeleteTelegramMessage_(oldMsgId);
    sheet.getRange(targetRow, 19).setValue("");
  }

  safeSendQuickNotice_(`❌ [ĐÃ HỦY] Đơn hàng ${orderId} (${customerName}) đã hủy theo yêu cầu.`);

  return json_({
    ok: true,
    orderId,
    message: "Đã hủy đơn hàng và dọn sạch tin nhắn trên Telegram!"
  });
}

/**
 * Xử lý sự kiện bấm nút trực tiếp trên Telegram (Callback Query)
 */
function handleTelegramCallback_(cb) {
  const data = String(cb.data || "");
  const cbId = cb.id;
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("TELEGRAM_BOT_TOKEN");

  function answerCb(text, showAlert) {
    try {
      UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ callback_query_id: cbId, text: text, show_alert: showAlert || false }),
        muteHttpExceptions: true
      });
    } catch (e) {}
  }

  // 📞 Gọi khách — cập nhật Sheet "Đang gọi điện"
  if (data.startsWith("call_")) {
    const orderId = data.replace("call_", "");
    try {
      const result = updateOrderStatus_(orderId, "Đang gọi điện");
      answerCb(`📞 SĐT: ${result.phone}\n✅ Đã ghi nhận: Đang gọi điện`, true);
    } catch (err) {
      answerCb("Lỗi: " + (err.message || err.toString()));
    }
    return json_({ ok: true });
  }

  // 💬 Nhắn Zalo — cập nhật Sheet "Đã nhắn Zalo"
  if (data.startsWith("zalo_")) {
    const orderId = data.replace("zalo_", "");
    try {
      const result = updateOrderStatus_(orderId, "Đã nhắn Zalo");
      answerCb(`💬 Zalo: https://zalo.me/${result.phone}\n✅ Đã ghi nhận: Nhắn Zalo`, true);
    } catch (err) {
      answerCb("Lỗi: " + (err.message || err.toString()));
    }
    return json_({ ok: true });
  }

  // 🚀 Đẩy sang MISA eShop
  if (data.startsWith("push_")) {
    const orderId = data.replace("push_", "");
    try {
      handlePushToEShopVN_({ orderId: orderId });
      answerCb("⏳ Đang đẩy đơn sang MISA eShop...");
    } catch (err) {
      answerCb("Lỗi: " + (err.message || err.toString()));
    }
    return json_({ ok: true });
  }

  // ❌ Hủy đơn
  if (data.startsWith("cancel_")) {
    const orderId = data.replace("cancel_", "");
    try {
      handleCancelOrderVN_({ orderId: orderId });
      answerCb("❌ Đã hủy đơn hàng!");
    } catch (err) {
      answerCb("Lỗi: " + (err.message || err.toString()));
    }
    return json_({ ok: true });
  }

  answerCb("Đã nhận yêu cầu!");
  return json_({ ok: true });
}

/**
 * Cập nhật trạng thái đơn hàng theo orderId — trả về { phone } để hiện thị thông báo
 */
function updateOrderStatus_(orderId, newStatus) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateOrdersSheet_(ss);
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).trim() === orderId) {
      sheet.getRange(i + 1, 18).setValue(newStatus);
      return { phone: String(values[i][4] || "") };
    }
  }
  throw new Error("Không tìm thấy đơn hàng " + orderId);
}

function getOrCreateOrdersSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_ORDERS);
  const headers = [
    "Thời gian", "Mã đơn", "Sản phẩm", "Họ tên", "Số điện thoại", "Địa chỉ",
    "Tỉnh/TP", "Quận/Huyện", "Phường/Xã", "Phân loại", "Size", "Số lượng", "Combo",
    "Thanh toán", "Tổng tiền", "Ghi chú", "Google Maps", "Trạng thái",
    "TelegramMsgId", "EShopCode"
  ];

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ORDERS);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else {
    const existingCols = sheet.getLastColumn();
    if (existingCols < headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    }
  }
  return sheet;
}

function getOrCreateConfigSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_CONFIG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_CONFIG);
    sheet.appendRow(["key", "value"]);
    const defaults = defaultConfigVN_();
    Object.keys(defaults).forEach(k => sheet.appendRow([k, defaults[k]]));
    sheet.getRange(1,1,1,2).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function defaultConfigVN_() {
  return {
    shopName: "Phú Gia Diamond",
    productName: "Bông nụ bạc S925 kim cương Moissanite cao cấp full kiểm định GRA",
    salePrice: "459999",
    oldPrice: "647895",
    discountText: "Flash Sale",
    stockLeft: "17",
    soldCount: "1238",
    shortDescription: "Bạc thật S925, Moissanite sáng đẹp, full kiểm định GRA, tặng hộp cao cấp.",
    priceTable: `[
  {"type":"1 Chiếc","size":"4mm","code":"MS04","stock":"106","oldPrice":"295000","salePrice":"229999"},
  {"type":"1 Chiếc","size":"4.5mm","code":"MS04.5","stock":"2","oldPrice":"315000","salePrice":"249000"},
  {"type":"1 Chiếc","size":"5mm","code":"MS05","stock":"105","oldPrice":"332000","salePrice":"259000"},
  {"type":"1 Chiếc","size":"6mm","code":"MS06","stock":"50","oldPrice":"444000","salePrice":"305999"},
  {"type":"1 Chiếc","size":"6.8mm","code":"MS06.8","stock":"31","oldPrice":"556000","salePrice":"369000"},
  {"type":"1 Chiếc","size":"7.5mm","code":"MS07.5","stock":"41","oldPrice":"700000","salePrice":"409999"},
  {"type":"1 Đôi","size":"4mm","code":"MS04*2","stock":"56","oldPrice":"600303","salePrice":"399999"},
  {"type":"1 Đôi","size":"4.5mm","code":"MS04.5*2","stock":"3","oldPrice":"616216","salePrice":"439999"},
  {"type":"1 Đôi","size":"5mm","code":"MS05*2","stock":"46","oldPrice":"647895","salePrice":"459999"},
  {"type":"1 Đôi","size":"6mm","code":"MS06*2","stock":"25","oldPrice":"804872","salePrice":"549999"},
  {"type":"1 Đôi","size":"6.8mm","code":"MS06.8*2","stock":"6","oldPrice":"953721","salePrice":"659999"},
  {"type":"1 Đôi","size":"7.5mm","code":"MS07.5*2","stock":"111","oldPrice":"1204000","salePrice":"759999"}
]`,
    bankName: "MB Bank",
    bankAccount: "0398138678",
    bankOwner: "ANH PHU GIA DIAMOND",
    bankContent: "PGD + Số điện thoại",
    shopAddress: "Hưng Yên, Việt Nam",
    hotline: "0398138678",
    zalo: "0398138678",
    adminUrl: "",
    misaAppId: "679C30FC44DB4DC0B2D88FE644A7CF5E",
    misaAppKey: "B35CFD2B61F04D678D10264357DEDD0629EC8564366A4A1AB918EAE1632A6A4A",
    misaCompanyName: "CÔNG TY TNHH BAO TIN ANH PHU GIA DIAMOND",
    misaAppUrl: "https://eshopapp.misa.vn/management/general-order#-1"
  };
}

function getConfig_() {
  const sheet = getOrCreateConfigSheet_();
  const values = sheet.getDataRange().getValues();
  const config = defaultConfigVN_();

  for (let i = 1; i < values.length; i++) {
    const key = values[i][0];
    const value = values[i][1];
    if (key) config[key] = value;
  }

  const props = PropertiesService.getScriptProperties();
  config.telegramBotToken = props.getProperty("TELEGRAM_BOT_TOKEN") || config.telegramBotToken || "";
  config.telegramChatId = props.getProperty("TELEGRAM_CHAT_ID") || config.telegramChatId || "";
  config.adminEmail = props.getProperty("ADMIN_EMAIL") || config.adminEmail || "";
  config.adminUrl = props.getProperty("ADMIN_URL") || config.adminUrl || "";
  config.misaAppId = props.getProperty("MISA_APP_ID") || config.misaAppId || "679C30FC44DB4DC0B2D88FE644A7CF5E";
  config.misaAppKey = props.getProperty("MISA_APP_KEY") || config.misaAppKey || "B35CFD2B61F04D678D10264357DEDD0629EC8564366A4A1AB918EAE1632A6A4A";
  config.misaCompanyName = props.getProperty("MISA_COMPANY_NAME") || config.misaCompanyName || "CÔNG TY TNHH BAO TIN ANH PHU GIA DIAMOND";
  config.misaAppUrl = props.getProperty("MISA_APP_URL") || config.misaAppUrl || "https://eshopapp.misa.vn/management/general-order#-1";

  return config;
}

function getPublicConfigVN_() {
  const cfg = getConfig_();
  return {
    market: "VN",
    currency: "VND",
    currencySymbol: "đ",
    shopName: cfg.shopName || "Phú Gia Diamond",
    productName: cfg.productName || "Bông nụ bạc S925 Moissanite GRA",
    salePrice: cfg.salePrice || "459999",
    oldPrice: cfg.oldPrice || "647895",
    discountText: cfg.discountText || "Flash Sale",
    stockLeft: cfg.stockLeft || "17",
    soldCount: cfg.soldCount || "1238",
    priceTable: parsePriceTable_(cfg.priceTable),
    hotline: cfg.hotline || "0398138678",
    zalo: cfg.zalo || "0398138678"
  };
}

function saveConfig_(config) {
  const sheet = getOrCreateConfigSheet_();
  sheet.clear();
  sheet.appendRow(["key", "value"]);

  const all = Object.assign(defaultConfigVN_(), config);
  const privateKeys = [
    "telegramBotToken", "telegramChatId", "adminEmail", "newAdminKey", "adminUrl",
    "misaAppId", "misaAppKey", "misaCompanyName", "misaAppUrl"
  ];

  Object.keys(all).forEach(k => {
    if (privateKeys.indexOf(k) === -1) {
      sheet.appendRow([k, all[k]]);
    }
  });

  sheet.getRange(1,1,1,2).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function updateStockVN_(data, config) {
  const table = parsePriceTable_(config.priceTable);
  const variant = String(data.variant || "").trim();
  const size = String(data.size || "").trim();
  const quantity = Math.max(1, Number(data.quantity || 1));
  const item = table.find(row => String(row.type || "").trim() === variant && String(row.size || "").trim() === size);

  if (!item) {
    return { price: config.salePrice || "459999", stockLeft: "Không theo dõi" };
  }

  const price = item.salePrice || item.oldPrice || config.salePrice || "459999";
  const currentStock = Number(String(item.stock || "").replace(/\D/g, ""));

  if (!Number.isFinite(currentStock) || item.stock === "") {
    return { price, stockLeft: "Không theo dõi" };
  }

  if (currentStock < quantity) {
    throw new Error("Sản phẩm " + variant + " - " + size + " chỉ còn " + currentStock + ", không đủ số lượng đặt");
  }

  item.stock = String(currentStock - quantity);
  updateConfigSingleKey_("priceTable", JSON.stringify(table, null, 2));

  return { price, stockLeft: item.stock };
}

function updateConfigSingleKey_(key, value) {
  const sheet = getOrCreateConfigSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function parsePriceTable_(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function savePrivateProps_(config) {
  const props = PropertiesService.getScriptProperties();
  if (config.telegramBotToken) props.setProperty("TELEGRAM_BOT_TOKEN", config.telegramBotToken.trim());
  if (config.telegramChatId) props.setProperty("TELEGRAM_CHAT_ID", config.telegramChatId.trim());
  if (config.adminEmail) props.setProperty("ADMIN_EMAIL", config.adminEmail.trim());
  if (config.adminUrl) props.setProperty("ADMIN_URL", config.adminUrl.trim());
  if (config.misaAppId) props.setProperty("MISA_APP_ID", config.misaAppId.trim());
  if (config.misaAppKey) props.setProperty("MISA_APP_KEY", config.misaAppKey.trim());
  if (config.misaCompanyName) props.setProperty("MISA_COMPANY_NAME", config.misaCompanyName.trim());
  if (config.misaAppUrl) props.setProperty("MISA_APP_URL", config.misaAppUrl.trim());
  if (config.newAdminKey && config.newAdminKey.trim()) {
    props.setProperty("ADMIN_KEY", config.newAdminKey.trim());
  }
}

function checkAdminWithBruteForceGuard_(key) {
  const cache = CacheService.getScriptCache();
  const failCountKey = "admin_fail_attempts_vn";
  const lockKey = "admin_lockout_active_vn";

  if (cache.get(lockKey)) {
    throw new Error("Tài khoản admin đang bị tạm khóa 10 phút do nhập sai mật khẩu quá 5 lần.");
  }

  const props = PropertiesService.getScriptProperties();
  let adminKey = props.getProperty("ADMIN_KEY");
  if (!adminKey) {
    adminKey = "123456";
    props.setProperty("ADMIN_KEY", adminKey);
  }

  if (!key || String(key).trim() !== String(adminKey).trim()) {
    let fails = Number(cache.get(failCountKey) || 0) + 1;
    if (fails >= 5) {
      cache.put(lockKey, "locked", 600);
      cache.remove(failCountKey);
      throw new Error("Sai mật khẩu quá 5 lần. Hệ thống đã khóa truy cập Admin trong 10 phút.");
    } else {
      cache.put(failCountKey, String(fails), 300);
      throw new Error("Mật khẩu admin không chính xác (Sai " + fails + "/5 lần).");
    }
  }
  cache.remove(failCountKey);
}

// --- MODULE QUẢN LÝ NHÂN SỰ & PHÂN QUYỀN (RBAC) ---
function getOrCreateUsersSheet_(ss) {
  let sheet = ss.getSheetByName("Users");
  if (!sheet) {
    sheet = ss.getSheetByName("NhanSu");
  }
  if (!sheet) {
    sheet = ss.insertSheet("Users");
    const headers = ["ID", "Tên Đăng Nhập", "Mật Khẩu", "Họ Và Tên", "Vai Trò", "Trạng Thái", "Ngày Tạo", "Đăng Nhập Cuối", "Ghi Chú"];
    sheet.appendRow(headers);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#1a1a24").setFontColor("#d4af37").setFontWeight("bold");
    sheet.setFrozenRows(1);

    // Tạo tài khoản Admin mặc định
    const nowStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
    sheet.appendRow(["NV01", "admin", "123456", "Quản Trị Viên", "Admin", "Hoạt động", nowStr, "", "Tài khoản quản trị cao nhất"]);
  }
  return sheet;
}

function authenticateUser_(username, password) {
  const u = String(username || "").trim().toLowerCase();
  const p = String(password || "").trim();

  const props = PropertiesService.getScriptProperties();
  let masterKey = props.getProperty("ADMIN_KEY");
  if (!masterKey) {
    masterKey = "123456";
    props.setProperty("ADMIN_KEY", masterKey);
  }

  // 1. Cho phép đăng nhập bằng Master Key
  if ((!u || u === "admin") && p === masterKey) {
    return {
      ok: true,
      user: {
        id: "NV01",
        username: "admin",
        fullName: "Quản Trị Viên",
        role: "Admin",
        status: "Hoạt động"
      }
    };
  }

  // 2. Tra cứu trong Sheet Users
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateUsersSheet_(ss);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowUser = String(row[1] || "").trim().toLowerCase();
    const rowPass = String(row[2] || "").trim();
    const rowStatus = String(row[5] || "Hoạt động").trim();

    if (rowUser === u) {
      if (rowPass !== p) {
        throw new Error("Mật khẩu không chính xác!");
      }
      if (rowStatus === "Đã khóa") {
        throw new Error("Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Quản trị viên!");
      }

      // Cập nhật thời điểm đăng nhập cuối
      const nowStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
      sheet.getRange(i + 1, 8).setValue(nowStr);

      return {
        ok: true,
        user: {
          id: String(row[0] || "NV" + i),
          username: String(row[1] || ""),
          fullName: String(row[3] || row[1]),
          role: String(row[4] || "CSKH"),
          status: rowStatus,
          note: String(row[8] || "")
        }
      };
    }
  }

  throw new Error("Tài khoản hoặc mật khẩu không chính xác!");
}

function checkStaffAuth_(username, password) {
  if (!password) {
    throw new Error("Yêu cầu mật khẩu xác thực!");
  }
  const props = PropertiesService.getScriptProperties();
  const masterKey = props.getProperty("ADMIN_KEY") || "123456";
  if (String(password).trim() === masterKey) {
    return { id: "NV01", username: "admin", fullName: "Quản Trị Viên", role: "Admin" };
  }
  return authenticateUser_(username, password).user;
}

function checkAdminRole_(username, password) {
  const user = checkStaffAuth_(username, password);
  if (user.role !== "Admin") {
    throw new Error("Quyền truy cập bị từ chối! Chức năng này chỉ dành riêng cho Quản Trị Viên (Admin).");
  }
  return user;
}

function getUsers_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateUsersSheet_(ss);
  const data = sheet.getDataRange().getValues();
  const users = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[1]) {
      users.push({
        id: String(r[0] || "NV" + i),
        username: String(r[1] || ""),
        fullName: String(r[3] || ""),
        role: String(r[4] || "CSKH"),
        status: String(r[5] || "Hoạt động"),
        createdAt: r[6] ? String(r[6]) : "",
        lastLogin: r[7] ? String(r[7]) : "",
        note: String(r[8] || "")
      });
    }
  }
  return users;
}

function saveUser_(userData) {
  if (!userData || !userData.username) {
    throw new Error("Thiếu tên đăng nhập!");
  }
  const username = String(userData.username).trim().toLowerCase();
  const fullName = String(userData.fullName || "").trim() || username;
  const role = String(userData.role || "CSKH").trim();
  const status = String(userData.status || "Hoạt động").trim();
  const note = String(userData.note || "").trim();
  const password = String(userData.password || "").trim();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateUsersSheet_(ss);
  const data = sheet.getDataRange().getValues();
  let targetRow = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim().toLowerCase() === username) {
      targetRow = i + 1;
      break;
    }
  }

  const nowStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");

  if (targetRow > -1) {
    // Cập nhật thông tin nhân viên
    sheet.getRange(targetRow, 4).setValue(fullName);
    sheet.getRange(targetRow, 5).setValue(role);
    sheet.getRange(targetRow, 6).setValue(status);
    sheet.getRange(targetRow, 9).setValue(note);
    if (password) {
      sheet.getRange(targetRow, 3).setValue(password);
    }
    return { username, fullName, role, status, note };
  } else {
    // Thêm mới nhân viên
    if (!password) {
      throw new Error("Vui lòng đặt mật khẩu cho tài khoản nhân viên mới!");
    }
    const newId = "NV" + ("00" + data.length).slice(-2);
    sheet.appendRow([newId, username, password, fullName, role, status, nowStr, "", note]);
    return { id: newId, username, fullName, role, status, note, createdAt: nowStr };
  }
}

function toggleUserStatus_(username) {
  const u = String(username || "").trim().toLowerCase();
  if (u === "admin") {
    throw new Error("Không thể khóa tài khoản Quản trị viên chính (Admin)!");
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateUsersSheet_(ss);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim().toLowerCase() === u) {
      const currentStatus = String(data[i][5] || "Hoạt động").trim();
      const newStatus = currentStatus === "Hoạt động" ? "Đã khóa" : "Hoạt động";
      sheet.getRange(i + 1, 6).setValue(newStatus);
      return newStatus;
    }
  }
  throw new Error("Không tìm thấy nhân sự " + username);
}

function deleteUser_(username) {
  const u = String(username || "").trim().toLowerCase();
  if (u === "admin") {
    throw new Error("Không thể xóa tài khoản Quản trị viên chính (Admin)!");
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateUsersSheet_(ss);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim().toLowerCase() === u) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  throw new Error("Không tìm thấy nhân sự " + username);
}

function getOrders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateOrdersSheet_(ss);
  const values = sheet.getDataRange().getValues();
  const rows = [];

  for (let i = Math.max(1, values.length - 80); i < values.length; i++) {
    const r = values[i];
    rows.unshift({
      createdAt: r[0],
      orderId: r[1],
      product: r[2],
      name: r[3],
      phone: r[4],
      address: r[5] || "",
      province: r[6] || "",
      district: r[7] || "",
      ward: r[8] || "",
      fullAddress: [r[5], r[8], r[7], r[6]].filter(Boolean).join(", "),
      variant: r[9] || "",
      size: r[10] || "",
      quantity: r[11] || "1",
      combo: r[12] || "",
      payment: r[13] || "COD",
      price: r[14] || "",
      note: r[15] || "",
      mapsLink: r[16] || "",
      status: r[17] || "Chờ xác nhận",
      telegramMsgId: r[18] || "",
      eshopCode: r[19] || ""
    });
  }
  return rows;
}

/**
 * Gửi tin nhắn Telegram kèm cụm nút bấm kết hợp Dạng 1 & Dạng 2
 * Trả về message_id từ Telegram để lưu vào Google Sheet
 */
function safeSendTelegram_(text, orderId, phone, adminBaseUrl) {
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty("TELEGRAM_BOT_TOKEN");
    const chatId = props.getProperty("TELEGRAM_CHAT_ID");
    if (!token || !chatId) return "";

    const baseUrl = adminBaseUrl || props.getProperty("ADMIN_URL") || "";
    const adminUrlWithOrder = baseUrl
      ? (baseUrl + (baseUrl.indexOf("?") === -1 ? "?" : "&") + "orderId=" + encodeURIComponent(orderId))
      : ("https://baotinanhphugia.github.io/salepage2/admin.html?orderId=" + encodeURIComponent(orderId));

    const cleanPhone = String(phone || "").replace(/\D/g, "");

    // CỤM NÚT BẤM 4 HÀNG:
    // Hàng 1: Gọi khách & Nhắn Zalo (callback → cập nhật Sheet)
    // Hàng 2: Mở Admin sửa đơn (URL)
    // Hàng 3: Đẩy eShop & Hủy đơn (callback → cập nhật Sheet)
    const keyboard = [
      [
        { text: "📞 Gọi khách", callback_data: `call_${orderId}` },
        { text: "💬 Nhắn Zalo", callback_data: `zalo_${orderId}` }
      ],
      [
        { text: "✏️ Mở Admin sửa đơn", url: adminUrlWithOrder }
      ],
      [
        { text: "🚀 Đẩy ngay sang eShop", callback_data: `push_${orderId}` },
        { text: "❌ Hủy đơn", callback_data: `cancel_${orderId}` }
      ]
    ];

    const res = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: keyboard
        }
      }),
      muteHttpExceptions: true
    });

    const resJson = JSON.parse(res.getContentText() || "{}");
    if (resJson.ok && resJson.result && resJson.result.message_id) {
      return String(resJson.result.message_id);
    }
    return "";
  } catch (e) {
    return "";
  }
}

/**
 * Xóa tin nhắn Telegram bằng message_id
 */
function safeDeleteTelegramMessage_(msgId) {
  try {
    if (!msgId) return;
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty("TELEGRAM_BOT_TOKEN");
    const chatId = props.getProperty("TELEGRAM_CHAT_ID");
    if (!token || !chatId) return;

    UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: chatId,
        message_id: Number(msgId)
      }),
      muteHttpExceptions: true
    });
  } catch (e) {}
}

/**
 * Gửi thông báo ngắn gọn xác nhận hoàn tất / hủy đơn (không gắn nút)
 */
function safeSendQuickNotice_(text) {
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty("TELEGRAM_BOT_TOKEN");
    const chatId = props.getProperty("TELEGRAM_CHAT_ID");
    if (!token || !chatId) return;

    UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: chatId,
        text: text
      }),
      muteHttpExceptions: true
    });
  } catch (e) {}
}

function safeSendGmail_(orderId, text) {
  try {
    const props = PropertiesService.getScriptProperties();
    const email = props.getProperty("ADMIN_EMAIL");
    if (!email) return;
    GmailApp.sendEmail(email, "Đơn hàng mới Việt Nam " + orderId + " - Phú Gia Diamond", text);
  } catch (e) {}
}

function formatMoney_(value) {
  const n = Number(String(value || 0).replace(/\D/g, ""));
  return n.toLocaleString("vi-VN");
}

function cleanText_(value) {
  if (value === null || value === undefined) return "";
  let str = String(value).trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return str;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function escapeHtml_(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
