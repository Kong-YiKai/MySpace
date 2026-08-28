from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from math import ceil, hypot
from typing import Any, Callable

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MIN_WIDTH = 240
MIN_HEIGHT = 180
DEFAULT_MODEL = "gpt-5.6-terra"
ProgressCallback = Callable[[str, float, str], None]


class RecognitionError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        confidence: float | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.confidence = confidence
        self.retryable = retryable


@dataclass(frozen=True)
class DecodedImage:
    rgb: np.ndarray
    media_type: str
    checksum_sha256: str
    width: int
    height: int


def validate_and_decode(data: bytes, expected_media_type: str, expected_size: int) -> DecodedImage:
    if len(data) != expected_size:
        raise RecognitionError("unsupported_file", "文件大小与上传授权不一致")
    if len(data) > MAX_FILE_BYTES:
        raise RecognitionError("file_too_large", "户型图不能超过 10 MB")
    detected = detect_media_type(data)
    if detected is None or detected != expected_media_type:
        raise RecognitionError("unsupported_file", "文件签名与声明的图片类型不一致")
    try:
        Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
        with Image.open(BytesIO(data)) as probe:
            probe.verify()
        with Image.open(BytesIO(data)) as source:
            source.load()
            image = source.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise RecognitionError("image_decode_failed", "图片无法安全解码") from error
    if image.width < MIN_WIDTH or image.height < MIN_HEIGHT:
        raise RecognitionError("floor_plan_not_detected", "图片分辨率过低，无法识别户型结构", 0.05)
    return DecodedImage(
        rgb=np.asarray(image),
        media_type=detected,
        checksum_sha256=sha256(data).hexdigest(),
        width=image.width,
        height=image.height,
    )


def detect_media_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


POINT_SCHEMA = {
    "type": "object",
    "properties": {
        "x": {"type": "integer", "minimum": 0, "maximum": 1000},
        "y": {"type": "integer", "minimum": 0, "maximum": 1000},
    },
    "required": ["x", "y"],
    "additionalProperties": False,
}

FLOOR_PLAN_UNDERSTANDING_SCHEMA = {
    "type": "object",
    "properties": {
        "planType": {
            "type": "string",
            "enum": ["decorated_floor_plan", "line_drawing", "blueprint", "not_floor_plan"],
        },
        "orientation": {"type": "string", "enum": ["portrait", "landscape", "square"]},
        "shouldReject": {"type": "boolean"},
        "rejectionReason": {"type": "string"},
        "bounds": {
            "type": "object",
            "properties": {
                "left": {"type": "integer", "minimum": 0, "maximum": 1000},
                "top": {"type": "integer", "minimum": 0, "maximum": 1000},
                "right": {"type": "integer", "minimum": 0, "maximum": 1000},
                "bottom": {"type": "integer", "minimum": 0, "maximum": 1000},
            },
            "required": ["left", "top", "right", "bottom"],
            "additionalProperties": False,
        },
        "estimatedWidthMeters": {"type": "number", "minimum": 2, "maximum": 50},
        "estimatedDepthMeters": {"type": "number", "minimum": 2, "maximum": 50},
        "scaleConfidence": {"type": "number", "minimum": 0, "maximum": 1},
        "walls": {
            "type": "array",
            "maxItems": 80,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "start": POINT_SCHEMA,
                    "end": POINT_SCHEMA,
                    "thicknessMeters": {"type": "number", "minimum": 0.08, "maximum": 0.5},
                    "heightMeters": {"type": "number", "minimum": 2, "maximum": 5},
                    "kind": {"type": "string", "enum": ["exterior", "interior"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["id", "start", "end", "thicknessMeters", "heightMeters", "kind", "confidence"],
                "additionalProperties": False,
            },
        },
        "openings": {
            "type": "array",
            "maxItems": 40,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "kind": {"type": "string", "enum": ["door", "window"]},
                    "wallId": {"type": "string"},
                    "centerOffset": {"type": "number", "minimum": 0, "maximum": 1},
                    "widthMeters": {"type": "number", "minimum": 0.35, "maximum": 8},
                    "heightMeters": {"type": "number", "minimum": 0.5, "maximum": 4},
                    "sillHeightMeters": {"type": "number", "minimum": 0, "maximum": 2.5},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["id", "kind", "wallId", "centerOffset", "widthMeters", "heightMeters", "sillHeightMeters", "confidence"],
                "additionalProperties": False,
            },
        },
        "rooms": {
            "type": "array",
            "maxItems": 32,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "kind": {"type": "string"},
                    "label": {"type": "string"},
                    "polygon": {"type": "array", "minItems": 3, "maxItems": 24, "items": POINT_SCHEMA},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["id", "kind", "label", "polygon", "confidence"],
                "additionalProperties": False,
            },
        },
        "entrance": {
            "type": "object",
            "properties": {
                "position": POINT_SCHEMA,
                "direction": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number", "minimum": -1, "maximum": 1},
                        "y": {"type": "number", "minimum": -1, "maximum": 1},
                    },
                    "required": ["x", "y"],
                    "additionalProperties": False,
                },
                "wallId": {"type": "string"},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            },
            "required": ["position", "direction", "wallId", "confidence"],
            "additionalProperties": False,
        },
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "ignoredElements": {"type": "array", "maxItems": 24, "items": {"type": "string"}},
        "uncertainRegions": {
            "type": "array",
            "maxItems": 16,
            "items": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "polygon": {"type": "array", "minItems": 3, "maxItems": 12, "items": POINT_SCHEMA},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["description", "polygon", "confidence"],
                "additionalProperties": False,
            },
        },
        "warnings": {"type": "array", "maxItems": 20, "items": {"type": "string"}},
    },
    "required": [
        "planType", "orientation", "shouldReject", "rejectionReason", "bounds", "estimatedWidthMeters",
        "estimatedDepthMeters", "scaleConfidence", "walls", "openings", "rooms", "entrance",
        "confidence", "ignoredElements", "uncertainRegions", "warnings",
    ],
    "additionalProperties": False,
}

