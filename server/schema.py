"""Cột sổ khám sức khỏe định kỳ, bám sheet Ket qua KSKDK."""

from openpyxl.utils import get_column_letter


def F(col, label, type="text", required=False, hint="", wide=False):
    return {
        "col": col,
        "label": label,
        "type": type,
        "required": required,
        "hint": hint,
        "wide": wide or type == "textarea",
    }


SECTIONS = [
    {
        "id": "hanh-chinh",
        "title": "Thông tin hành chính",
        "groups": [
            {
                "title": "Định danh",
                "fields": [
                    F("A", "Số thứ tự", "number", hint="Số thứ tự trong đoàn"),
                    F("B", "Họ và tên", required=True, hint="Đầy đủ, có dấu"),
                    F("C", "Ngày tháng năm sinh", "date", required=True, hint="DD/MM/YYYY"),
                    F("D", "Giới tính", "gender", required=True),
                    F("E", "Số CCCD / mã định danh", required=True),
                    F("F", "Ngày cấp CCCD", "date", hint="DD/MM/YYYY"),
                    F("G", "Nơi cấp CCCD"),
                    F("H", "Số thẻ BHYT"),
                    F("I", "Số điện thoại"),
                ],
            },
            {
                "title": "Nơi ở và công tác",
                "fields": [
                    F("J", "Tỉnh/Thành phố nơi ở hiện tại", required=True),
                    F("K", "Xã/Phường nơi ở hiện tại", required=True),
                    F("L", "Nghề nghiệp"),
                    F("M", "Nơi công tác, học tập", wide=True),
                    F("N", "Đối tượng khám sức khỏe", required=True, wide=True),
                ],
            },
        ],
    },
    {
        "id": "the-luc",
        "title": "Khám thể lực",
        "groups": [
            {
                "title": "Chỉ số",
                "fields": [
                    F("O", "Ngày đo", "date", required=True, hint="DD/MM/YYYY"),
                    F("P", "Cân nặng (kg)", "number", required=True),
                    F("Q", "Chiều cao (cm)", "number", required=True),
                    F("R", "Mạch (lần/phút)", "number"),
                    F("S", "HA tâm thu", "number"),
                    F("T", "HA tâm trương", "number"),
                    F("U", "Vòng ngực (cm)", "number"),
                    F("V", "Phân loại thể lực", "grade", required=True),
                ],
            }
        ],
    },
    {
        "id": "lam-sang",
        "title": "Khám lâm sàng",
        "groups": [
            {
                "title": "Khám nội khoa",
                "fields": [
                    F("W", "Ngày khám", "date", required=True, hint="DD/MM/YYYY"),
                    F("X", "Khám tuần hoàn", "textarea"),
                    F("Y", "Phân loại tuần hoàn", "grade"),
                    F("Z", "Khám hô hấp", "textarea"),
                    F("AA", "Phân loại hô hấp", "grade"),
                    F("AB", "Khám tiêu hóa", "textarea"),
                    F("AC", "Phân loại tiêu hóa", "grade"),
                    F("AD", "Khám thận, tiết niệu", "textarea"),
                    F("AE", "Phân loại thận, tiết niệu", "grade"),
                    F("AF", "Khám nội tiết", "textarea"),
                    F("AG", "Phân loại nội tiết", "grade"),
                    F("AH", "Khám cơ xương khớp", "textarea"),
                    F("AI", "Phân loại cơ xương khớp", "grade"),
                    F("AJ", "Khám thần kinh", "textarea"),
                    F("AK", "Phân loại thần kinh", "grade"),
                    F("AL", "Khám tâm thần", "textarea"),
                    F("AM", "Phân loại tâm thần", "grade"),
                    F("AN", "Bác sỹ khám"),
                ],
            },
            {
                "title": "Khám ngoại khoa",
                "fields": [
                    F("AO", "Khám ngoại khoa", "textarea"),
                    F("AP", "Phân loại", "grade"),
                    F("AQ", "Bác sỹ khám"),
                ],
            },
            {
                "title": "Khám mắt",
                "fields": [
                    F("AR", "Không kính — mắt phải", "number", hint="Ghi số, ví dụ 9 nếu 9/10"),
                    F("AS", "Không kính — mắt trái", "number", hint="Ghi số, ví dụ 9 nếu 9/10"),
                    F("AT", "Có kính — mắt phải", "number"),
                    F("AU", "Có kính — mắt trái", "number"),
                    F("AV", "Các bệnh về mắt", "textarea"),
                    F("AW", "Phân loại", "grade"),
                    F("AX", "Bác sỹ khám"),
                ],
            },
            {
                "title": "Khám tai mũi họng",
                "fields": [
                    F("AY", "Tai trái — nói thường (m)", "number"),
                    F("AZ", "Tai trái — nói thầm (m)", "number"),
                    F("BA", "Tai phải — nói thường (m)", "number"),
                    F("BB", "Tai phải — nói thầm (m)", "number"),
                    F("BC", "Các bệnh về tai mũi họng", "textarea"),
                    F("BD", "Phân loại", "grade"),
                    F("BE", "Bác sỹ khám"),
                ],
            },
            {
                "title": "Khám răng hàm mặt",
                "fields": [
                    F("BF", "Hàm trên"),
                    F("BG", "Hàm dưới"),
                    F("BH", "Các bệnh về răng hàm mặt", "textarea"),
                    F("BI", "Phân loại", "grade"),
                    F("BJ", "Bác sỹ khám"),
                ],
            },
            {
                "title": "Khám da liễu",
                "fields": [
                    F("BK", "Kết quả khám da liễu", "textarea"),
                    F("BL", "Phân loại", "grade"),
                    F("BM", "Bác sỹ khám"),
                ],
            },
            {
                "title": "Khám sản phụ khoa",
                "fields": [
                    F("BN", "Kết quả khám", "textarea", hint="Đối với nữ"),
                    F("BO", "Phân loại", "grade"),
                    F("BP", "Bác sỹ khám"),
                ],
            },
        ],
    },
    {
        "id": "can-lam-sang",
        "title": "Kết quả cận lâm sàng",
        "groups": [
            {
                "title": "Công thức máu",
                "fields": [
                    F("BQ", "Hồng cầu (T/L)", "number"),
                    F("BR", "Bạch cầu (G/L)", "number"),
                    F("BS", "Tiểu cầu (G/L)", "number"),
                    F("BT", "Huyết sắc tố (g/L)", "number"),
                ],
            },
            {
                "title": "Đường huyết",
                "fields": [F("BU", "Đường huyết (mmol/l)", "number")],
            },
            {
                "title": "Chức năng thận",
                "fields": [
                    F("BV", "Ure (mmol/l)", "number"),
                    F("BW", "Creatinin (µmol/l)", "number"),
                    F("BX", "Bilirubin TP (µmol/l)", "number"),
                ],
            },
            {
                "title": "Chức năng gan",
                "fields": [
                    F("BY", "AST (U/l)", "number"),
                    F("BZ", "ALT (U/l)", "number"),
                    F("CA", "GGT (U/l)", "number"),
                ],
            },
            {
                "title": "Mỡ máu",
                "fields": [
                    F("CB", "Triglycerid (mmol/l)", "number"),
                    F("CC", "Cholesterol TP (mmol/l)", "number"),
                    F("CD", "HDL-C (mmol/l)", "number"),
                    F("CE", "LDL-C (mmol/l)", "number"),
                ],
            },
            {
                "title": "HbA1c",
                "fields": [F("CF", "HbA1c (%)", "number")],
            },
            {
                "title": "Xét nghiệm miễn dịch",
                "fields": [
                    F("CG", "AFP (ng/ml)", "number"),
                    F("CH", "CEA (ng/ml)", "number"),
                    F("CI", "PSA total (ng/ml)", "number"),
                    F("CJ", "HBsAg"),
                    F("CK", "HBsAb"),
                    F("CL", "Anti HCV"),
                ],
            },
            {
                "title": "Xét nghiệm nước tiểu",
                "fields": [
                    F("CM", "Axit uric (µmol/l)", "number"),
                    F("CN", "Glucose (mmol/L)", "number"),
                    F("CO", "Protein niệu (g/l)"),
                    F("CP", "Hồng cầu"),
                    F("CQ", "Bạch cầu"),
                ],
            },
            {
                "title": "Chẩn đoán hình ảnh",
                "fields": [
                    F("CR", "Điện tim", "textarea"),
                    F("CS", "Chụp X-quang", "textarea"),
                    F("CT", "Siêu âm", "textarea"),
                    F("CU", "Chẩn đoán hình ảnh khác", "textarea"),
                ],
            },
            {
                "title": "Khác",
                "fields": [F("CV", "Các xét nghiệm khác", "textarea")],
            },
        ],
    },
    {
        "id": "ket-luan",
        "title": "Kết luận",
        "groups": [
            {
                "title": "Kết luận sức khỏe",
                "fields": [
                    F("CW", "Phân loại sức khỏe", "grade", required=True),
                    F("CX", "Mô tả các bệnh tật", "textarea", required=True),
                    F("CY", "Mã bệnh ICD-10", "textarea", required=True, hint="Nhiều mã cách nhau bằng dấu chấm phẩy"),
                    F("CZ", "Lời dặn bác sỹ", "textarea"),
                    F("DA", "Ngày kết luận", "date", required=True, hint="DD/MM/YYYY"),
                    F("DB", "Bác sĩ kết luận", required=True),
                    F("DC", "Mã cơ sở KCB", required=True),
                ],
            }
        ],
    },
]

