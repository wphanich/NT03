"""สร้างไฟล์ thai-address.js จากข้อมูลจังหวัด/อำเภอ/ตำบล

แหล่งข้อมูล: https://github.com/kongvut/thai-province-data (MIT License)

วิธีใช้:
    git clone --depth 1 https://github.com/kongvut/thai-province-data.git
    python3 scripts/build_thai_address.py \
        thai-province-data/api/latest/province_with_district_and_sub_district.json
"""
import json
import sys
from pathlib import Path

src = Path(sys.argv[1])
out = Path(__file__).resolve().parent.parent / "public" / "thai-address.js"

data = json.loads(src.read_text(encoding="utf-8"))
compact = [
    [p["name"]["th"], [
        [d["name"]["th"], [
            [s["name"]["th"], s["zip_code"]]
            for s in d["sub_districts"] if not s.get("deleted_at")
        ]]
        for d in p["districts"] if not d.get("deleted_at")
    ]]
    for p in data if not p.get("deleted_at")
]

header = (
    "// ข้อมูลจังหวัด > เขต/อำเภอ > แขวง/ตำบล [ชื่อ, รหัสไปรษณีย์]\n"
    "// ที่มา: https://github.com/kongvut/thai-province-data (MIT License, Copyright (c) 2025 Kongvut Sangkla)\n"
    "// สร้างด้วย scripts/build_thai_address.py — ห้ามแก้ไขด้วยมือ\n"
)
out.write_text(
    header + "window.THAI_ADDRESS = "
    + json.dumps(compact, ensure_ascii=False, separators=(",", ":")) + ";\n",
    encoding="utf-8",
)
print(f"wrote {out} ({out.stat().st_size:,} bytes)")
