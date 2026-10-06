import socket
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import db, excel_io
from server.kcb_sync import parse_kcb_list, plan_sync
from server.clinical_sync import CLINICAL_COLUMNS, parse_clinical_workbook, plan_clinical_sync
from server.lab_sync import LAB_COLUMNS, parse_lab_workbook, plan_lab_sync
from server.schema import COLUMNS, public_schema

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"

app = FastAPI(title="Nhập liệu khám sức khỏe")


class BatchIn(BaseModel):
    name: str
    note: str = ""


class BatchPatch(BaseModel):
    name: str | None = None
    note: str | None = None


class PatientPatch(BaseModel):
    fields: dict[str, str]
    base: dict[str, str] = {}
    editor: str = ""


class PatientCreate(BaseModel):
    editor: str = ""


def local_ips():
    ips = set()
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None):
            ip = info[4][0]
            if ":" not in ip and not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ips.add(sock.getsockname()[0])
        sock.close()
    except Exception:
        pass
    return sorted(ips)


@app.on_event("startup")
def startup():
    db.init_db()
    excel_io.ensure_template()
    ips = local_ips()
    print("Sổ khám sức khỏe đang chạy.")
    print("  Máy này: http://127.0.0.1:8787")
    for ip in ips:
        print(f"  Máy khác trong LAN: http://{ip}:8787")


@app.middleware("http")
async def no_cache_assets(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/info")
def info():
    ips = local_ips()
    return {
        "port": 8787,
        "ips": ips,
        "urls": [f"http://{ip}:8787" for ip in ips],
    }


@app.get("/api/schema")
def schema():
    return public_schema()


@app.get("/api/batches")
def batches():
    return db.list_batches()


@app.post("/api/batches")
def create_batch(body: BatchIn):
    return db.create_batch(body.name, body.note)


@app.patch("/api/batches/{batch_id}")
def patch_batch(batch_id: str, body: BatchPatch):
    batch = db.update_batch(batch_id, body.name, body.note)
    if not batch:
        raise HTTPException(404, "Không tìm thấy đoàn khám")
    return batch


@app.delete("/api/batches/{batch_id}")
def remove_batch(batch_id: str):
    if not db.delete_batch(batch_id):
        raise HTTPException(404, "Không tìm thấy đoàn khám")
    return {"ok": True}


@app.post("/api/batches/import")
async def import_batch(file: UploadFile = File(...), name: str = Form(""), note: str = Form(""), editor: str = Form("")):
    filename = Path(file.filename or "doan.xlsx").name
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Chỉ nhận file Excel .xlsx")
    raw = await file.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(400, "File lớn hơn 20 MB")
    try:
        records = excel_io.parse_workbook(raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, "Không đọc được file Excel. Hãy dùng đúng mẫu sổ khám.") from exc
    title = name.strip() or Path(filename).stem
    batch = db.create_batch(title, note, filename, raw)
    db.insert_patients(batch["id"], records, editor)
    return db.get_batch(batch["id"])


@app.get("/api/batches/{batch_id}/patients")
def patients(batch_id: str):
    if not db.get_batch(batch_id):
        raise HTTPException(404, "Không tìm thấy đoàn khám")
    return db.list_patients(batch_id)


@app.post("/api/batches/{batch_id}/patients")
def add_patient(batch_id: str, body: PatientCreate):
    if not db.get_batch(batch_id):
        raise HTTPException(404, "Không tìm thấy đoàn khám")
    patient = db.create_patient(batch_id, excel_io.blank_record(), body.editor)
    return patient


@app.patch("/api/patients/{patient_id}")
def save_patient(patient_id: str, body: PatientPatch):
    fields = {key: "" if value is None else str(value) for key, value in body.fields.items() if key in COLUMNS}
    result = db.patch_patient(patient_id, fields, body.base, body.editor)
    if not result:
        raise HTTPException(404, "Không tìm thấy bệnh nhân")
    return result


@app.delete("/api/patients/{patient_id}")
def remove_patient(patient_id: str):
    if not db.delete_patient(patient_id):
        raise HTTPException(404, "Không tìm thấy bệnh nhân")
    return {"ok": True}


@app.post("/api/batches/{batch_id}/sync-kcb")
async def sync_kcb(batch_id: str, file: UploadFile = File(...), editor: str = Form("")):
    if not db.get_batch(batch_id):
        raise HTTPException(404, "Không tìm thấy đoàn khám")
    filename = Path(file.filename or "").name
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Chỉ nhận file Excel .xlsx")
    raw = await file.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(400, "File lớn hơn 20 MB")
    try:
        rows = parse_kcb_list(raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, "Không đọc được file danh sách bệnh nhân.") from exc
    patients = db.list_patients(batch_id)
    plan = plan_sync(patients, rows)
    saved = db.assign_ma_kcb(batch_id, plan["assignments"], editor or "Đồng bộ mã KCB")
    if saved is None:
        raise HTTPException(404, "Không tìm thấy đoàn khám")
    return {
        "updated": saved["updated"],
        "unchanged": saved["unchanged"],
        "matched": len(plan["assignments"]),
        "name_only": plan["name_only"],
        "unmatched_patients": plan["unmatched_patients"],
        "unmatched_file": plan["unmatched_file"],
        "ambiguous": plan["ambiguous"],
    }


@app.post("/api/batches/{batch_id}/sync-clinical")
async def sync_clinical(batch_id: str, file: UploadFile = File(...), editor: str = Form("")):
    if not db.get_batch(batch_id):
        raise HTTPException(404, "Không tìm thấy đoàn khám")
    filename = Path(file.filename or "").name
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Chỉ nhận file Excel .xlsx")
    raw = await file.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(400, "File lớn hơn 20 MB")
    patients = db.list_patients(batch_id)
    if not any((patient["data"].get("MA_KCB") or "").strip() for patient in patients):
        raise HTTPException(400, "Chưa đồng bộ mã KCB. Hãy đồng bộ mã KCB trước khi đồng bộ khám lâm sàng.")
    try:
        results = parse_clinical_workbook(raw)
        plan = plan_clinical_sync(patients, results)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, "Không đọc được file khám lâm sàng.") from exc
    saved = db.assign_patient_fields(batch_id, plan["updates"], CLINICAL_COLUMNS, editor or "Đồng bộ lâm sàng")
    if saved is None:
        raise HTTPException(404, "Không tìm thấy đoàn khám")
    return {
        "updated": saved["updated"],
        "unchanged": saved["unchanged"],
        "matched": len(plan["updates"]),
        "skipped_not_in_batch": plan["skipped_not_in_batch"],
        "missing_in_file": plan["missing_in_file"],
        "without_code": plan["without_code"],
    }