FLOOR_PLAN_REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "approved": {"type": "boolean"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "summary": {"type": "string"},
        "criticalIssues": {"type": "array", "maxItems": 12, "items": {"type": "string"}},
    },
    "required": ["approved", "confidence", "summary", "criticalIssues"],
    "additionalProperties": False,
}


VISION_INSTRUCTIONS = """
你是住宅户型图结构分析器。输入可能是彩色装修效果户型、黑白线稿或工程蓝图。
只分析建筑空间，不要把家具、家电、地砖缝、木纹、地毯、装饰、文字、标尺、水印或阴影当成墙。

坐标使用整张输入图的归一化坐标：左上角 (0,0)，右下角 (1000,1000)。
- bounds 必须紧贴住宅建筑范围，排除页面留白和水印。
- 每面实体墙只输出一条中心线。粗墙的两条边缘绝不能输出成两面墙。
- 墙在门窗处仍是一面连续墙；门窗通过 openings 关联到对应 wallId。
- 不要为了闭合而虚构矩形外墙；忠实保留凹凸、阳台、花池等真实外轮廓。
- 房间 polygon 表示可使用的地面区域，按墙内边界近似。
- 入口必须是实际入户门，不是阳台门或卧室门。
- 图片没有明确尺寸时，根据标准门宽、家具和常见住宅尺度估算米制宽深，并降低 scaleConfidence。
- 看不清或无法形成可信拓扑时 shouldReject=true，不得编造。

返回所有主要实体墙、门窗、房间、入口、明确忽略的视觉元素及不确定区域。房间 label 保留图中可读的中文名称。
""".strip()


def recognize_floor_plan(
    image: np.ndarray,
    client: Any | None = None,
    model: str | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    model_id = model or os.getenv("FLOOR_PLAN_VISION_MODEL", DEFAULT_MODEL)
    if client is None:
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise RecognitionError(
                "floor_plan_ai_unavailable",
                "户型理解服务尚未配置 OPENAI_API_KEY",
            )
        try:
            from openai import OpenAI

            client = OpenAI(api_key=api_key, timeout=float(os.getenv("OPENAI_TIMEOUT_SECONDS", "75")))
        except Exception as error:
            raise RecognitionError(
                "floor_plan_ai_unavailable",
                "户型理解服务初始化失败",
                retryable=True,
            ) from error

    try:
        response = client.responses.create(
            model=model_id,
            store=False,
            reasoning={"effort": os.getenv("FLOOR_PLAN_REASONING_EFFORT", "medium")},
            max_output_tokens=12_000,
            instructions=VISION_INSTRUCTIONS,
            input=[{
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": "分析这张住宅户型图，严格按 schema 返回可用于几何校正的结构。",
                    },
                    {
                        "type": "input_image",
                        "image_url": image_data_url(image),
                        "detail": "high",
                    },
                ],
            }],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "floor_plan_understanding",
                    "strict": True,
                    "schema": FLOOR_PLAN_UNDERSTANDING_SCHEMA,
                },
            },
        )
        output_text = getattr(response, "output_text", "")
        if not output_text:
            raise ValueError("OpenAI response did not contain output_text")
        understanding = json.loads(output_text)
    except RecognitionError:
        raise
    except Exception as error:
        raise RecognitionError(
            "floor_plan_ai_failed",
            "GPT 户型理解暂时失败，请稍后重试",
            retryable=True,
        ) from error

    if progress_callback is not None:
        progress_callback("geometry-refining", 0.58, "GPT 已理解户型，正在吸附真实墙线并建立拓扑…")
    plan = build_structured_plan(image, understanding, model_id)
    if progress_callback is not None:
        progress_callback("gpt-reviewing", 0.72, "几何结构已生成，GPT 正在复核漏墙、错墙与真实入口…")
    try:
        review_response = client.responses.create(
            model=model_id,
            store=False,
            reasoning={"effort": os.getenv("FLOOR_PLAN_REASONING_EFFORT", "medium")},
            max_output_tokens=3_000,
            instructions=(
                "你是住宅户型几何质量审查员。第一张图是原始户型，第二张图是系统生成的几何叠加图："
                "红线是墙体中心线，蓝线是房间地面区域，绿点和箭头是入户位置与方向。"
                "逐项核对建筑外轮廓、主要隔墙、房间关系、门窗和真实入户门。"
                "如果家具、地砖、文字被当成墙，主要墙体缺失，入口错误，或结构与原图明显不符，必须 approved=false。"
            ),
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "复核几何叠加结果。宁可拒绝，也不要批准错误毛坯。"},
                    {"type": "input_image", "image_url": image_data_url(image), "detail": "high"},
                    {
                        "type": "input_image",
                        "image_url": geometry_overlay_data_url(image, plan, understanding["bounds"]),
                        "detail": "high",
                    },
                ],
            }],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "floor_plan_geometry_review",
                    "strict": True,
                    "schema": FLOOR_PLAN_REVIEW_SCHEMA,
                },
            },
        )
        review_text = getattr(review_response, "output_text", "")
        if not review_text:
            raise ValueError("OpenAI review did not contain output_text")
        review = json.loads(review_text)
    except Exception as error:
        raise RecognitionError(
            "floor_plan_ai_failed",
            "GPT 户型复核暂时失败，请稍后重试",
            retryable=True,
        ) from error

    review_confidence = float(review["confidence"])
    review_approved = bool(review["approved"]) and review_confidence >= 0.68 and not review["criticalIssues"]
    plan["confidence"] = round(min(float(plan["confidence"]), review_confidence), 4)
    plan["diagnostics"]["reviewConfidence"] = round(review_confidence, 4)
    plan["diagnostics"]["reviewSummary"] = review["summary"]
    plan["diagnostics"]["reviewApproved"] = review_approved
    plan["diagnostics"]["reviewCriticalIssues"] = review["criticalIssues"]
    plan["diagnostics"]["requiresUserConfirmation"] = not review_approved
    if not review_approved:
        plan["diagnostics"]["warnings"] = [
            *plan["diagnostics"]["warnings"],
            str(review["summary"]).strip() or "GPT 建议用户确认几何结果",
            *review["criticalIssues"],
        ]
    return plan