GENDER_OPTIONS = [
    {"value": "1", "label": "Nam"},
    {"value": "2", "label": "Nữ"},
]

GRADE_OPTIONS = [
    {"value": "1", "label": "Rất khoẻ"},
    {"value": "2", "label": "Khoẻ"},
    {"value": "3", "label": "Trung bình"},
    {"value": "4", "label": "Yếu"},
    {"value": "5", "label": "Rất yếu"},
]


def iter_fields():
    for section in SECTIONS:
        for group in section["groups"]:
            for field in group["fields"]:
                yield field


FIELDS = list(iter_fields())
FIELD_MAP = {field["col"]: field for field in FIELDS}
REQUIRED = [field["col"] for field in FIELDS if field["required"]]
COLUMNS = [field["col"] for field in FIELDS]

_expect = [get_column_letter(i) for i in range(1, 108)]
if COLUMNS != _expect:
    missing = [col for col in _expect if col not in COLUMNS]
    extra = [col for col in COLUMNS if col not in _expect]
    raise RuntimeError(f"Schema lệch mẫu Excel. Thiếu {missing}. Thừa {extra}.")


def public_schema():
    return {
        "sections": SECTIONS,
        "gender_options": GENDER_OPTIONS,
        "grade_options": GRADE_OPTIONS,
        "required": REQUIRED,
        "columns": COLUMNS,
    }
