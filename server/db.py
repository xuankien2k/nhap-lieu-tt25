import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
FILES = DATA / "files"
DB_PATH = DATA / "ksk.sqlite"

_lock = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat()


def connect():
    DATA.mkdir(parents=True, exist_ok=True)
    FILES.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    with _lock, connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS batches (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                source_filename TEXT NOT NULL DEFAULT '',
                file_path TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS patients (
                id TEXT PRIMARY KEY,
                batch_id TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                data TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                updated_by TEXT NOT NULL DEFAULT '',
                FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_patients_batch ON patients(batch_id, sort_order);
            """
        )


def _batch_row(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "note": row["note"],
        "source_filename": row["source_filename"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "patient_count": row["patient_count"],
        "concluded_count": row["concluded_count"],
    }


def list_batches():
    with _lock, connect() as conn:
        rows = conn.execute(
            """
            SELECT b.*,
              (SELECT COUNT(*) FROM patients p WHERE p.batch_id = b.id) AS patient_count,
              (SELECT COUNT(*) FROM patients p
                 WHERE p.batch_id = b.id
                   AND COALESCE(json_extract(p.data, '$.CW'), '') != '') AS concluded_count
            FROM batches b
            ORDER BY b.created_at DESC
            """
        ).fetchall()
    return [_batch_row(row) for row in rows]


def get_batch(batch_id):
    with _lock, connect() as conn:
        row = conn.execute(
            """
            SELECT b.*,
              (SELECT COUNT(*) FROM patients p WHERE p.batch_id = b.id) AS patient_count,
              (SELECT COUNT(*) FROM patients p
                 WHERE p.batch_id = b.id
                   AND COALESCE(json_extract(p.data, '$.CW'), '') != '') AS concluded_count
            FROM batches b WHERE b.id = ?
            """,
            (batch_id,),
        ).fetchone()
    return _batch_row(row) if row else None


def _file_path(batch_id):
    with _lock, connect() as conn:
        row = conn.execute("SELECT file_path FROM batches WHERE id = ?", (batch_id,)).fetchone()
    return row["file_path"] if row else None


def create_batch(name, note="", source_filename="", file_bytes=None):
    batch_id = uuid.uuid4().hex
    stamp = now()
    file_path = ""
    if file_bytes:
        FILES.mkdir(parents=True, exist_ok=True)
        dest = FILES / f"{batch_id}.xlsx"
        dest.write_bytes(file_bytes)
        file_path = str(dest)
    with _lock, connect() as conn:
        conn.execute(
            """
            INSERT INTO batches (id, name, note, source_filename, file_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (batch_id, name.strip() or "Đoàn mới", note.strip(), source_filename, file_path, stamp, stamp),
        )
    return get_batch(batch_id)


def update_batch(batch_id, name=None, note=None):
    fields = []
    values = []
    if name is not None:
        fields.append("name = ?")
        values.append(name.strip() or "Đoàn mới")
    if note is not None:
        fields.append("note = ?")
        values.append(note.strip())
    if not fields:
        return get_batch(batch_id)
    fields.append("updated_at = ?")
    values.append(now())
    values.append(batch_id)
    with _lock, connect() as conn:
        cur = conn.execute(f"UPDATE batches SET {', '.join(fields)} WHERE id = ?", values)
        if cur.rowcount == 0:
            return None
    return get_batch(batch_id)


def delete_batch(batch_id):
    path = _file_path(batch_id)
    with _lock, connect() as conn:
        cur = conn.execute("DELETE FROM batches WHERE id = ?", (batch_id,))
        deleted = cur.rowcount > 0
    if deleted and path:
        file = Path(path)
        if file.exists():
            file.unlink()
    return deleted


def _patient_row(row):
    return {
        "id": row["id"],
        "batch_id": row["batch_id"],
        "sort_order": row["sort_order"],
        "data": json.loads(row["data"]),
        "updated_at": row["updated_at"],
        "updated_by": row["updated_by"],
    }


def list_patients(batch_id):
    with _lock, connect() as conn:
        rows = conn.execute(
            "SELECT * FROM patients WHERE batch_id = ? ORDER BY sort_order, rowid",
            (batch_id,),
        ).fetchall()
    return [_patient_row(row) for row in rows]


def get_patient(patient_id):
    with _lock, connect() as conn:
        row = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    return _patient_row(row) if row else None


def next_sort_order(conn, batch_id):
    row = conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM patients WHERE batch_id = ?", (batch_id,)).fetchone()
    return row["n"]


def insert_patients(batch_id, records, editor=""):
    stamp = now()
    with _lock, connect() as conn:
        exists = conn.execute("SELECT 1 FROM batches WHERE id = ?", (batch_id,)).fetchone()
        if not exists:
            return None
        order = next_sort_order(conn, batch_id)
        for record in records:
            conn.execute(
                """
                INSERT INTO patients (id, batch_id, sort_order, data, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (uuid.uuid4().hex, batch_id, order, json.dumps(record, ensure_ascii=False), stamp, editor),
            )
            order += 1
        conn.execute("UPDATE batches SET updated_at = ? WHERE id = ?", (stamp, batch_id))
    return list_patients(batch_id)


def create_patient(batch_id, data, editor=""):
    stamp = now()
    patient_id = uuid.uuid4().hex
    with _lock, connect() as conn:
        exists = conn.execute("SELECT 1 FROM batches WHERE id = ?", (batch_id,)).fetchone()
        if not exists:
            return None
        order = next_sort_order(conn, batch_id)
        if not str(data.get("A", "")).strip():
            data["A"] = str(order)
        conn.execute(
            """
            INSERT INTO patients (id, batch_id, sort_order, data, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (patient_id, batch_id, order, json.dumps(data, ensure_ascii=False), stamp, editor),
        )
        conn.execute("UPDATE batches SET updated_at = ? WHERE id = ?", (stamp, batch_id))
    return get_patient(patient_id)


def patch_patient(patient_id, fields, base, editor=""):
    stamp = now()
    with _lock, connect() as conn:
        row = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
        if not row:
            return None
        data = json.loads(row["data"])
        conflicts = []
        for key, value in fields.items():
            current = data.get(key, "") or ""
            original = (base or {}).get(key, "") or ""
            new_value = "" if value is None else str(value)
            if current != original and current != new_value:
                conflicts.append(key)
                continue
            data[key] = new_value
        conn.execute(
            "UPDATE patients SET data = ?, updated_at = ?, updated_by = ? WHERE id = ?",
            (json.dumps(data, ensure_ascii=False), stamp, editor or row["updated_by"], patient_id),
        )
        conn.execute("UPDATE batches SET updated_at = ? WHERE id = ?", (stamp, row["batch_id"]))
    patient = get_patient(patient_id)
    return {"patient": patient, "conflicts": conflicts}


def assign_ma_kcb(batch_id, assignments, editor=""):
    stamp = now()
    updated = 0
    unchanged = 0
    with _lock, connect() as conn:
        exists = conn.execute("SELECT 1 FROM batches WHERE id = ?", (batch_id,)).fetchone()
        if not exists:
            return None
        for patient_id, code in assignments.items():
            row = conn.execute(
                "SELECT data FROM patients WHERE id = ? AND batch_id = ?",
                (patient_id, batch_id),
            ).fetchone()
            if not row:
                continue
            data = json.loads(row["data"])
            if (data.get("MA_KCB") or "") == code:
                unchanged += 1
                continue
            data["MA_KCB"] = code
            conn.execute(
                "UPDATE patients SET data = ?, updated_at = ?, updated_by = ? WHERE id = ?",
                (json.dumps(data, ensure_ascii=False), stamp, editor, patient_id),
            )
            updated += 1
        if updated:
            conn.execute("UPDATE batches SET updated_at = ? WHERE id = ?", (stamp, batch_id))
    return {"updated": updated, "unchanged": unchanged}


def assign_patient_fields(batch_id, updates, allowed, editor=""):
    stamp = now()
    updated = 0
    unchanged = 0
    allowed = set(allowed)
    with _lock, connect() as conn:
        exists = conn.execute("SELECT 1 FROM batches WHERE id = ?", (batch_id,)).fetchone()
        if not exists:
            return None
        for patient_id, fields in updates.items():
            row = conn.execute(
                "SELECT data FROM patients WHERE id = ? AND batch_id = ?",
                (patient_id, batch_id),
            ).fetchone()
            if not row:
                continue
            data = json.loads(row["data"])
            changed = False
            for key, value in fields.items():
                if key not in allowed:
                    continue
                new_value = "" if value is None else str(value)
                if (data.get(key) or "") != new_value:
                    data[key] = new_value
                    changed = True
            if not changed:
                unchanged += 1
                continue
            conn.execute(
                "UPDATE patients SET data = ?, updated_at = ?, updated_by = ? WHERE id = ?",
                (json.dumps(data, ensure_ascii=False), stamp, editor, patient_id),
            )
            updated += 1
        if updated:
            conn.execute("UPDATE batches SET updated_at = ? WHERE id = ?", (stamp, batch_id))
    return {"updated": updated, "unchanged": unchanged}


def delete_patient(patient_id):
    with _lock, connect() as conn:
        row = conn.execute("SELECT batch_id FROM patients WHERE id = ?", (patient_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM patients WHERE id = ?", (patient_id,))
        conn.execute("UPDATE batches SET updated_at = ? WHERE id = ?", (now(), row["batch_id"]))
    return True
