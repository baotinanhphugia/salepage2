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

    // 1. Admin lấy cấu hình
    if (data.action === "adminConfig") {
      checkAdminWithBruteForceGuard_(data.key || data.password);
      return json_({ ok: true, config: getConfig_() });
    }

    // 2. Admin xem danh sách đơn hàng
    if (data.action === "orders") {
      checkAdminWithBruteForceGuard_(data.key || data.password);
      return json_({ ok: true, orders: getOrders_() });
    }

    // 3. Admin lưu cấu hình
    if (data.action === "saveConfig") {
      checkAdminWithBruteForceGuard_(data.key || data.password);
      saveConfig_(data.config || {});
      savePrivateProps_(data.config || {});
      return json_({ ok: true });
    }

    // 4. Admin sửa đơn hàng (Xoá tin cũ trên Telegram, gửi lại tin mới cập nhật)
    if (data.action === "updateOrder") {
      checkAdminWithBruteForceGuard_(data.key || data.password);
      return handleUpdateOrderVN_(data);
    }

    // 5. Admin xác nhận đẩy đơn sang eShop (Hoàn tất -> Xóa tin Telegram)
    if (data.action === "pushToEShop") {
      checkAdminWithBruteForceGuard_(data.key || data.password);
      return handlePushToEShopVN_(data);
    }

    // 6. Admin hủy đơn (Khách bom / không mua -> Xóa tin Telegram)
    if (data.action === "cancelOrder") {
      checkAdminWithBruteForceGuard_(data.key || data.password);
      return handleCancelOrderVN_(data);
    }

    // 7. Khách đặt hàng từ Landing Page Việt Nam
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

    // Bắn tin nhắn Telegram kèm cụm nút bấm kết hợp (Dạng 1 & Dạng 2)
    const message =
`💎 🇻🇳 ĐƠN HÀNG MỚI (VIỆT NAM) - PHÚ GIA DIAMOND
🧾 Mã đơn: ${orderId}
👤 Khách hàng: ${cleanText_(data.name || "")}
📞 Số điện thoại: ${cleanText_(data.phone || "")}
📍 Địa chỉ: ${fullAddress}
🗺 Google Maps: ${mapsLink}
💍 Sản phẩm: ${productName}
📦 Phân loại: ${cleanText_(data.variant || "")}
📏 Kích cỡ đá: ${cleanText_(data.size || "")}
🔢 Số lượng: ${cleanText_(data.quantity || "1")}
🎁 Combo: ${cleanText_(data.combo || "")}
💳 Thanh toán: ${cleanText_(data.payment || "COD")}
💰 Tổng thu COD: ${priceFormatted}
📦 Kho còn: ${stockResult.stockLeft}
📝 Ghi chú: ${cleanText_(data.note || "Không có")}
🕒 Thời gian: ${createdAt}`;

    const cleanPhone = cleanText_(data.phone || "");
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
  const note = cleanText_(data.note || "");
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

  // 2. GỬI LẠI TIN MỚI CẬP NHẬT KÈM ĐẦY ĐỦ CỤM NÚT BẤM
  const updatedTime = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
  const formattedPrice = price.endsWith("đ") ? price : formatMoney_(price) + "đ";

  const newMessage =
`💎 🇻🇳 [ĐÃ CẬP NHẬT] ĐƠN HÀNG - PHÚ GIA DIAMOND
🧾 Mã đơn: ${orderId}
👤 Khách hàng: ${name}
📞 Số điện thoại: ${phone}
📍 Địa chỉ mới: ${fullAddress}
🗺 Google Maps: ${mapsLink}
💍 Phân loại: ${variant}
📏 Kích cỡ đá: ${size}
🔢 Số lượng: ${quantity}
💰 Tổng thu COD: ${formattedPrice}
📝 Ghi chú: ${note || "Không có"}
🕒 Cập nhật lúc: ${updatedTime}`;

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
 * Đẩy đơn sang eShop: Đổi trạng thái trong Sheet, TỰ ĐỘNG XOÁ TIN NHẮN TRÊN TELEGRAM (Hoàn tất)
 */
function handlePushToEShopVN_(data) {
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

  // 1. Cập nhật trạng thái trong Sheet
  sheet.getRange(targetRow, 18).setValue("Đã đẩy eShop");
  const eshopCode = "ES-" + Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyMMdd-HHmmss");
  sheet.getRange(targetRow, 20).setValue(eshopCode);

  // 2. XOÁ TIN NHẮN TRÊN TELEGRAM (CÔNG VIỆC HOÀN THÀNH - INBOX ZERO!)
  if (oldMsgId) {
    safeDeleteTelegramMessage_(oldMsgId);
    sheet.getRange(targetRow, 19).setValue(""); // Xóa ID tin nhắn vì đã hoàn tất
  }

  // 3. Gửi thông báo ngắn gọn xác nhận hoàn tất
  safeSendQuickNotice_(`✅ [HOÀN TẤT] Đơn hàng ${orderId} (${customerName}) đã được đẩy sang eShop thành công! Mã eShop: ${eshopCode}`);

  return json_({
    ok: true,
    orderId,
    eshopCode,
    message: "Đã đẩy đơn sang eShop thành công! Tin nhắn Telegram đã được dọn sạch."
  });
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

  function answerCb(text) {
    try {
      UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ callback_query_id: cbId, text: text, show_alert: false }),
        muteHttpExceptions: true
      });
    } catch (e) {}
  }

  if (data.startsWith("push_")) {
    const orderId = data.replace("push_", "");
    try {
      handlePushToEShopVN_({ orderId: orderId });
      answerCb("✅ Đã đẩy sang eShop và dọn tin Telegram!");
    } catch (err) {
      answerCb("Lỗi: " + (err.message || err.toString()));
    }
    return json_({ ok: true });
  }

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
    adminUrl: ""
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
  const privateKeys = ["telegramBotToken", "telegramChatId", "adminEmail", "newAdminKey", "adminUrl"];

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
      : ("https://phugiadiamond.com/admin.html?orderId=" + encodeURIComponent(orderId));

    const cleanPhone = String(phone || "").replace(/\D/g, "");

    // CỤM NÚT BẤM KẾT HỢP DẠNG 1 & DẠNG 2:
    // Hàng 1: Nút URL (Gọi điện & Mở Admin sửa đơn)
    // Hàng 2: Nút Callback trực tiếp (Đẩy eShop & Hủy đơn)
    const keyboard = [
      [
        { text: "📞 Gọi cho khách", url: `tel:${cleanPhone}` },
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
