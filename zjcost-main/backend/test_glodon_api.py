"""Manual BIMFACE smoke test.

This file is intentionally safe to import during pytest collection. To run it,
set BIMFACE_APPKEY, BIMFACE_APPSECRET and BIMFACE_DWG_FILE, then execute:

    python test_glodon_api.py
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from urllib.parse import quote

import requests


TOKEN_URL = "https://bimface.com/oauth2/token"
API_BASE = "https://api.bimface.com"


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def main() -> None:
    appkey = _required_env("BIMFACE_APPKEY")
    appsecret = _required_env("BIMFACE_APPSECRET")
    dwg_file = Path(_required_env("BIMFACE_DWG_FILE"))
    if not dwg_file.is_file():
        raise FileNotFoundError(dwg_file)

    print("=== 1. 获取 token ===")
    res = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": appkey,
            "client_secret": appsecret,
        },
        timeout=30,
    )
    res.raise_for_status()
    token = res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("token 获取成功")

    print("\n=== 2. 获取上传凭证 ===")
    encoded_name = quote(dwg_file.name)
    res = requests.get(f"{API_BASE}/file/uploadPolicy?name={encoded_name}", headers=headers, timeout=30)
    res.raise_for_status()
    upload_info = res.json()["data"]
    upload_url = upload_info["uploadUrl"]
    file_id = upload_info["fileId"]
    print(f"上传凭证获取成功，文件 ID: {file_id}")

    print("\n=== 3. 上传文件 ===")
    with dwg_file.open("rb") as f:
        res = requests.put(upload_url, data=f.read(), timeout=120)
    res.raise_for_status()
    print("上传完成")

    print("\n=== 4. 确认上传 ===")
    res = requests.post(f"{API_BASE}/file/confirm?fileId={file_id}", headers=headers, timeout=30)
    res.raise_for_status()
    print("确认上传完成")

    print("\n=== 5. 等待上传完成 ===")
    while True:
        res = requests.get(f"{API_BASE}/file/files/{file_id}/uploadStatus", headers=headers, timeout=30)
        res.raise_for_status()
        status = res.json()["data"]["status"]
        print(f"上传状态: {status}")
        if status == "success":
            break
        time.sleep(2)

    print("\n=== 6. 发起图纸转换 ===")
    res = requests.put(
        f"{API_BASE}/api/translate",
        headers=headers,
        json={"source": {"fileId": file_id, "compressed": False}},
        timeout=30,
    )
    res.raise_for_status()
    print("转换已发起")

    print("\n=== 7. 等待转换完成 ===")
    while True:
        res = requests.get(f"{API_BASE}/api/translate?fileId={file_id}", headers=headers, timeout=30)
        res.raise_for_status()
        status = res.json()["data"]["status"]
        print(f"转换状态: {status}")
        if status == "success":
            break
        time.sleep(3)

    print("\n=== 8. 发起结构化解析 ===")
    res = requests.put(
        f"{API_BASE}/api/files/{file_id}/extractFeatures",
        headers=headers,
        json={"config": {"features": ["sheetFrame", "floorTable", "component"]}},
        timeout=30,
    )
    res.raise_for_status()
    print("解析已发起")

    print("\n=== 9. 等待解析完成 ===")
    while True:
        res = requests.get(f"{API_BASE}/api/files/{file_id}/extractFeatures", headers=headers, timeout=30)
        res.raise_for_status()
        status = res.json()["data"]["status"]
        print(f"解析状态: {status}")
        if status == "success":
            break
        time.sleep(5)

    print("\n=== 10. 获取解析结果 ===")
    res = requests.get(f"{API_BASE}/api/data/v2/files/{file_id}/drawingFeatures", headers=headers, timeout=60)
    res.raise_for_status()
    result = res.json()["data"]
    print("识别完成")
    print(f"识别到图框数量: {len(result.get('sheetFrames', []))}")
    print(f"识别到楼层表数量: {len(result.get('floorTables', []))}")
    print(f"识别到构件数量: {len(result.get('components', []))}")


if __name__ == "__main__":
    main()
