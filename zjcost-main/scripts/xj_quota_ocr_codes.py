from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR
from tqdm import tqdm


CODE_RE = re.compile(r"(?<!\d)(\d{1,2})\s*-\s*(\d{1,3})(?!\d)")


def desktop() -> Path:
    return Path.home() / "Desktop"


def image_dirs() -> list[Path]:
    return sorted(
        [p for p in desktop().iterdir() if p.is_dir() and "2020" in p.name and p.name.endswith(".pdf")],
        key=lambda p: p.name,
    )


def table_boxes(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    bw = cv2.threshold(gray, 210, 255, cv2.THRESH_BINARY_INV)[1]

    # Table borders are long thin strokes. Pull them out separately and merge.
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (45, 1))
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 35))
    horizontal = cv2.morphologyEx(bw, cv2.MORPH_OPEN, h_kernel)
    vertical = cv2.morphologyEx(bw, cv2.MORPH_OPEN, v_kernel)
    grid = cv2.dilate(cv2.bitwise_or(horizontal, vertical), np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(grid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes: list[tuple[int, int, int, int]] = []
    h, w = img.shape[:2]
    for c in contours:
        x, y, bwid, bh = cv2.boundingRect(c)
        if bwid > w * 0.45 and bh > 80:
            boxes.append((x, y, x + bwid, y + bh))
    boxes.sort(key=lambda b: (b[1], b[0]))

    merged: list[tuple[int, int, int, int]] = []
    for box in boxes:
        x1, y1, x2, y2 = box
        if merged and y1 <= merged[-1][3] + 10 and abs(x1 - merged[-1][0]) < 25:
            px1, py1, px2, py2 = merged[-1]
            merged[-1] = (min(px1, x1), min(py1, y1), max(px2, x2), max(py2, y2))
        else:
            merged.append(box)
    return merged


def code_header_crops(img: np.ndarray) -> list[np.ndarray]:
    crops: list[np.ndarray] = []
    h, w = img.shape[:2]
    for x1, y1, x2, y2 in table_boxes(img):
        # The code row is normally the first 1-2 rows of the table. Include a
        # little context so OCR sees "定额编号" and the code cells.
        pad = 8
        cy1 = max(0, y1 - pad)
        cy2 = min(h, y1 + min(115, max(90, (y2 - y1) // 4)))
        cx1 = max(0, x1 - pad)
        cx2 = min(w, x2 + pad)
        crop = img[cy1:cy2, cx1:cx2]
        if crop.size:
            crops.append(crop)
    return crops


def normalize_code(ch: str, no: str) -> str:
    return f"{int(ch)}-{int(no)}"


def main() -> None:
    out_dir = Path.cwd() / "output" / "xj_quota_check"
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_path = out_dir / "ocr_code_pages.json"
    progress_path = out_dir / "ocr_code_pages.progress.jsonl"

    ocr = RapidOCR()
    code_pages: dict[str, list[dict[str, object]]] = defaultdict(list)
    page_text: list[dict[str, object]] = []
    done: set[str] = set()

    if progress_path.exists():
        for line in progress_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            page_id = f"{rec['folder']}/{rec['image']}"
            done.add(page_id)
            page_text.append(rec)
            for code in rec.get("codes", []):
                code_pages[code].append({"folder": rec["folder"], "image": rec["image"]})

    images: list[Path] = []
    for d in image_dirs():
        images.extend(sorted(d.glob("*.png")))

    for img_path in tqdm(images, desc="OCR code headers"):
        page_id = f"{img_path.parent.name}/{img_path.name}"
        if page_id in done:
            continue

        img = np.array(Image.open(img_path).convert("RGB"))
        crops = code_header_crops(img)
        found_on_page: set[str] = set()
        crop_texts: list[str] = []

        for idx, crop in enumerate(crops):
            result, _ = ocr(crop)
            texts = [r[1] for r in (result or [])]
            text = " ".join(texts)
            crop_texts.append(text)
            for ch, no in CODE_RE.findall(text):
                code = normalize_code(ch, no)
                found_on_page.add(code)

        # Fast path: if no table-frame crop produced any code, skip full-page OCR.
        # Most no-table pages are chapter notes / cover pages and would slow down
        # the run substantially while adding little signal for code extraction.

        for code in sorted(found_on_page, key=lambda c: tuple(map(int, c.split("-")))):
            code_pages[code].append({"folder": img_path.parent.name, "image": img_path.name})

        rec = {
            "folder": img_path.parent.name,
            "image": img_path.name,
            "codes": sorted(found_on_page, key=lambda c: tuple(map(int, c.split("-")))),
            "text_sample": " | ".join(crop_texts)[:1500],
        }
        page_text.append(rec)
        with progress_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    cache_path.write_text(
        json.dumps({"code_pages": code_pages, "pages": page_text}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"saved {cache_path}")


if __name__ == "__main__":
    main()
