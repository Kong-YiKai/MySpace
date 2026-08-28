from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import sys
from time import monotonic

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
WORKER_DIRECTORY = ROOT / "apps" / "compute-worker-python"
sys.path.insert(0, str(WORKER_DIRECTORY))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from recognizer import (  # noqa: E402
    RecognitionError,
    detect_media_type,
    geometry_overlay_data_url,
    recognize_floor_plan,
    validate_and_decode,
)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the real two-pass GPT floor-plan recognizer against one local image.",
    )
    parser.add_argument("image", type=Path, help="PNG, JPEG, or WebP floor-plan image")
    parser.add_argument("--model", help="Override FLOOR_PLAN_VISION_MODEL for this run")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT / "artifacts" / "floor-plan-ai",
        help="Directory for plan JSON and the review overlay",
    )
    return parser.parse_args()


def decode_data_url(data_url: str) -> bytes:
    _, encoded = data_url.split(",", 1)
    return base64.b64decode(encoded)


def main() -> int:
    args = parse_arguments()
    load_dotenv(ROOT / ".env", override=False)
    if not os.getenv("OPENAI_API_KEY", "").strip():
        print(json.dumps({
            "status": "blocked",
            "errorCode": "floor_plan_ai_unavailable",
            "message": "请先在项目根目录 .env 中配置 OPENAI_API_KEY。",
        }, ensure_ascii=False, indent=2))
        return 2

    image_path = args.image.resolve()
    if not image_path.is_file():
        print(json.dumps({
            "status": "failed",
            "errorCode": "input_file_missing",
            "message": f"找不到户型图片：{image_path}",
        }, ensure_ascii=False, indent=2))
        return 2

    data = image_path.read_bytes()
    media_type = detect_media_type(data)
    if media_type is None:
        print(json.dumps({
            "status": "failed",
            "errorCode": "unsupported_file",
            "message": "仅支持 PNG、JPEG 或 WebP 户型图片。",
        }, ensure_ascii=False, indent=2))
        return 2

    started = monotonic()
    try:
        decoded = validate_and_decode(data, media_type, len(data))
        plan = recognize_floor_plan(decoded.rgb, model=args.model)
    except RecognitionError as error:
        print(json.dumps({
            "status": "rejected",
            "errorCode": error.code,
            "message": str(error),
            "confidence": error.confidence,
            "retryable": error.retryable,
            "elapsedSeconds": round(monotonic() - started, 2),
        }, ensure_ascii=False, indent=2))
        return 1

    output_directory = args.output_dir.resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    plan_path = output_directory / "structured-floor-plan.json"
    overlay_path = output_directory / "geometry-review-overlay.jpg"
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    bounds = plan["diagnostics"]["sourceBoundsNormalized"]
    overlay_path.write_bytes(decode_data_url(geometry_overlay_data_url(decoded.rgb, plan, bounds)))

    print(json.dumps({
        "status": "approved",
        "model": plan["diagnostics"]["model"],
        "confidence": plan["confidence"],
        "wallCount": len(plan["walls"]),
        "openingCount": len(plan["openings"]),
        "roomCount": len(plan["rooms"]),
        "entrance": plan["entrance"],
        "elapsedSeconds": round(monotonic() - started, 2),
        "planPath": str(plan_path),
        "overlayPath": str(overlay_path),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