@app.post("/api/batches/{batch_id}/sync-cls")
async def sync_cls(batch_id: str, file: UploadFile = File(...), editor: str = Form("")):
    if not db.get_batch(batch_id):
        raise HTTPException(404, "Không tìm thấy đoàn khám")
    filename = Path(file.filename or "").name
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Chỉ nhận file Excel .xlsx")
    raw = await file.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(400, "File lớn hơn 20 MB")
    patients = db.list_patients(batch_id)
    if not any((patient["data"].get("MA_KCB") or "").strip() for patient in patients):
        raise HTTPException(400, "Chưa đồng bộ mã KCB. Hãy đồng bộ mã KCB trước khi đồng bộ cận lâm sàng.")
    try:
        results = parse_lab_workbook(raw)
        plan = plan_lab_sync(patients, results)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, "Không đọc được file kết quả cận lâm sàng.") from exc
    saved = db.assign_patient_fields(batch_id, plan["updates"], LAB_COLUMNS, editor or "Đồng bộ cận lâm sàng")
    if saved is None:
        raise HTTPException(404, "Không tìm thấy đoàn khám")
    return {
        "updated": saved["updated"],
        "unchanged": saved["unchanged"],
        "matched": len(plan["updates"]),
        "skipped_not_in_batch": plan["skipped_not_in_batch"],
        "missing_in_file": plan["missing_in_file"],
        "without_code": plan["without_code"],
    }


@app.get("/api/batches/{batch_id}/export")
def export_batch(batch_id: str):
    batch = db.get_batch(batch_id)
    if not batch:
        raise HTTPException(404, "Không tìm thấy đoàn khám")
    path = db._file_path(batch_id)
    patients = db.list_patients(batch_id)
    content = excel_io.export_workbook(path, patients)
    filename = f"{batch['name']}.xlsx"
    disposition = f"attachment; filename*=UTF-8''{quote(filename)}"
    return Response(
        content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": disposition},
    )


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