def image_data_url(image: np.ndarray) -> str:
    source = Image.fromarray(image.astype(np.uint8))
    source.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
    output = BytesIO()
    source.save(output, format="JPEG", quality=92, optimize=True)
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def geometry_overlay_data_url(
    image: np.ndarray,
    plan: dict[str, Any],
    bounds: dict[str, Any],
) -> str:
    overlay = image.copy()
    image_height, image_width = overlay.shape[:2]

    def to_pixel(point: list[float]) -> tuple[int, int]:
        normalized_x = bounds["left"] + point[0] / plan["width"] * (bounds["right"] - bounds["left"])
        normalized_y = bounds["top"] + point[1] / plan["depth"] * (bounds["bottom"] - bounds["top"])
        return (
            round(normalized_x / 1000 * (image_width - 1)),
            round(normalized_y / 1000 * (image_height - 1)),
        )

    for room in plan["rooms"]:
        polygon = np.asarray([to_pixel(point) for point in room["polygon"]], dtype=np.int32)
        cv2.polylines(overlay, [polygon], True, (30, 110, 255), 3, cv2.LINE_AA)
    for wall in plan["walls"]:
        cv2.line(overlay, to_pixel(wall["start"]), to_pixel(wall["end"]), (255, 45, 35), 5, cv2.LINE_AA)
    entrance = to_pixel(plan["entrance"]["position"])
    direction = plan["entrance"]["direction"]
    target = (round(entrance[0] + direction[0] * 38), round(entrance[1] + direction[1] * 38))
    cv2.circle(overlay, entrance, 9, (25, 190, 70), -1, cv2.LINE_AA)
    cv2.arrowedLine(overlay, entrance, target, (25, 190, 70), 5, cv2.LINE_AA, tipLength=0.35)
    return image_data_url(overlay)


