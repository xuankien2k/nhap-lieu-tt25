"""Đồng bộ kết quả cận lâm sàng từ cột ketluan, khớp theo mã KCB."""

from server.excel_io import load_workbook_bytes
from server.kcb_sync import code_text, fold_name

# Các cột cận lâm sàng được ghi. Không đụng chẩn đoán hình ảnh.
LAB_COLUMNS = [
    "BQ", "BR", "BS", "BT", "BU", "BV", "BW", "BX", "BY", "BZ",
    "CA", "CB", "CC", "CD", "CE", "CF", "CJ", "CK", "CL",
    "CM", "CN", "CO", "CP", "CQ", "CV",
]


def map_label(label):
    key = fold_name(label)
    if "hba1c" in key:
        return "CF"
    if "hdl-c" in key or "hdl c" in key:
        return "CD"
    if "ldl-c" in key or "ldl c" in key:
        return "CE"
    if "triglycerid" in key:
        return "CB"
    if "cholesterol toan phan" in key:
        return "CC"
    if "ast" in key and "got" in key:
        return "BY"
    if "alt" in key and "gpt" in key:
        return "BZ"
    if "ggt" in key or "glutamyl" in key:
        return "CA"
    if "ure" in key and "mau" in key:
        return "BV"
    if "creatinin" in key and "acr" not in key and "albumin" not in key:
        return "BW"
    if "acid uric" in key or "axit uric" in key:
        return "CM"
    if "glucose" in key and "mau" in key:
        return "BU"
    if key == "glucose":
        return "CN"
    if key == "protein":
        return "CO"
    if key == "hong cau":
        return "CP"
    if key == "bach cau":
        return "CQ"
    if key.startswith("rbc"):
        return "BQ"
    if key.startswith("wbc"):
        return "BR"
    if key.startswith("plt"):
        return "BS"
    if key.startswith("hgb"):
        return "BT"
    if key == "hbsag":
        return "CJ"
    if key == "hbsab":
        return "CK"
    if "anti hcv" in key:
        return "CL"
    return None


def parse_segments(text):
    items = []
    for part in str(text or "").split(";"):
        part = part.strip()
        if not part or ":" not in part:
            continue
        label, value = part.split(":", 1)
        label = " ".join(label.split())
        value = value.strip()
        if label and value:
            items.append((label, value))
    return items


def merge_results(texts):
    merged = {}
    order = []
    for text in texts:
        for label, value in parse_segments(text):
            current = merged.get(label)
            if current is None:
                merged[label] = value
                order.append(label)
            elif value != current and len(value) > len(current):
                merged[label] = value
    return [(label, merged[label]) for label in order]


def fields_from_results(pairs):
    fields = {col: "" for col in LAB_COLUMNS}
    extra = []
    for label, value in pairs:
        column = map_label(label)
        if column:
            fields[column] = value
        else:
            extra.append(f"{label}: {value}")
    fields["CV"] = "; ".join(extra)
    return fields


def parse_lab_workbook(raw):
    wb = load_workbook_bytes(raw, data_only=True)
    ws = wb.active
    header = {fold_name(ws.cell(1, col).value): col for col in range(1, ws.max_column + 1)}
    code_col = header.get("makcb")
    result_col = header.get("ketluan")
    if not code_col or not result_col:
        raise ValueError("File cần có cột makcb và ketluan.")
    grouped = {}
    order = []
    for row in range(2, ws.max_row + 1):
        code = code_text(ws.cell(row, code_col).value)
        text = ws.cell(row, result_col).value
        if not code:
            continue
        if code not in grouped:
            grouped[code] = []
            order.append(code)
        if text:
            grouped[code].append(str(text))
    results = {}
    for code in order:
        results[code] = fields_from_results(merge_results(grouped[code]))
    if not results:
        raise ValueError("Không thấy dòng kết quả nào có mã KCB.")
    return results


def plan_lab_sync(patients, results):
    with_code = [patient for patient in patients if (patient["data"].get("MA_KCB") or "").strip()]
    if not with_code:
        raise ValueError("Chưa đồng bộ mã KCB. Hãy đồng bộ mã KCB trước khi đồng bộ cận lâm sàng.")
    by_code = {}
    for patient in with_code:
        by_code.setdefault(patient["data"]["MA_KCB"].strip(), []).append(patient)
    updates = {}
    matched_codes = set()
    missing = []
    for patient in with_code:
        code = patient["data"]["MA_KCB"].strip()
        fields = results.get(code)
        if not fields:
            missing.append({"name": patient["data"].get("B") or "Chưa có tên", "ma_kcb": code})
            continue
        updates[patient["id"]] = fields
        matched_codes.add(code)
    return {
        "updates": updates,
        "missing_in_file": missing,
        "skipped_not_in_batch": len(set(results) - set(by_code)),
        "without_code": [
            {"name": patient["data"].get("B") or "Chưa có tên"}
            for patient in patients
            if not (patient["data"].get("MA_KCB") or "").strip()
        ],
    }
