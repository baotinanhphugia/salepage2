#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MISA eShop Sync Runner - Phú Gia Diamond
Tự động đồng bộ đơn hàng nháp sang MISA eShop khi duyệt từ Telegram Bot hoặc trang Web Admin.
Chạy trực tiếp trên máy Mac (IP 123.26.190.185 được cấp phép Open API).
"""

import os
import time
import json
import re
import hmac
import hashlib
import uuid
import threading
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# --- CẤU HÌNH HỆ THỐNG ---
MISA_APP_ID = "679C30FC44DB4DC0B2D88FE644A7CF5E"
MISA_APP_KEY = "B35CFD2B61F04D678D10264357DEDD0629EC8564366A4A1AB918EAE1632A6A4A"
MISA_BRANCH_ID = "a38f9189-ad87-11ef-a35e-005056b28600" # ChiNhanh01
MISA_STOCK_ID = "485b5d06-306c-11f0-b467-005056b34af7"  # Kho hàng hóa
MISA_DEFAULT_CUSTOMER = "bf4e7242-a3d4-4ae8-aae5-258b110dbcf6"

APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyOi8Tt24hjx2iaJyGRD0tQhx4hYK3KRjYlFdWnQUyM1uf-TrGiGZwfyzEyY83_33LU/exec"
ADMIN_KEY = "123456"
TELEGRAM_BOT_TOKEN = "8658895620:AAE06m6t4C2PWSKILT8zAD6ElOZ45Lod3Fk"
TELEGRAM_CHAT_ID = "8861179828"

LOCAL_PORT = 8899
POLL_INTERVAL_SECONDS = 4
SPX_SCAN_INTERVAL_SECONDS = 900  # 15 phút quét tự động hành trình SPX 1 lần

# Danh mục hàng hóa mapping chuẩn trên MISA eShop
MISA_INVENTORY = {
    # Dòng 4 chấu bạc mạ rhodium Moissanite thực tế theo bảng giá Shop
    "NK 4C -5LY": {"id": "d3d77ffc-7476-450e-b987-4a89686f4374", "sku": "NK 4C -5LY", "name": "1 ĐÔI - Bông tai bạc 925 mạ rhodium đính đá moissanite 4 chấu (đá 5mm)", "unit_id": None, "unit_name": None, "is_pair": True, "type": 3},
    "4C-5mm-NK": {"id": "7afdfadf-8262-4065-9c80-5114ad63e12b", "sku": "4C-5mm-NK", "name": "Bông tai bạc 925 mạ rhodium đính đá moissanite 4 chấu (đá 5mm)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False, "type": 1},

    "NK 4C -4LY": {"id": "5f59285b-cdc4-4df0-a3b9-29b838d624c5", "sku": "NK 4C -4LY", "name": "Bông tai bạc 925 mạ rhodium đính đá moissanite 4 chấu(đá 4mm)", "unit_id": None, "unit_name": None, "is_pair": True, "type": 3},
    "4C-4mm-NK": {"id": "e99ce811-41a1-4410-b304-d596aeffb859", "sku": "4C-4mm-NK", "name": "Bông tai bạc 925 mạ rhodium đính đá moissanite 4 chấu(đá 4mm)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False, "type": 1},

    "NK 4C-4.5LY": {"id": "215d9d87-e183-40b6-9fbb-92480059edfd", "sku": "NK 4C-4.5LY", "name": "1 ĐÔI - Bông tai bạc 925 mạ rhodium đinh đá moissanite 4 chấu(đá 4.5mm)", "unit_id": None, "unit_name": None, "is_pair": True, "type": 3},
    "4C-4.5mm-NK": {"id": "a5864e9b-ea53-4e67-947c-a630aa505ab5", "sku": "4C-4.5mm-NK", "name": "Bông tai bạc 925 mạ rhodium đinh đá moissanite 4 chấu(đá 4.5mm)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False, "type": 1},

    "NK 4C -6LY": {"id": "5235e2e2-268f-436a-976f-1e241a402f6f", "sku": "NK 4C -6LY", "name": "1 ĐÔI - Bông tai bạc 925 mạ rhodium đính đá moissanite 4 chấu (đá 6mm)", "unit_id": None, "unit_name": None, "is_pair": True, "type": 3},
    "4C-6mm-NK": {"id": "d10aae52-1b8e-4c4b-b223-b1bf57c89380", "sku": "4C-6mm-NK", "name": "Bông tai bạc 925 mạ rhodium đính đá moissanite 4 chấu (đá 6mm)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False, "type": 1},

    "NK 4C -7LY": {"id": "6f3a247c-3f31-40b1-ae1a-6e1efb9c9cde", "sku": "NK 4C -7LY", "name": "1 ĐÔI - Bông tai bạc 925 mạ rhodium đính đá moissanite 4 chấu (đá 7mm)", "unit_id": None, "unit_name": None, "is_pair": True, "type": 3},
    "4C-7mm-NK": {"id": "d125f2c1-f5c8-432b-b288-3c28ea37f104", "sku": "4C-7mm-NK", "name": "Bông tai bạc 925 mạ rhodium đính đá moissanite 4 chấu (đá 7mm)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False, "type": 1},

    "NK 4C-7.5LY": {"id": "bd7edfe5-cd16-4bec-80ef-59732ced0633", "sku": "NK 4C-7.5LY", "name": "1 ĐÔI - Bông tai bạc 925 mạ rhodium đính đá moissanite 4 chấu (đá 7.5mm)", "unit_id": None, "unit_name": None, "is_pair": True, "type": 3},
    "4C-7.5mm-NK": {"id": "618b1c14-62c0-40b7-ab32-cabdb59033dc", "sku": "4C-7.5mm-NK", "name": "Bông tai bạc 925 mạ rhodium đính đá moissanite 4 chấu (đá 7.5mm)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False, "type": 1},

    # 1 Đôi (Mã Bộ truyền thống)
    "BNM6B01": {"id": "841beb30-0614-4233-b6b7-c06395964f30", "sku": "MS06-1", "name": "Bông nụ Moissaanite 6mm-S925- BMOI45-1 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},
    "BNM4SB01": {"id": "2f3ac933-7bcd-43a9-9906-74cdde41c702", "sku": "MS 04.5-1", "name": "Bông nụ Moissanite 4.5mm- S925- BMOI42-1 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},
    "MS051": {"id": "cd1ebd5c-0fa0-4e57-8235-c271900b7de8", "sku": "MS05", "name": "Bông nụ Moissanite 5ly-S925 -BMOI144 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},
    "MS041": {"id": "7c74256d-0026-449a-bbb7-47c1d678cee9", "sku": "MS04", "name": "Bông nụ Moissanite 4ly-S925-BMOI143 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},
    "MS0681": {"id": "0459fdc2-126f-47e2-b79f-b3b277bf056e", "sku": "MS06.8", "name": "Bông nụ Moissanite 6ly8-S925-BMOI146 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},
    "MS0751": {"id": "43e2beef-a3d7-4d9f-94bf-353ea991be29", "sku": "MS07.5", "name": "Bông nụ Moissanite 7ly5-S925-BMOI47 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},

    # 1 Chiếc (Mã Lẻ truyền thống)
    "MS06-1": {"id": "841beb30-0614-4233-b6b7-c06395964f30", "sku": "MS06-1", "name": "Bông nụ Moissaanite 6mm-S925- BMOI45-1", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False},
    "MS 04.5-1": {"id": "2f3ac933-7bcd-43a9-9906-74cdde41c702", "sku": "MS 04.5-1", "name": "Bông nụ Moissanite 4.5mm- S925- BMOI42-1", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False},
    "MS05": {"id": "cd1ebd5c-0fa0-4e57-8235-c271900b7de8", "sku": "MS05", "name": "Bông nụ Moissanite 5ly-S925 -BMOI144", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False},
    "MS04": {"id": "7c74256d-0026-449a-bbb7-47c1d678cee9", "sku": "MS04", "name": "Bông nụ Moissanite 4ly-S925-BMOI143", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False},
    "MS06.8": {"id": "0459fdc2-126f-47e2-b79f-b3b277bf056e", "sku": "MS06.8", "name": "Bông nụ Moissanite 6ly8-S925-BMOI146", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False},
    "MS07.5": {"id": "43e2beef-a3d7-4d9f-94bf-353ea991be29", "sku": "MS07.5", "name": "Bông nụ Moissanite 7ly5-S925-BMOI47", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": False},

    # Dòng 6 Chấu (Map về mã vật lý tương ứng 6C...)
    "6 chấu 48": {"id": "8f33a76d-fe84-40ab-8ce5-3e84da8e826c", "sku": "6C48", "name": "Bông nụ 6 chấu Moissanite 4ly -S925-BMOI48 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},
    "6 chấu 50": {"id": "a46fef25-b21c-4b8a-9acf-614accc448b3", "sku": "6C50", "name": "Bông nụ 6 chấu Moissanite 5ly -S925-BMOI50 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},
    "6 chấu 52": {"id": "50bbc7c1-e956-4c6a-9166-1e5c1e77314f", "sku": "6C52", "name": "Bông nụ 6 chấu Moissanite 6Ly -S925-BMOI52 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},
    "6 chấu 53": {"id": "bde95908-e4d5-40ac-b72c-f3659a31aed8", "sku": "6C53", "name": "Bông nụ 6 chấu Moissanite 6ly3 -S925-BMOI53 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},
    "6 chấu 54": {"id": "8b8c4a5d-69f7-4908-b00b-264757938e6f", "sku": "6C54", "name": "Bông nụ 6 chấu Moissanite 7ly -S925-BMOI54 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},
    "6 chấu 56": {"id": "01841d20-de6d-468b-8a29-6c04d4c021ea", "sku": "6C56", "name": "Bông nụ 6 chấu moissanite 8ly -S925-BMOI56 (1 Đôi)", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_pair": True},

    # Phụ kiện đi kèm
    "HOP NHAN": {"id": "ec950be7-bc3b-4bfd-8f7a-05a1685da472", "sku": "HOP NHAN", "name": "Hộp giấy đựng trang sức", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_accessory": True},
    "CARD": {"id": "ef6117d0-79dc-473b-978d-33f0111e85f8", "sku": "CARD", "name": "IN CARD", "unit_id": "097330eb-f92d-4b88-95a8-1a83fd3d8061", "unit_name": "Cái", "is_accessory": True}
}

# Tự động chọn SKU MISA mới nhất theo Size và Phân loại (Chuẩn bảng giá Shop)
SIZE_TO_SKU = {
    "4mm": {"1 Đôi": "NK 4C -4LY", "1 Chiếc": "4C-4mm-NK"},
    "4.5mm": {"1 Đôi": "NK 4C-4.5LY", "1 Chiếc": "4C-4.5mm-NK"},
    "5mm": {"1 Đôi": "NK 4C -5LY", "1 Chiếc": "4C-5mm-NK"},
    "6mm": {"1 Đôi": "NK 4C -6LY", "1 Chiếc": "4C-6mm-NK"},
    "6.8mm": {"1 Đôi": "MS0681", "1 Chiếc": "MS06.8"},
    "7mm": {"1 Đôi": "NK 4C -7LY", "1 Chiếc": "4C-7mm-NK"},
    "7.5mm": {"1 Đôi": "NK 4C-7.5LY", "1 Chiếc": "4C-7.5mm-NK"}
}

# CATALOG tương thích ngược
CATALOG = {
    "4mm": MISA_INVENTORY["NK 4C -4LY"],
    "4.5mm": MISA_INVENTORY["NK 4C-4.5LY"],
    "5mm": MISA_INVENTORY["NK 4C -5LY"],
    "6mm": MISA_INVENTORY["NK 4C -6LY"],
    "6.8mm": MISA_INVENTORY["MS0681"],
    "7mm": MISA_INVENTORY["NK 4C -7LY"],
    "7.5mm": MISA_INVENTORY["NK 4C-7.5LY"]
}
DEFAULT_ITEM = MISA_INVENTORY["NK 4C -5LY"]

# --- QUẢN LÝ TOKEN MISA ---
_cached_token = None
_token_expire_time = 0

def get_misa_token():
    global _cached_token, _token_expire_time
    now = time.time() - 10
    if _cached_token and now < _token_expire_time:
        return _cached_token

    login_time = int(now * 1000)
    raw_str = f"app_id:{MISA_APP_ID};login_time:{login_time}"
    sign = hmac.new(MISA_APP_KEY.encode('utf-8'), raw_str.encode('utf-8'), hashlib.sha256).hexdigest()

    req = urllib.request.Request(
        "https://eshopapp.misa.vn/api/auth-platform/tokens/create",
        data=json.dumps({"app_id": MISA_APP_ID, "login_time": login_time, "sign": sign}).encode('utf-8'),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=10) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        _cached_token = res["Data"]["token"]
        _token_expire_time = now + 1800 # 30 phút
        print(f"[TOKEN] Đã cấp mới Token MISA thành công (hết hạn sau 30 phút).")
        return _cached_token

# --- LẤY DANH SÁCH HÀNG HÓA TỪ MISA ESHOP OPEN API (ĐẦY ĐỦ TẤT CẢ CÁC TRANG) ---
def fetch_misa_inventory_items(search="", max_items=2000):
    try:
        token = get_misa_token()
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
        
        all_items = []
        page = 1
        page_size = 100
        
        while True:
            payload = {"page": page, "page_size": page_size}
            if search:
                payload["keyword"] = str(search).strip()
                
            req = urllib.request.Request(
                "https://eshopapp.misa.vn/api/platform/inventoryitems/list",
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                data_field = res.get("Data", {})
                if isinstance(data_field, dict):
                    raw_list = data_field.get("DictionaryData", []) or []
                    total = data_field.get("Total", len(raw_list))
                elif isinstance(data_field, list):
                    raw_list = data_field
                    total = len(raw_list)
                else:
                    raw_list = []
                    total = 0

                for it in raw_list:
                    if it.get("is_inactive") is True:
                        continue
                        
                    sku = it.get("sku_code") or it.get("inventory_item_code") or it.get("sku") or it.get("code") or ""
                    name = it.get("name") or it.get("inventory_item_name") or ""
                    iid = it.get("id") or it.get("inventory_item_id") or ""
                    itype = it.get("type", 1)

                    # Bổ sung thông tin từ điển MISA_INVENTORY nếu có
                    ref_info = MISA_INVENTORY.get(sku, {})
                    uid = ref_info.get("unit_id") or it.get("unit_id")
                    uname = ref_info.get("unit_name") or it.get("unit_name")
                    if itype == 3:
                        # Với mặt hàng Combo / Bộ hàng hóa (type 3), trên MISA không dùng đơn vị tính
                        uid = None
                        uname = None
                    elif not uname:
                        name_lower = name.lower()
                        if "hộp" in name_lower:
                            uid = "097330eb-f92d-4b88-95a8-1a83fd3d8064"
                            uname = "Hộp"
                        elif "thẻ" in name_lower or "card" in name_lower:
                            uid = "097330eb-f92d-4b88-95a8-1a83fd3d8061"
                            uname = "Cái"
                        else:
                            uid = "097330eb-f92d-4b88-95a8-1a83fd3d8061"
                            uname = "Cái"

                    stock = it.get("on_hand", it.get("inventory_qty", ref_info.get("stock", 100)))
                    all_items.append({
                        "id": iid,
                        "sku": sku,
                        "name": name,
                        "type": itype,
                        "unit_id": uid,
                        "unit_name": uname,
                        "stock": stock
                    })

                if not raw_list or len(raw_list) < page_size or len(all_items) >= total or len(all_items) >= max_items:
                    break
                page += 1

        print(f"[MISA INVENTORY] Đã nạp thành công {len(all_items)} mặt hàng từ kho MISA eShop (qua {page} trang).")
        return all_items
    except Exception as e:
        print(f"[MISA INVENTORY FETCH ERROR] {e}")
        return []

def lookup_misa_item(sku_or_code, is_pair_hint=False):
    if not sku_or_code:
        return None
    code_clean = str(sku_or_code).strip()
    
    # 1. Tra trong từ điển có sẵn
    if code_clean in MISA_INVENTORY:
        return MISA_INVENTORY[code_clean]
    
    # 2. Xử lý hậu tố mã (ví dụ MS05*2 -> tìm MS05)
    base_code = code_clean.replace("*2", "").strip()
    if base_code in MISA_INVENTORY:
        item = dict(MISA_INVENTORY[base_code])
        if "*2" in code_clean or is_pair_hint:
            item["is_pair"] = True
        return item
        
    # 3. Tra cứu trực tiếp từ API MISA eShop theo filter mã
    print(f"[MISA LOOKUP] Đang tra cứu mã hàng mới từ MISA eShop API: {base_code}...")
    found_items = fetch_misa_inventory_items(search=base_code)
    matched = None
    for it in found_items:
        it_sku = it.get("sku", "").strip()
        if it_sku.lower() == base_code.lower() or it_sku.lower() == code_clean.lower():
            matched = it
            break
    if not matched and found_items:
        matched = found_items[0]
        
    if matched:
        is_pair = ("*2" in code_clean) or is_pair_hint or ("đôi" in matched.get("name", "").lower()) or ("bộ" in matched.get("name", "").lower())
        itype = matched.get("type", 1)
        built_item = {
            "id": matched["id"],
            "sku": matched["sku"],
            "name": matched["name"],
            "type": itype,
            "unit_id": None if itype == 3 else (matched.get("unit_id") or "097330eb-f92d-4b88-95a8-1a83fd3d8061"),
            "unit_name": None if itype == 3 else (matched.get("unit_name") or "Cái"),
            "is_pair": is_pair
        }
        MISA_INVENTORY[code_clean] = built_item
        print(f"[MISA LOOKUP] ✅ Đã tìm thấy và map mã MISA mới: {code_clean} -> {built_item['name']}")
        return built_item
        
    print(f"[MISA LOOKUP] ⚠️ Không tìm thấy mã {code_clean} trên MISA, sử dụng mặc định.")
    return None

# --- QUẢN LÝ KHÁCH HÀNG MISA (TỰ ĐỘNG LƯU / TÌM KHÁCH HÀNG) ---
def ensure_misa_customer(name, phone, address, province, district, ward):
    token = get_misa_token()
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}

    # 1. Thử tạo mới khách hàng với đầy đủ địa chỉ
    cust_payload = {
        "branch_id": MISA_BRANCH_ID,
        "name": name,
        "tel": phone,
        "address": address,
        "province_name": province,
        "district_name": district,
        "ward_name": ward,
        "account_object_type": 1
    }
    try:
        req = urllib.request.Request(
            "https://eshopapp.misa.vn/api/platform/customers/create",
            data=json.dumps(cust_payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            if res.get("Status", {}).get("Success"):
                cust_id = res.get("Data", {}).get("id")
                print(f"[CUSTOMER] Đã tạo mới khách hàng MISA: {name} ({phone}) -> {cust_id}")
                return cust_id
    except urllib.error.HTTPError:
        pass
    except Exception:
        pass

    # 2. Nếu khách đã tồn tại, tra cứu ID theo số điện thoại
    try:
        clean_phone = phone.replace(" ", "")
        req_list = urllib.request.Request(
            f"https://eshopapp.misa.vn/api/platform/customers/list?tel={clean_phone}",
            headers=headers
        )
        with urllib.request.urlopen(req_list, timeout=10) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            items = res.get("Data", {}).get("Data", [])
            for it in items:
                if str(it.get("phone", "")).replace(" ", "") == clean_phone:
                    cust_id = it.get("id")
                    print(f"[CUSTOMER] Đã tìm thấy khách hàng cũ MISA: {it.get('name')} ({clean_phone}) -> {cust_id}")
                    return cust_id
    except Exception:
        pass

    return MISA_DEFAULT_CUSTOMER

# --- DANH SÁCH 63 TỈNH THÀNH & BỘ PHÂN TÍCH ĐỊA CHỈ THÔNG MINH ---
VN_PROVINCES = [
    "Hà Nội", "TP. Hồ Chí Minh", "Hồ Chí Minh", "Hưng Yên", "Bắc Ninh", "Hải Phòng", "Đà Nẵng",
    "Bình Dương", "Đồng Nai", "Hải Dương", "Quảng Ninh", "Thái Bình", "Nam Định",
    "Hà Nam", "Ninh Bình", "Thanh Hóa", "Nghệ An", "Hà Tĩnh", "Quảng Bình",
    "Quảng Trị", "Thừa Thiên Huế", "Quảng Nam", "Quảng Ngãi", "Bình Định",
    "Phú Yên", "Khánh Hòa", "Ninh Thuận", "Bình Thuận", "Kon Tum", "Gia Lai",
    "Đắk Lắk", "Đắk Nông", "Lâm Đồng", "Bình Phước", "Tây Ninh", "Bà Rịa - Vũng Tàu",
    "Long An", "Tiền Giang", "Bến Tre", "Trà Vinh", "Vĩnh Long", "Đồng Tháp",
    "An Giang", "Kiên Giang", "Cần Thơ", "Hậu Giang", "Sóc Trăng", "Bạc Liêu",
    "Cà Mau", "Vĩnh Phúc", "Phú Thọ", "Bắc Giang", "Thái Nguyên", "Tuyên Quang",
    "Lạng Sơn", "Cao Bằng", "Bắc Kạn", "Hà Giang", "Lào Cai", "Yên Bái",
    "Sơn La", "Hòa Bình", "Điện Biên", "Lai Châu"
]

def smart_parse_vietnam_address(raw_full, raw_street, raw_province, raw_district, raw_ward):
    """
    Tự động phân tích và chuẩn hóa địa chỉ 3 cấp (Tỉnh, Quận/Huyện, Phường/Xã)
    kể cả khi người dùng gõ thiếu dấu phẩy hoặc bị nhảy ngầm về Hà Nội.
    """
    import re
    text = f"{raw_street or ''} {raw_full or ''}".strip()
    
    found_prov = (raw_province or "").strip()
    found_dist = (raw_district or "").strip()
    found_ward = (raw_ward or "").strip()
    street = (raw_street or raw_full or "").strip()

    # 1. Quét tìm Tỉnh / Thành phố thực sự trong chuỗi địa chỉ
    text_lower = text.lower()
    detected_prov = None
    for prov in VN_PROVINCES:
        clean_p = prov.lower().replace("tp. ", "").replace("tỉnh ", "").strip()
        if clean_p in text_lower:
            detected_prov = "TP. Hồ Chí Minh" if ("hồ chí minh" in clean_p or "sài gòn" in text_lower) else prov
            break

    # Nếu phát hiện tỉnh trong địa chỉ khách gõ, ưu tiên tỉnh đó (tránh lỗi bị gán nhầm Hà Nội)
    if detected_prov:
        found_prov = detected_prov
    elif not found_prov:
        found_prov = "Hà Nội"

    # 2. Quét tìm Quận / Huyện (kể cả thiếu dấu phẩy)
    if not found_dist:
        dist_m = re.search(r'(quận|huyện|thị xã|thành phố|tx|tp|h\.|q\.)\s+([a-zà-ỹ0-9\s]+?)(?=,|\s+(xã|phường|thị trấn|tỉnh|tp)|$)', text, re.IGNORECASE)
        if dist_m:
            d_candidate = f"{dist_m.group(1).title()} {dist_m.group(2).strip().title()}"
            # Cắt bỏ tên tỉnh nếu bị dính vào đuôi huyện
            for p in VN_PROVINCES:
                d_candidate = re.sub(r'\s+' + re.escape(p) + r'$', '', d_candidate, flags=re.IGNORECASE).strip()
            found_dist = d_candidate

    # 3. Quét tìm Phường / Xã (kể cả thiếu dấu phẩy)
    if not found_ward:
        ward_m = re.search(r'(phường|xã|thị trấn|p\.|x\.)\s+([a-zà-ỹ0-9\s]+?)(?=,|\s+(quận|huyện|thị xã|thành phố|tỉnh)|$)', text, re.IGNORECASE)
        if ward_m:
            w_candidate = f"{ward_m.group(1).title()} {ward_m.group(2).strip().title()}"
            for p in VN_PROVINCES:
                w_candidate = re.sub(r'\s+' + re.escape(p) + r'$', '', w_candidate, flags=re.IGNORECASE).strip()
            found_ward = w_candidate

    # 4. Làm sạch street_addr
    clean_street = street
    for term in [found_prov, found_dist, found_ward, "Tỉnh", "Thành phố", "TP.", "TP"]:
        if term and len(term) > 1:
            clean_street = re.sub(re.escape(term), '', clean_street, flags=re.IGNORECASE).strip(' ,-')

    if not clean_street or len(clean_street) < 3:
        clean_street = street

    return clean_street, found_prov, found_dist, found_ward

# --- HÀM TẠO ĐƠN TRÊN MISA ESHOP ---
def push_order_to_misa(order):
    token = get_misa_token()
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }

    # 1. Tìm mặt hàng chính (Ưu tiên mã chọn từ Admin / Note, sau đó đến mapping theo Size & Phân loại)
    misa_sku = str(order.get("misaSku") or "").strip()
    note_str = str(order.get("note") or "")
    if not misa_sku:
        import re
        m_sku = re.search(r'\[MISA:\s*([^\]|]+)', note_str)
        if m_sku:
            misa_sku = m_sku.group(1).strip()

    matched_item = None
    is_pair_req = "đôi" in str(order.get("variant", "1 Đôi")).lower()
    if misa_sku:
        matched_item = lookup_misa_item(misa_sku, is_pair_hint=is_pair_req)
    if not matched_item:
        size_str = str(order.get("size", "5mm")).strip()
        variant = str(order.get("variant", "1 Đôi")).strip()
        size_key = "5mm"
        for k in SIZE_TO_SKU.keys():
            if k in size_str:
                size_key = k
                break
        sku_map = SIZE_TO_SKU.get(size_key, SIZE_TO_SKU["5mm"])
        chosen_sku = sku_map.get("1 Đôi" if is_pair_req else "1 Chiếc", "BNM6B01")
        matched_item = lookup_misa_item(chosen_sku, is_pair_hint=is_pair_req) or DEFAULT_ITEM

    # 2. Tính toán đơn giá & số lượng
    raw_price = str(order.get("price", "459000"))
    clean_price = int(''.join(filter(str.isdigit, raw_price)) or 459000)
    variant = str(order.get("variant", "1 Đôi"))
    qty = int(order.get("quantity", 1) or 1)

    # Nếu mặt hàng là mã Đôi (is_pair=True) thì SL gửi MISA là qty
    # Nếu mặt hàng là mã Chiếc lẻ nhưng khách đặt 1 Đôi thì SL = qty * 2
    if matched_item.get("is_pair"):
        total_qty = qty
    elif "đôi" in variant.lower():
        total_qty = qty * 2
    else:
        total_qty = qty
    unit_price = round(clean_price / total_qty) if total_qty > 0 else clean_price

    recipient_name = order.get("name") or "Khách hàng Online"
    recipient_tel = str(order.get("phone") or "0987654321").replace(" ", "").replace("+84", "0")
    if recipient_tel and not recipient_tel.startswith("0"):
        recipient_tel = "0" + recipient_tel
        
    full_addr = order.get("fullAddress") or order.get("address") or ""
    street_raw = order.get("address") or full_addr
    
    # Chuẩn hóa địa chỉ 3 cấp thông minh
    street_addr, province_name, district_name, ward_name = smart_parse_vietnam_address(
        full_addr,
        street_raw,
        order.get("province") or "",
        order.get("district") or "",
        order.get("ward") or ""
    )

    # Tự động tạo / tìm hồ sơ khách hàng trên MISA
    customer_id = ensure_misa_customer(
        recipient_name,
        recipient_tel,
        street_addr,
        province_name,
        district_name,
        ward_name
    )

    # Xây dựng danh sách hàng hóa đẩy sang MISA
    main_detail = {
        "inventory_item_id": matched_item["id"],
        "sku_code": matched_item["sku"],
        "inventory_item_name": matched_item["name"],
        "quantity": total_qty,
        "unit_price": unit_price,
        "discount_amount": 0
    }
    if matched_item.get("unit_id") and matched_item.get("unit_name") and matched_item.get("type") != 3:
        main_detail["unit_id"] = matched_item["unit_id"]
        main_detail["unit_name"] = matched_item["unit_name"]

    details = [main_detail]

    # Phụ kiện 1: Hộp đựng trang sức (mặc định Có tặng kèm trừ khi chỉ định không)
    include_box = order.get("includeBox")
    if include_box is None:
        include_box = not ("[Hộp: Không]" in note_str or "[Hộp: 0]" in note_str)
    elif isinstance(include_box, str):
        include_box = include_box.lower() not in ["false", "0", "khong", "không"]

    if include_box:
        box_item = MISA_INVENTORY["HOP NHAN"]
        details.append({
            "inventory_item_id": box_item["id"],
            "sku_code": box_item["sku"],
            "inventory_item_name": box_item["name"],
            "unit_id": box_item["unit_id"],
            "unit_name": box_item["unit_name"],
            "quantity": 1,
            "unit_price": 0,
            "discount_amount": 0
        })

    # Phụ kiện 2: Thẻ kiểm định GRA / In Card (mặc định Có tặng kèm trừ khi chỉ định không)
    include_card = order.get("includeCard")
    if include_card is None:
        include_card = not ("[Thẻ: Không]" in note_str or "[Thẻ: 0]" in note_str)
    elif isinstance(include_card, str):
        include_card = include_card.lower() not in ["false", "0", "khong", "không"]

    if include_card:
        card_item = MISA_INVENTORY["CARD"]
        details.append({
            "inventory_item_id": card_item["id"],
            "sku_code": card_item["sku"],
            "inventory_item_name": card_item["name"],
            "unit_id": card_item["unit_id"],
            "unit_name": card_item["unit_name"],
            "quantity": 1,
            "unit_price": 0,
            "discount_amount": 0
        })

    order_payload = {
        "branch_id": MISA_BRANCH_ID,
        "customer_id": customer_id,
        "customer_name": recipient_name,
        "stock_id": MISA_STOCK_ID,
        "stock_code": "KHH",
        "stock_name": "Kho hàng hóa",
        "recipient_name": recipient_name,
        "recipient_tel": recipient_tel,
        "recipient_address": street_addr,
        "province_name": province_name,
        "district_name": district_name,
        "ward_name": ward_name,
        "shipping_service_name": "Tự giao",
        "partner_service_type_name": "Tự giao",
        "shipping_payment_type": 1,
        "discount_amount": 0,
        "delivery_amount": 0,
        "shipping_partner_amount": 0,
        "weight": 100,
        "employee_note": f"Đơn PGD {order.get('orderId', '')} [MISA:{matched_item['sku']}] - {order.get('note', '')}",
        "is_invoice": True,
        "invoice": {
            "inv_buyer_object_type": 2, # Cá nhân
            "inv_buyer_name": recipient_name,
            "inv_buyer_address": full_addr,
            "inv_buyer_legal_tel": recipient_tel,
            "inv_email": order.get("email") or ""
        },
        "details": details
    }

    req = urllib.request.Request(
        "https://eshopapp.misa.vn/api/platform/openpartnervouchers/orders/create",
        data=json.dumps(order_payload).encode('utf-8'),
        headers=headers,
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=15) as resp:
        res_data = json.loads(resp.read().decode('utf-8'))
        if res_data.get("Status", {}).get("Success"):
            ref_no = res_data["Data"]["ref_no"]
            print(f"[MISA SUCCESS] Đơn {order.get('orderId')} tạo thành công! Mã eShop: {ref_no}")
            return {"ok": True, "ref_no": ref_no}
        else:
            msg = res_data.get("Status", {}).get("Message") or "Lỗi không xác định từ MISA"
            print(f"[MISA ERROR] Đơn {order.get('orderId')} thất bại: {msg}")
            return {"ok": False, "error": msg}

# --- GỌI GOOGLE APPS SCRIPT ---
def call_apps_script(payload):
    req = urllib.request.Request(
        APPS_SCRIPT_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))

# ==============================================================================
# SPX EXPRESS LOGISTICS & TRACKING MODULE (Shopee Express)
# Quản lý vận chuyển, tra cứu mã vận đơn SPX VN, tự động cảnh báo Đơn Hoàn & cập nhật Doanh Thu Thực Thu
# ==============================================================================

alerted_spx_cache = set()

def build_spx_tracking_url(tracking_number):
    clean_tn = str(tracking_number or "").strip()
    if not clean_tn:
        return "https://spx.vn/"
    return f"https://spx.vn/track?{clean_tn}"

def check_spx_order_tracking(tracking_number):
    """
    Tra cứu trạng thái vận đơn SPX Express Việt Nam.
    Sử dụng endpoint public fleet_order của SPX (200 OK từ SGW SPX-TrackService).
    Phân loại chính xác:
    - SUCCESS: Giao hàng thành công (Delivered)
    - FAILED: Giao thất bại / Bị chuyển hoàn / Trả hàng (Returned / Delivery Failed)
    - SHIPPING: Đang giao hàng / Đang luân chuyển (In transit)
    - PENDING: Đang xử lý / Chưa có lịch sử
    """
    clean_tn = str(tracking_number or "").strip().upper()
    if not clean_tn:
        return {"ok": False, "error": "Thiếu mã vận đơn SPX"}

    track_url = build_spx_tracking_url(clean_tn)

    try:
        api_url = f"https://spx.vn/api/v2/fleet_order/tracking/search?sls_tracking_number={clean_tn}"
        headers = {
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Referer": track_url
        }
        req = urllib.request.Request(api_url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("retcode") == 0 and data.get("data"):
                tr_data = data.get("data", {})
                tracking_list = tr_data.get("tracking_list", [])
                if tracking_list:
                    # Sắp xếp lấy sự kiện mới nhất theo timestamp
                    sorted_events = sorted(tracking_list, key=lambda x: x.get("timestamp", 0), reverse=True)
                    latest = sorted_events[0]
                    raw_status = str(latest.get("status") or "").strip()
                    raw_msg = str(latest.get("message") or "").strip()
                    combined_lower = f"{raw_status} {raw_msg}".lower()

                    success_keywords = ["giao hàng thành công", "đã giao", "giao thành công", "delivered", "delivery_successful", "completed"]
                    fail_keywords = ["không thành công", "thất bại", "chuyển hoàn", "trả hàng", "hoàn hàng", "hoàn về", "delivery_failed", "returned", "returning", "failed", "hủy giao"]

                    if any(kw in combined_lower for kw in success_keywords):
                        status_type = "SUCCESS"
                        mapped_status = "Giao thành công"
                    elif any(kw in combined_lower for kw in fail_keywords):
                        status_type = "FAILED"
                        mapped_status = "Giao thất bại"
                    else:
                        status_type = "SHIPPING"
                        mapped_status = "Đang giao hàng"

                    return {
                        "ok": True,
                        "tracking_number": clean_tn,
                        "status_type": status_type,
                        "status": mapped_status,
                        "detail": raw_msg or raw_status,
                        "tracking_url": track_url,
                        "carrier": "SPX Express",
                        "events": sorted_events
                    }
    except Exception as e:
        print(f"[SPX TRACK ERR] {clean_tn}: {e}")

    return {
        "ok": True,
        "tracking_number": clean_tn,
        "status_type": "PENDING",
        "status": "Đang giao hàng",
        "detail": "Đang cập nhật hành trình SPX",
        "tracking_url": track_url,
        "carrier": "SPX Express"
    }

def send_telegram_spx_alert(order, spx_code, status_type, latest_status, reason_msg):
    """Bắn thông báo cảnh báo đơn hoàn hoặc chúc mừng giao thành công lên nhóm Telegram CSKH"""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return False
    try:
        now_vn = time.strftime("%d/%m/%Y %H:%M:%S", time.localtime())
        order_id = order.get("orderId", "")
        name = order.get("name", "Khách hàng")
        phone = str(order.get("phone", "")).strip()
        clean_phone = re.sub(r"\D", "", phone)
        addr = order.get("fullAddress") or order.get("address") or "N/A"
        track_url = build_spx_tracking_url(spx_code)

        if status_type == "FAILED":
            text = (
                f"🚨 <b>[CẢNH BÁO ĐƠN HOÀN - SPX EXPRESS] - PHÚ GIA DIAMOND</b>\n\n"
                f"🧾 Mã đơn: <code>{order_id}</code>\n"
                f"🚚 Mã vận đơn SPX: <code>{spx_code}</code> (<a href='{track_url}'>Xem SPX</a>)\n"
                f"👤 Khách hàng: <b>{name}</b>\n"
                f"📞 Số điện thoại: <code>{phone}</code> <i>(Chạm số để sao chép)</i>\n"
                f"💬 Link Zalo: <a href='https://zalo.me/{clean_phone}'>https://zalo.me/{clean_phone}</a>\n"
                f"📍 Địa chỉ: {addr}\n"
                f"⚠️ Trạng thái SPX: <b>{latest_status}</b>\n"
                f"📝 Lý do từ bưu tá: <i>{reason_msg or 'Bưu tá báo giao thất bại / chuyển hoàn'}</i>\n"
                f"🕒 Thời gian ghi nhận: {now_vn}\n\n"
                f"👉 <b>CSKH hãy liên hệ ngay cho khách để xử lý / cứu đơn trước khi hàng bị hoàn về Shop!</b>"
            )
            keyboard = [
                [
                    {"text": "📞 Gọi khách ngay", "url": f"tel:{clean_phone}"},
                    {"text": "💬 Nhắn Zalo", "url": f"https://zalo.me/{clean_phone}"}
                ],
                [
                    {"text": "🚚 Xem hành trình SPX", "url": track_url}
                ]
            ]
        elif status_type == "SUCCESS":
            price_val = order.get("price", "")
            text = (
                f"🎉 <b>[SPX - GIAO THÀNH CÔNG] - PHÚ GIA DIAMOND</b>\n\n"
                f"🧾 Mã đơn: <code>{order_id}</code>\n"
                f"🚚 Mã vận đơn SPX: <code>{spx_code}</code>\n"
                f"👤 Khách hàng: <b>{name}</b> (<code>{phone}</code>)\n"
                f"💰 Doanh thu thực thu: <b>{price_val}</b>\n"
                f"✅ Tình trạng: Bưu tá SPX đã phát hàng thành công!\n"
                f"🕒 Thời gian: {now_vn}"
            )
            keyboard = [
                [
                    {"text": "🚚 Xem hành trình SPX", "url": track_url}
                ]
            ]
        else:
            return False

        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
            "reply_markup": {"inline_keyboard": keyboard}
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            return res.get("ok", False)
    except Exception as e:
        print(f"[SPX TELEGRAM ALERT ERR] {e}")
        return False

def scan_and_sync_all_spx_orders():
    """
    Quét tự động toàn bộ đơn hàng có mã SPX Express để phát hiện ngay:
    1. Đơn giao thành công -> Cập nhật Giao thành công (Thực thu)
    2. Đơn giao thất bại / Hoàn hàng -> Cập nhật Giao thất bại & Bắn CẢNH BÁO TELEGRAM để cứu đơn!
    """
    print("[SPX MONITOR] Bắt đầu chu kỳ quét tự động hành trình SPX Express...")
    scanned = 0
    updated_delivered = 0
    updated_failed = 0

    try:
        res = call_apps_script({
            "action": "orders",
            "username": "admin",
            "password": ADMIN_KEY,
            "limit": 250
        })
        if not res.get("ok"):
            print("[SPX MONITOR] Không tải được danh sách đơn hàng:", res.get("error"))
            return {"ok": False, "error": res.get("error")}

        orders = res.get("orders", [])
        for o in orders:
            order_id = o.get("orderId", "")
            current_status = str(o.get("status") or "").strip()
            note = str(o.get("note") or "")
            eshop = str(o.get("eshopCode") or "")

            # Bỏ qua những đơn đã kết thúc hoàn toàn
            if current_status in ["Giao thành công", "Đã hủy"]:
                continue

            # Trích xuất mã vận đơn SPX
            spx_code = ""
            m = re.search(r"\[SPX:\s*([^\]|]+)\]", note, re.I)
            if m:
                spx_code = m.group(1).strip().upper()
            if not spx_code:
                m = re.search(r"SPX[A-Z0-9]+", eshop, re.I)
                if m:
                    spx_code = m.group(0).strip().upper()
            if not spx_code:
                m = re.search(r"SPX[A-Z0-9]+", note, re.I)
                if m:
                    spx_code = m.group(0).strip().upper()

            if not spx_code:
                continue

            scanned += 1
            print(f"[SPX TRACKING] Kiểm tra đơn {order_id} (Mã SPX: {spx_code})...")
            track_res = check_spx_order_tracking(spx_code)
            status_type = track_res.get("status_type")
            latest_detail = track_res.get("detail", "")
            latest_status = track_res.get("status", "")

            # 1. Phát hiện ĐƠN HOÀN / GIAO THẤT BẠI
            if status_type == "FAILED":
                if current_status not in ["Giao thất bại", "Chuyển hoàn", "Đơn hoàn"]:
                    print(f"🚨 [SPX DETECTED RETURN] Đơn {order_id} ({spx_code}) bị giao thất bại/hoàn về!")
                    call_apps_script({
                        "action": "updateStatus",
                        "username": "admin",
                        "password": ADMIN_KEY,
                        "orderId": order_id,
                        "status": "Giao thất bại"
                    })
                    updated_failed += 1

                alert_key = f"{order_id}_{latest_detail}"
                if alert_key not in alerted_spx_cache:
                    alerted_spx_cache.add(alert_key)
                    send_telegram_spx_alert(o, spx_code, "FAILED", latest_status, latest_detail)
                    print(f"[SPX ALERT TELEGRAM] Đã gửi cảnh báo cứu đơn {order_id} lên Telegram!")

            # 2. Phát hiện GIAO THÀNH CÔNG (CỘNG DOANH THU THỰC THU)
            elif status_type == "SUCCESS":
                if current_status != "Giao thành công":
                    print(f"🎉 [SPX DETECTED SUCCESS] Đơn {order_id} ({spx_code}) giao thành công!")
                    call_apps_script({
                        "action": "updateStatus",
                        "username": "admin",
                        "password": ADMIN_KEY,
                        "orderId": order_id,
                        "status": "Giao thành công"
                    })
                    updated_delivered += 1
                    send_telegram_spx_alert(o, spx_code, "SUCCESS", latest_status, latest_detail)

            time.sleep(1.5)

        print(f"[SPX MONITOR DONE] Đã rà soát {scanned} đơn SPX: {updated_delivered} đơn Giao TC, {updated_failed} đơn Giao thất bại.")
        return {
            "ok": True,
            "scanned": scanned,
            "updated_delivered": updated_delivered,
            "updated_failed": updated_failed
        }
    except Exception as ex:
        print(f"[SPX MONITOR EXCEPTION] {ex}")
        return {"ok": False, "error": str(ex)}

def spx_auto_scan_loop():
    """Vòng lặp ngầm tự động quét hành trình SPX mỗi 15 phút"""
    print(f"[SPX DAEMON] Bộ giám sát hành trình SPX Express đã kích hoạt! Chu kỳ quét: mỗi {SPX_SCAN_INTERVAL_SECONDS // 60} phút.")
    time.sleep(30)
    while True:
        try:
            scan_and_sync_all_spx_orders()
        except Exception as e:
            print(f"[SPX DAEMON ERROR] {e}")
        time.sleep(SPX_SCAN_INTERVAL_SECONDS)

def sync_loop():
    print(f"[DAEMON] Order Sync Runner đã kích hoạt! Đang quét hàng đợi mỗi {POLL_INTERVAL_SECONDS}s...")
    while True:
        try:
            # 1. Lấy danh sách đơn hàng đang chờ đẩy
            res = call_apps_script({
                "action": "getPendingMisa",
                "key": ADMIN_KEY
            })

            pending_orders = res.get("pending", []) if res.get("ok") else []
            if pending_orders:
                print(f"[QUEUE] Phát hiện {len(pending_orders)} đơn hàng đang chờ đẩy sang MISA eShop...")
                for order in pending_orders:
                    order_id = order.get("orderId")
                    print(f"[PROCESSING] Đang xử lý đơn: {order_id} ({order.get('name')})...")
                    
                    # 2. Đẩy sang MISA eShop
                    push_res = push_order_to_misa(order)
                    
                    if push_res.get("ok"):
                        # 3. Báo hoàn tất cho Google Sheet & Telegram
                        call_apps_script({
                            "action": "finishPushMisa",
                            "key": ADMIN_KEY,
                            "orderId": order_id,
                            "eshopCode": push_res["ref_no"]
                        })
                        print(f"[DONE] Hoàn tất đồng bộ đơn {order_id} -> MISA {push_res['ref_no']}!")
                    else:
                        # 4. Ghi nhận lỗi
                        call_apps_script({
                            "action": "failPushMisa",
                            "key": ADMIN_KEY,
                            "orderId": order_id,
                            "error": push_res.get("error", "Lỗi tạo đơn")
                        })

        except Exception as e:
            # Ghi nhận lỗi kết nối mạng / timeout
            print(f"[SYNC LOOP NOTICE] {e}")

        time.sleep(POLL_INTERVAL_SECONDS)

# --- TELEGRAM BOT LONG-POLLING (XỬ LÝ NÚT BẤM TELEGRAM TỨC THÌ) ---
def answer_telegram_callback(callback_query_id, text, show_alert=False):
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/answerCallbackQuery"
        payload = {
            "callback_query_id": callback_query_id,
            "text": text,
            "show_alert": show_alert
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            pass
    except Exception as e:
        print(f"[TELEGRAM] Lỗi answerCallbackQuery: {e}")

def remove_telegram_webhook():
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/deleteWebhook"
        req = urllib.request.Request(url, method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            res = json.loads(r.read().decode())
            print(f"[TELEGRAM] Chuyển chế độ Direct Polling: {res.get('ok')}")
    except Exception as e:
        print(f"[TELEGRAM] Lỗi xóa webhook: {e}")

def telegram_bot_loop():
    remove_telegram_webhook()
    offset = 0
    print(f"[TELEGRAM] Bot Polling đã kích hoạt! Đang lắng nghe nút bấm Telegram tức thì...")
    while True:
        try:
            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates?offset={offset}&timeout=15"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("ok"):
                    for update in data.get("result", []):
                        offset = max(offset, update["update_id"] + 1)
                        cb = update.get("callback_query")
                        if not cb:
                            continue
                        
                        cb_id = cb.get("id")
                        action_data = str(cb.get("data", ""))
                        print(f"[TELEGRAM BTN] Đã bấm: {action_data}")

                        # 1. Bấm [🚀 Đẩy ngay sang eShop]
                        if action_data.startswith("push_"):
                            order_id = action_data.replace("push_", "")
                            # Phản hồi Telegram tức thì (<0.1s) chống timeout
                            answer_telegram_callback(cb_id, f"⏳ Đang đẩy đơn {order_id} sang MISA eShop...")
                            
                            def do_push(oid):
                                try:
                                    orders_res = call_apps_script({"action": "orders", "key": ADMIN_KEY})
                                    target_order = None
                                    for o in orders_res.get("orders", []):
                                        if o.get("orderId") == oid:
                                            target_order = o
                                            break
                                    if target_order:
                                        push_res = push_order_to_misa(target_order)
                                        if push_res.get("ok"):
                                            call_apps_script({
                                                "action": "finishPushMisa",
                                                "key": ADMIN_KEY,
                                                "orderId": oid,
                                                "eshopCode": push_res["ref_no"]
                                            })
                                            print(f"[TELEGRAM PUSH SUCCESS] Đơn {oid} -> {push_res['ref_no']}")
                                        else:
                                            call_apps_script({
                                                "action": "failPushMisa",
                                                "key": ADMIN_KEY,
                                                "orderId": oid,
                                                "error": push_res.get("error", "Lỗi tạo đơn")
                                            })
                                    else:
                                        print(f"[TELEGRAM PUSH ERROR] Không tìm thấy đơn {oid}")
                                except Exception as ex:
                                    print(f"[PUSH THREAD ERROR] {ex}")

                            threading.Thread(target=do_push, args=(order_id,), daemon=True).start()

                        # 2. Bấm [❌ Hủy đơn]
                        elif action_data.startswith("cancel_"):
                            order_id = action_data.replace("cancel_", "")
                            answer_telegram_callback(cb_id, f"❌ Đang hủy đơn hàng {order_id}...")
                            
                            def do_cancel(oid):
                                try:
                                    call_apps_script({"action": "cancelOrder", "key": ADMIN_KEY, "orderId": oid})
                                    print(f"[TELEGRAM CANCEL] Đã hủy đơn {oid}")
                                except Exception as ex:
                                    print(f"[CANCEL THREAD ERROR] {ex}")

                            threading.Thread(target=do_cancel, args=(order_id,), daemon=True).start()

                        # 3. Bấm [📞 Gọi khách]
                        elif action_data.startswith("call_"):
                            order_id = action_data.replace("call_", "")
                            # Phản hồi Alert Dialog tức thì (<0.05s) cho người dùng
                            answer_telegram_callback(
                                cb_id,
                                f"📞 Ghi nhận cuộc gọi đơn {order_id}!\n✅ Trạng thái trên Google Sheet: Đang gọi điện\n👉 Chạm vào số điện thoại trong tin nhắn để bấm gọi.",
                                show_alert=True
                            )
                            
                            def do_call(oid):
                                try:
                                    call_apps_script({"action": "updateStatus", "key": ADMIN_KEY, "orderId": oid, "status": "Đang gọi điện"})
                                    print(f"[TELEGRAM CALL] Đã cập nhật trạng thái: Đang gọi điện cho {oid}")
                                except Exception as ex:
                                    print(f"[CALL THREAD ERROR] {ex}")

                            threading.Thread(target=do_call, args=(order_id,), daemon=True).start()

                        # 4. Bấm [💬 Nhắn Zalo]
                        elif action_data.startswith("zalo_"):
                            order_id = action_data.replace("zalo_", "")
                            # Phản hồi Alert Dialog tức thì (<0.05s) cho người dùng
                            answer_telegram_callback(
                                cb_id,
                                f"💬 Ghi nhận nhắn Zalo đơn {order_id}!\n✅ Trạng thái trên Google Sheet: Đã nhắn Zalo",
                                show_alert=True
                            )
                            
                            def do_zalo(oid):
                                try:
                                    call_apps_script({"action": "updateStatus", "key": ADMIN_KEY, "orderId": oid, "status": "Đã nhắn Zalo"})
                                    print(f"[TELEGRAM ZALO] Đã cập nhật trạng thái: Đã nhắn Zalo cho {oid}")
                                except Exception as ex:
                                    print(f"[ZALO THREAD ERROR] {ex}")

                            threading.Thread(target=do_zalo, args=(order_id,), daemon=True).start()
        except Exception as ex:
            time.sleep(2)

# --- LOCAL HTTP SERVER CHO ADMIN WEB ---
class LocalServerHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "healthy", "service": "MISA Sync Runner"}).encode())
            return
        if parsed.path in ["/items", "/misa/items", "/inventory"]:
            qs = parse_qs(parsed.query)
            search = (qs.get("search") or [""])[0]
            items = fetch_misa_inventory_items(search=search)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "items": items, "total": len(items)}, ensure_ascii=False).encode('utf-8'))
            return
        if parsed.path in ["/spx/track", "/spx/tracking"]:
            qs = parse_qs(parsed.query)
            tn = (qs.get("tracking_no") or qs.get("tn") or [""])[0]
            res = check_spx_order_tracking(tn)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))
            return
        if parsed.path in ["/spx/scan", "/spx/sync_all"]:
            res = scan_and_sync_all_spx_orders()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))
            return
        if parsed.path in ["/code", "/Code.gs"]:
            code_path = os.path.join(os.path.dirname(__file__), "Code.gs")
            with open(code_path, "r", encoding="utf-8") as f:
                code_content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(code_content.encode('utf-8'))
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path in ["/spx/update"]:
            content_len = int(self.headers.get('Content-Length', 0))
            body = {}
            if content_len > 0:
                try:
                    body = json.loads(self.rfile.read(content_len).decode('utf-8'))
                except Exception:
                    pass
            order_id = body.get("orderId", "")
            spx_code = body.get("spxCode", "")
            status = body.get("status", "")
            if not order_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Thiếu orderId"}).encode())
                return
            update_payload = {"action": "updateStatus", "key": ADMIN_KEY, "orderId": order_id}
            if status:
                update_payload["status"] = status
            if spx_code:
                update_payload["spxCode"] = spx_code
            res = call_apps_script(update_payload)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))
            return
        if parsed.path in ["/spx/scan", "/spx/sync_all"]:
            res = scan_and_sync_all_spx_orders()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))
            return
        if parsed.path == "/push":
            qs = parse_qs(parsed.query)
            order_id = (qs.get("orderId") or [""])[0]
            misa_sku = (qs.get("misaSku") or [""])[0]
            include_box = (qs.get("includeBox") or [None])[0]
            include_card = (qs.get("includeCard") or [None])[0]

            content_len = int(self.headers.get('Content-Length', 0))
            if content_len > 0:
                try:
                    body = json.loads(self.rfile.read(content_len).decode('utf-8'))
                    if not order_id:
                        order_id = body.get("orderId", "")
                    if body.get("misaSku"):
                        misa_sku = body["misaSku"]
                    if "includeBox" in body:
                        include_box = body["includeBox"]
                    if "includeCard" in body:
                        include_card = body["includeCard"]
                except Exception:
                    pass

            if not order_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Thiếu orderId"}).encode())
                return

            print(f"[HTTP PUSH] Nhận yêu cầu đẩy đơn từ Web Admin: {order_id} (SKU: {misa_sku or 'Tự động'})")
            try:
                orders_res = call_apps_script({"action": "orders", "key": ADMIN_KEY})
                target_order = None
                for o in orders_res.get("orders", []):
                    if o.get("orderId") == order_id:
                        target_order = o
                        break

                if not target_order:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"ok": False, "error": f"Không tìm thấy đơn {order_id}"}).encode())
                    return

                if misa_sku:
                    target_order["misaSku"] = misa_sku
                if include_box is not None:
                    target_order["includeBox"] = include_box
                if include_card is not None:
                    target_order["includeCard"] = include_card

                push_res = push_order_to_misa(target_order)
                if push_res.get("ok"):
                    call_apps_script({
                        "action": "finishPushMisa",
                        "key": ADMIN_KEY,
                        "orderId": order_id,
                        "eshopCode": push_res["ref_no"]
                    })
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"ok": True, "eshopCode": push_res["ref_no"]}).encode())
                else:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"ok": False, "error": push_res.get("error")}).encode())
            except Exception as ex:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(ex)}).encode())
            return

        self.send_response(404)
        self.end_headers()

def run_local_server():
    server = HTTPServer(('127.0.0.1', LOCAL_PORT), LocalServerHandler)
    print(f"[HTTP SERVER] Lắng nghe yêu cầu đẩy đơn trực tiếp tại http://127.0.0.1:{LOCAL_PORT}...")
    server.serve_forever()

if __name__ == "__main__":
    # 1. Khởi chạy Local Server trong luồng riêng
    t_server = threading.Thread(target=run_local_server, daemon=True)
    t_server.start()

    # 2. Khởi chạy Telegram Bot Long-Polling trong luồng riêng
    t_tele = threading.Thread(target=telegram_bot_loop, daemon=True)
    t_tele.start()

    # 3. Khởi chạy luồng giám sát tự động hành trình SPX Express (15 phút/lần)
    t_spx = threading.Thread(target=spx_auto_scan_loop, daemon=True)
    t_spx.start()

    # 4. Chạy vòng lặp đồng bộ hàng đợi chính từ Google Sheet
    sync_loop()