def build_structured_plan(image: np.ndarray, understanding: dict[str, Any], model_id: str) -> dict[str, Any]:
    confidence = float(understanding["confidence"])
    semantic_warnings: list[str] = []
    if understanding["shouldReject"] or understanding["planType"] == "not_floor_plan":
        message = understanding["rejectionReason"].strip() or "GPT 未识别到可信的住宅户型结构"
        raise RecognitionError("low_plan_confidence", message, confidence)
    bounds = dict(understanding["bounds"])
    if bounds["right"] - bounds["left"] < 120 or bounds["bottom"] - bounds["top"] < 120:
        bounds = {"left": 0, "top": 0, "right": 1000, "bottom": 1000}
        semantic_warnings.append("GPT 给出的住宅范围异常，已回退到完整图片范围")

    width = round(float(understanding["estimatedWidthMeters"]), 4)
    depth = round(float(understanding["estimatedDepthMeters"]), 4)
    wall_candidates = [wall for wall in understanding["walls"] if float(wall["confidence"]) >= 0.48]
    walls: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, candidate in enumerate(wall_candidates):
        start_norm, end_norm = refine_wall_axis(image, candidate["start"], candidate["end"])
        start = normalized_to_plan(start_norm, bounds, width, depth)
        end = normalized_to_plan(end_norm, bounds, width, depth)
        if hypot(end[0] - start[0], end[1] - start[1]) < 0.35:
            continue
        wall_id = unique_id(str(candidate["id"]), "wall", index, seen_ids)
        walls.append({
            "id": wall_id,
            "sourceIds": [str(candidate["id"])],
            "sourceKind": str(candidate["kind"]),
            "start": start,
            "end": end,
            "thickness": round(float(candidate["thicknessMeters"]), 3),
            "height": round(float(candidate["heightMeters"]), 3),
        })

    walls = snap_wall_endpoints(walls)
    walls = deduplicate_walls(walls)
    topology_diagnostics = validate_wall_topology(walls, width, depth, confidence)
    source_to_wall = {
        source_id: wall["id"]
        for wall in walls
        for source_id in wall["sourceIds"]
    }

    openings = []
    opening_ids: set[str] = set()
    for index, opening in enumerate(understanding["openings"]):
        wall_id = source_to_wall.get(str(opening["wallId"]))
        if wall_id is None or float(opening["confidence"]) < 0.5:
            continue
        openings.append({
            "id": unique_id(str(opening["id"]), "opening", index, opening_ids),
            "kind": opening["kind"],
            "wallId": wall_id,
            "offset": round(float(opening["centerOffset"]), 4),
            "width": round(float(opening["widthMeters"]), 3),
            "height": round(float(opening["heightMeters"]), 3),
            "sillHeight": round(float(opening["sillHeightMeters"]), 3),
        })

    rooms = []
    room_ids: set[str] = set()
    for index, room in enumerate(understanding["rooms"]):
        if float(room["confidence"]) < 0.42 or len(room["polygon"]) < 3:
            continue
        polygon = clean_polygon([
            normalized_to_plan(point, bounds, width, depth)
            for point in room["polygon"]
        ])
        if len(polygon) < 3 or polygon_self_intersects(polygon):
            semantic_warnings.append(f'房间“{room["label"]}”边界异常，已跳过该房间区域')
            continue
        if polygon_area(polygon) < 0.6:
            continue
        rooms.append({
            "id": unique_id(str(room["id"]), "room", index, room_ids),
            "kind": str(room["kind"]) or "room",
            "label": str(room["label"]),
            "polygon": polygon,
            "confidence": round(float(room["confidence"]), 4),
        })
    if not rooms:
        rooms.append({
            "id": "room-fallback",
            "kind": "residential-space",
            "label": "住宅空间",
            "polygon": [[0.0, 0.0], [width, 0.0], [width, depth], [0.0, depth]],
            "confidence": round(min(confidence, 0.35), 4),
        })
        semantic_warnings.append("未形成独立房间区域，已使用住宅整体范围供用户确认")

    room_warnings = validate_rooms(rooms, walls, width, depth)
    opening_warnings = validate_openings(openings, walls)

    entrance = understanding["entrance"]
    entrance_position = normalized_to_plan(entrance["position"], bounds, width, depth)
    entrance_wall_id = source_to_wall.get(str(entrance["wallId"]))
    entrance_warnings: list[str] = []
    if entrance_wall_id is None:
        entrance_candidates = [wall for wall in walls if wall["sourceKind"] == "exterior"] or walls
        entrance_wall = min(
            entrance_candidates,
            key=lambda wall: point_to_segment_distance(entrance_position, wall["start"], wall["end"])[0],
        )
        entrance_wall_id = entrance_wall["id"]
        entrance_warnings.append("GPT 入口墙体关联已失效，系统已吸附到最近外墙")
    try:
        direction = normalize_direction(entrance["direction"])
    except RecognitionError:
        direction = [0.0, 0.0]
        entrance_warnings.append("GPT 入户方向不明确，系统已根据墙体法线推断")
    entrance_position, direction, inferred_opening, repair_warnings = repair_and_snap_entrance(
        entrance_position,
        direction,
        entrance_wall_id,
        walls,
        openings,
    )
    entrance_warnings.extend(repair_warnings)
    if inferred_opening is not None:
        openings.append(inferred_opening)
    combined_warnings = [
        *understanding["warnings"],
        *semantic_warnings,
        *topology_diagnostics["topologyWarnings"],
        *room_warnings,
        *opening_warnings,
        *entrance_warnings,
    ]
    image_height, image_width = image.shape[:2]
    bounds_width_pixels = (bounds["right"] - bounds["left"]) / 1000 * image_width
    bounds_height_pixels = (bounds["bottom"] - bounds["top"]) / 1000 * image_height
    meters_per_pixel = ((width / bounds_width_pixels) + (depth / bounds_height_pixels)) / 2
    public_walls = [{
        key: value
        for key, value in wall.items()
        if key not in {"sourceIds", "sourceKind"}
    } for wall in walls]

    return {
        "schemaVersion": "1.0",
        "width": width,
        "depth": depth,
        "scaleMetersPerPixel": round(meters_per_pixel, 8),
        "scaleEstimated": float(understanding["scaleConfidence"]) < 0.9,
        "walls": public_walls,
        "openings": openings,
        "rooms": rooms,
        "entrance": {"position": entrance_position, "direction": direction},
        "confidence": round(confidence, 4),
        "diagnostics": {
            "provider": "openai-vision-geometry-v2",
            "model": model_id,
            "planType": understanding["planType"],
            "orientation": understanding["orientation"],
            "sourceBoundsNormalized": bounds,
            "aiConfidence": round(confidence, 4),
            "scaleConfidence": round(float(understanding["scaleConfidence"]), 4),
            "wallCandidateCount": len(understanding["walls"]),
            "wallCount": len(walls),
            "roomCount": len(rooms),
            **topology_diagnostics,
            "scaleSource": "gpt-estimated-from-visual-cues",
            "entranceSource": "gpt-vision" if not entrance_warnings else "gpt-vision+geometry-fallback",
            "entranceWarnings": entrance_warnings,
            "semanticWarnings": semantic_warnings,
            "roomWarnings": room_warnings,
            "openingWarnings": opening_warnings,
            "ignoredElements": understanding["ignoredElements"],
            "uncertainRegions": understanding["uncertainRegions"],
            "warnings": combined_warnings,
        },
    }


def normalized_to_plan(
    point: dict[str, Any],
    bounds: dict[str, Any],
    width: float,
    depth: float,
) -> list[float]:
    x = (float(point["x"]) - bounds["left"]) / (bounds["right"] - bounds["left"])
    y = (float(point["y"]) - bounds["top"]) / (bounds["bottom"] - bounds["top"])
    return [round(min(1.0, max(0.0, x)) * width, 4), round(min(1.0, max(0.0, y)) * depth, 4)]


def refine_wall_axis(
    image: np.ndarray,
    start: dict[str, Any],
    end: dict[str, Any],
) -> tuple[dict[str, int], dict[str, int]]:
    image_height, image_width = image.shape[:2]
    first = {"x": int(start["x"]), "y": int(start["y"])}
    second = {"x": int(end["x"]), "y": int(end["y"])}
    dx = abs(second["x"] - first["x"])
    dy = abs(second["y"] - first["y"])
    if dx < dy * 4 and dy < dx * 4:
        return first, second

    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    dark = gray < 95
    radius = max(6, min(22, min(image_width, image_height) // 55))
    if dx >= dy * 4:
        x1 = round(min(first["x"], second["x"]) / 1000 * (image_width - 1))
        x2 = round(max(first["x"], second["x"]) / 1000 * (image_width - 1))
        center = round((first["y"] + second["y"]) / 2000 * (image_height - 1))
        best, best_score = center, 0.0
        for candidate in range(max(0, center - radius), min(image_height, center + radius + 1)):
            score = float(np.mean(dark[max(0, candidate - 2):candidate + 3, x1:x2 + 1]))
            if score > best_score:
                best, best_score = candidate, score
        if best_score >= 0.18:
            normalized = round(best / max(1, image_height - 1) * 1000)
            first["y"] = normalized
            second["y"] = normalized
    else:
        y1 = round(min(first["y"], second["y"]) / 1000 * (image_height - 1))
        y2 = round(max(first["y"], second["y"]) / 1000 * (image_height - 1))
        center = round((first["x"] + second["x"]) / 2000 * (image_width - 1))
        best, best_score = center, 0.0
        for candidate in range(max(0, center - radius), min(image_width, center + radius + 1)):
            score = float(np.mean(dark[y1:y2 + 1, max(0, candidate - 2):candidate + 3]))
            if score > best_score:
                best, best_score = candidate, score
        if best_score >= 0.18:
            normalized = round(best / max(1, image_width - 1) * 1000)
            first["x"] = normalized
            second["x"] = normalized
    return first, second


def unique_id(raw: str, prefix: str, index: int, seen: set[str]) -> str:
    cleaned = "-".join(part for part in raw.strip().lower().replace("_", "-").split("-") if part)
    candidate = cleaned or f"{prefix}-{index + 1}"
    if candidate in seen:
        candidate = f"{candidate}-{index + 1}"
    seen.add(candidate)
    return candidate


def snap_wall_endpoints(
    walls: list[dict[str, Any]],
    tolerance: float = 0.24,
) -> list[dict[str, Any]]:
    """Snap nearby GPT endpoints into stable junctions without inventing new walls."""
    endpoints = [(wall, key) for wall in walls for key in ("start", "end")]
    visited: set[tuple[int, str]] = set()
    for wall, key in endpoints:
        marker = (id(wall), key)
        if marker in visited:
            continue
        cluster = [(wall, key)]
        visited.add(marker)
        changed = True
        while changed:
            changed = False
            for candidate_wall, candidate_key in endpoints:
                candidate_marker = (id(candidate_wall), candidate_key)
                if candidate_marker in visited:
                    continue
                if any(
                    point_distance(candidate_wall[candidate_key], member_wall[member_key]) <= tolerance
                    for member_wall, member_key in cluster
                ):
                    cluster.append((candidate_wall, candidate_key))
                    visited.add(candidate_marker)
                    changed = True
        if len(cluster) > 1:
            anchor = [
                round(sum(member_wall[member_key][axis] for member_wall, member_key in cluster) / len(cluster), 4)
                for axis in (0, 1)
            ]
            for member_wall, member_key in cluster:
                member_wall[member_key] = anchor.copy()
    return walls


def deduplicate_walls(walls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for wall in walls:
        duplicate = None
        for existing in result:
            direct = point_distance(wall["start"], existing["start"]) + point_distance(wall["end"], existing["end"])
            reverse = point_distance(wall["start"], existing["end"]) + point_distance(wall["end"], existing["start"])
            if min(direct, reverse) < 0.24:
                duplicate = existing
                break
        if duplicate is None:
            result.append(wall)
        else:
            duplicate["sourceIds"].extend(wall["sourceIds"])
            if wall["sourceKind"] == "exterior":
                duplicate["sourceKind"] = "exterior"
    return result


def validate_wall_topology(
    walls: list[dict[str, Any]],
    width: float,
    depth: float,
    confidence: float,
) -> dict[str, Any]:
    if len(walls) < 2:
        raise RecognitionError("low_geometry_confidence", "墙体数量不足，无法形成最小场景结构", confidence)
    warnings: list[str] = []
    if len(walls) < 4:
        warnings.append("可信墙体数量偏少，建议用户确认")
    if len(walls) > 64:
        warnings.append("墙体数量偏多，可能仍包含家具或纹理")
    total_length = sum(point_distance(wall["start"], wall["end"]) for wall in walls)
    if total_length / (width * depth) > 1.65:
        warnings.append("墙体密度偏高，建议用户检查家具纹理是否被误识别")

    isolated_wall_count = 0
    for wall in walls:
        if point_distance(wall["start"], wall["end"]) < 0.35:
            warnings.append("存在长度偏短的墙体")
        if not any(
            other is not wall
            and min(
                point_to_segment_distance(wall["start"], other["start"], other["end"])[0],
                point_to_segment_distance(wall["end"], other["start"], other["end"])[0],
                point_to_segment_distance(other["start"], wall["start"], wall["end"])[0],
                point_to_segment_distance(other["end"], wall["start"], wall["end"])[0],
            ) <= 0.34
            for other in walls
        ):
            isolated_wall_count += 1
    if isolated_wall_count:
        warnings.append(f"检测到 {isolated_wall_count} 面孤立墙体，已保留供用户确认")

    overlapping_wall_count = 0
    for index, first in enumerate(walls):
        for second in walls[index + 1:]:
            if collinear_overlap_ratio(first, second) > 0.62:
                overlapping_wall_count += 1
    if overlapping_wall_count:
        warnings.append(f"检测到 {overlapping_wall_count} 组重叠墙体，已保留供用户确认")

    exterior = [wall for wall in walls if wall["sourceKind"] == "exterior"]
    if len(exterior) < 3:
        warnings.append("GPT 标注的外墙数量偏少，采用语义准入结果继续")

    exterior_length = sum(point_distance(wall["start"], wall["end"]) for wall in exterior)
    perimeter_coverage = exterior_length / (2 * (width + depth)) if exterior else 0.0
    if perimeter_coverage < 0.72:
        warnings.append("住宅外轮廓覆盖率偏低，可能存在门洞、阳台或漏墙")

    tolerance = max(0.34, min(width, depth) * 0.035)
    adjacency: list[set[int]] = [set() for _ in exterior]
    for first_index, first in enumerate(exterior):
        for second_index in range(first_index + 1, len(exterior)):
            second = exterior[second_index]
            if wall_segments_touch(first, second, tolerance):
                adjacency[first_index].add(second_index)
                adjacency[second_index].add(first_index)

    components: list[set[int]] = []
    remaining = set(range(len(exterior)))
    while remaining:
        root = remaining.pop()
        component = {root}
        frontier = [root]
        while frontier:
            current = frontier.pop()
            for neighbor in adjacency[current]:
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    component.add(neighbor)
                    frontier.append(neighbor)
        components.append(component)
    component_lengths = [
        sum(point_distance(exterior[index]["start"], exterior[index]["end"]) for index in component)
        for component in components
    ]
    connected_ratio = max(component_lengths) / exterior_length if exterior_length > 0 else 0.0
    if connected_ratio < 0.78:
        warnings.append("住宅外轮廓包含互不相连的墙段，建议用户确认")

    open_endpoints = []
    for wall in exterior:
        for key in ("start", "end"):
            if not any(
                other is not wall
                and point_to_segment_distance(wall[key], other["start"], other["end"])[0] <= tolerance
                for other in exterior
            ):
                open_endpoints.append(wall[key])
    allowed_open_endpoints = max(2, min(4, ceil(len(exterior) * 0.2)))
    if len(open_endpoints) > allowed_open_endpoints:
        warnings.append("住宅外轮廓断点较多，可能来自入口、窗洞、花池或阳台")

    return {
        "admissionDecision": "gpt-semantic",
        "topologyWarnings": warnings,
        "exteriorPerimeterCoverage": round(perimeter_coverage, 4),
        "exteriorConnectedRatio": round(connected_ratio, 4),
        "exteriorOpenEndpointCount": len(open_endpoints),
        "exteriorOpenEndpointAllowance": allowed_open_endpoints,
    }


def wall_segments_touch(first: dict[str, Any], second: dict[str, Any], tolerance: float) -> bool:
    return min(
        point_to_segment_distance(first["start"], second["start"], second["end"])[0],
        point_to_segment_distance(first["end"], second["start"], second["end"])[0],
        point_to_segment_distance(second["start"], first["start"], first["end"])[0],
        point_to_segment_distance(second["end"], first["start"], first["end"])[0],
    ) <= tolerance


def validate_openings(
    openings: list[dict[str, Any]],
    walls: list[dict[str, Any]],
) -> list[str]:
    warnings: list[str] = []
    wall_by_id = {wall["id"]: wall for wall in walls}
    intervals_by_wall: dict[str, list[tuple[float, float]]] = {}
    for opening in openings:
        wall = wall_by_id.get(opening["wallId"])
        if wall is None:
            warnings.append(f'门窗“{opening["id"]}”未依附于可信墙体')
            continue
        wall_length = point_distance(wall["start"], wall["end"])
        if opening["width"] > wall_length + 0.12:
            opening["width"] = round(max(0.2, wall_length * 0.9), 3)
            warnings.append(f'门窗“{opening["id"]}”宽度超过墙体，已自动收窄')
        center = opening["offset"] * wall_length
        interval = (max(0.0, center - opening["width"] / 2), min(wall_length, center + opening["width"] / 2))
        for existing in intervals_by_wall.setdefault(opening["wallId"], []):
            if min(interval[1], existing[1]) - max(interval[0], existing[0]) > 0.12:
                warnings.append(f'门窗“{opening["id"]}”与同墙门窗重叠，已保留供用户确认')
        intervals_by_wall[opening["wallId"]].append(interval)
    return warnings


def validate_rooms(
    rooms: list[dict[str, Any]],
    walls: list[dict[str, Any]],
    width: float,
    depth: float,
 ) -> list[str]:
    warnings: list[str] = []
    total_area = 0.0
    wall_tolerance = max(0.58, max(wall["thickness"] for wall in walls) * 2.5)
    for room in rooms:
        polygon = room["polygon"]
        if len(polygon) < 3 or polygon_self_intersects(polygon):
            warnings.append(f'房间“{room["label"]}”边界需要用户确认')
            continue
        area = polygon_area(polygon)
        total_area += area
        nearby_vertices = sum(
            any(point_to_segment_distance(point, wall["start"], wall["end"])[0] <= wall_tolerance for wall in walls)
            for point in polygon
        )
        if nearby_vertices < min(2, len(polygon)):
            warnings.append(f'房间“{room["label"]}”未完全与墙体拓扑对齐')
    if total_area > width * depth * 1.35:
        warnings.append("部分房间区域可能重叠或超出住宅范围")
    return warnings


def repair_and_snap_entrance(
    position: list[float],
    direction: list[float],
    wall_id: str,
    walls: list[dict[str, Any]],
    openings: list[dict[str, Any]],
) -> tuple[list[float], list[float], dict[str, Any] | None, list[str]]:
    warnings: list[str] = []
    wall = next((candidate for candidate in walls if candidate["id"] == wall_id), None)
    if wall is None:
        wall = min(walls, key=lambda candidate: point_to_segment_distance(position, candidate["start"], candidate["end"])[0])
        wall_id = wall["id"]
        warnings.append("入户墙体已回退到最近可用墙体")
    distance, projection, entrance_offset = point_to_segment_distance(position, wall["start"], wall["end"])
    if distance > max(0.75, wall["thickness"] * 4):
        warnings.append("入户位置距离关联墙体较远，已自动吸附")
    wall_length = point_distance(wall["start"], wall["end"])
    wall_direction = [
        (wall["end"][0] - wall["start"][0]) / wall_length,
        (wall["end"][1] - wall["start"][1]) / wall_length,
    ]
    direction_length = hypot(direction[0], direction[1])
    if direction_length < 0.1 or abs(direction[0] * wall_direction[0] + direction[1] * wall_direction[1]) > 0.72:
        normals = [[-wall_direction[1], wall_direction[0]], [wall_direction[1], -wall_direction[0]]]
        direction = max(normals, key=lambda normal: normal[0] * direction[0] + normal[1] * direction[1])
        direction = [round(direction[0], 4), round(direction[1], 4)]
        warnings.append("入户方向已校正为穿过墙体的法线方向")
    entrance_doors = [opening for opening in openings if opening["wallId"] == wall_id and opening["kind"] == "door"]
    door = min(entrance_doors, key=lambda opening: abs(opening["offset"] - entrance_offset)) if entrance_doors else None
    allowed_offset_error = (
        min(0.3, max(0.1, (door["width"] / 2 + 0.35) / wall_length))
        if door is not None else 0.0
    )
    inferred_opening = None
    if door is None or abs(door["offset"] - entrance_offset) > allowed_offset_error:
        existing_ids = {opening["id"] for opening in openings}
        opening_id = "inferred-entrance-door"
        suffix = 2
        while opening_id in existing_ids:
            opening_id = f"inferred-entrance-door-{suffix}"
            suffix += 1
        inferred_opening = {
            "id": opening_id,
            "kind": "door",
            "wallId": wall_id,
            "offset": round(entrance_offset, 4),
            "width": round(min(0.9, max(0.35, wall_length * 0.6)), 3),
            "height": 2.1,
            "sillHeight": 0.0,
        }
        door = inferred_opening
        warnings.append("入户位置缺少匹配门洞，系统已补充标准入户门")
    snapped_position = [
        round(wall["start"][0] + (wall["end"][0] - wall["start"][0]) * door["offset"], 4),
        round(wall["start"][1] + (wall["end"][1] - wall["start"][1]) * door["offset"], 4),
    ]
    if point_distance(snapped_position, projection) > 0.05:
        warnings.append("入户位置已对齐到最近门洞中心")
    return snapped_position, direction, inferred_opening, warnings


def clean_polygon(points: list[list[float]]) -> list[list[float]]:
    result: list[list[float]] = []
    for point in points:
        if not result or point_distance(point, result[-1]) > 0.02:
            result.append(point)
    if len(result) > 2 and point_distance(result[0], result[-1]) <= 0.02:
        result.pop()
    return result


def point_to_segment_distance(
    point: list[float],
    start: list[float],
    end: list[float],
) -> tuple[float, list[float], float]:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length_squared = dx * dx + dy * dy
    if length_squared <= 1e-10:
        return point_distance(point, start), start.copy(), 0.0
    offset = min(1.0, max(0.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length_squared))
    projection = [start[0] + dx * offset, start[1] + dy * offset]
    return point_distance(point, projection), projection, offset


def collinear_overlap_ratio(first: dict[str, Any], second: dict[str, Any]) -> float:
    first_length = point_distance(first["start"], first["end"])
    second_length = point_distance(second["start"], second["end"])
    if first_length <= 1e-8 or second_length <= 1e-8:
        return 0.0
    distance_a = point_to_segment_distance(second["start"], first["start"], first["end"])[0]
    distance_b = point_to_segment_distance(second["end"], first["start"], first["end"])[0]
    if max(distance_a, distance_b) > max(0.11, min(first["thickness"], second["thickness"])):
        return 0.0
    axis = 0 if abs(first["end"][0] - first["start"][0]) >= abs(first["end"][1] - first["start"][1]) else 1
    first_interval = sorted((first["start"][axis], first["end"][axis]))
    second_interval = sorted((second["start"][axis], second["end"][axis]))
    overlap = max(0.0, min(first_interval[1], second_interval[1]) - max(first_interval[0], second_interval[0]))
    return overlap / min(first_length, second_length)


def polygon_self_intersects(points: list[list[float]]) -> bool:
    count = len(points)
    for first_index in range(count):
        first_start = points[first_index]
        first_end = points[(first_index + 1) % count]
        if point_distance(first_start, first_end) <= 0.02:
            return True
        for second_index in range(first_index + 1, count):
            if second_index in {first_index, (first_index + 1) % count}:
                continue
            if first_index == 0 and second_index == count - 1:
                continue
            second_start = points[second_index]
            second_end = points[(second_index + 1) % count]
            if segments_properly_intersect(first_start, first_end, second_start, second_end):
                return True
    return False


def segments_properly_intersect(
    first_start: list[float],
    first_end: list[float],
    second_start: list[float],
    second_end: list[float],
) -> bool:
    def cross(origin: list[float], first: list[float], second: list[float]) -> float:
        return (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0])

    first_cross = cross(first_start, first_end, second_start)
    second_cross = cross(first_start, first_end, second_end)
    third_cross = cross(second_start, second_end, first_start)
    fourth_cross = cross(second_start, second_end, first_end)
    return first_cross * second_cross < -1e-8 and third_cross * fourth_cross < -1e-8


def point_distance(first: list[float], second: list[float]) -> float:
    return hypot(first[0] - second[0], first[1] - second[1])


def polygon_area(points: list[list[float]]) -> float:
    return abs(sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    )) / 2


def normalize_direction(direction: dict[str, Any]) -> list[float]:
    x = float(direction["x"])
    y = float(direction["y"])
    length = hypot(x, y)
    if length < 0.1:
        raise RecognitionError("low_geometry_confidence", "未识别到可信的入户方向")
    return [round(x / length, 4), round(y / length, 4)]
