from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image, UnidentifiedImageError

MAX_FILE_BYTES = 30 * 1024 * 1024
MAX_IMAGE_PIXELS = 60_000_000
MIN_WIDTH = 640
MIN_HEIGHT = 320
DEFAULT_MODEL = "gpt-5.5"


class DecorationAnalysisError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class DecodedReferenceImage:
    rgb: np.ndarray
    media_type: str
    checksum_sha256: str
    width: int
    height: int


OBJECT_CANDIDATE_SCHEMA = {
    "type": "object",
    "properties": {
        "objectId": {"type": "string"},
        "label": {"type": "string"},
        "category": {
            "type": "string",
            "enum": [
                "seating", "table", "storage", "bed", "lighting", "appliance",
                "textile", "plant", "art", "decoration", "other",
            ],
        },
        "importance": {"type": "string", "enum": ["critical", "supporting", "background"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "boundingBox": {
            "type": "object",
            "properties": {
                "x": {"type": "number", "minimum": 0, "maximum": 1},
                "y": {"type": "number", "minimum": 0, "maximum": 1},
                "width": {"type": "number", "exclusiveMinimum": 0, "maximum": 1},
                "height": {"type": "number", "exclusiveMinimum": 0, "maximum": 1},
            },
            "required": ["x", "y", "width", "height"],
            "additionalProperties": False,
        },
        "description": {"type": "string"},
        "materialHints": {"type": "array", "maxItems": 12, "items": {"type": "string"}},
        "colorHints": {"type": "array", "maxItems": 8, "items": {"type": "string"}},
        "estimatedSizeMeters": {
            "type": "object",
            "properties": {
                "width": {"type": ["number", "null"], "exclusiveMinimum": 0},
                "height": {"type": ["number", "null"], "exclusiveMinimum": 0},
                "depth": {"type": ["number", "null"], "exclusiveMinimum": 0},
            },
            "required": ["width", "height", "depth"],
            "additionalProperties": False,
        },
        "placement": {
            "type": "object",
            "properties": {
                "support": {"type": "string", "enum": ["floor", "wall", "ceiling", "surface", "unknown"]},
                "roomZone": {"type": "string"},
                "notes": {"type": "string"},
            },
            "required": ["support", "roomZone", "notes"],
            "additionalProperties": False,
        },
        "requiresLux3d": {"type": "boolean"},
        "photorealisticRequired": {"type": "boolean", "const": True},
    },
    "required": [
        "objectId", "label", "category", "importance", "confidence", "boundingBox",
        "description", "materialHints", "colorHints", "estimatedSizeMeters", "placement",
        "requiresLux3d", "photorealisticRequired",
    ],
    "additionalProperties": False,
}

DECORATION_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "style": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "summary": {"type": "string"},
                "realism": {
                    "type": "string",
                    "enum": ["photorealistic", "not-photorealistic", "uncertain"],
                },
                "palette": {"type": "array", "maxItems": 12, "items": {"type": "string"}},
                "materials": {"type": "array", "maxItems": 16, "items": {"type": "string"}},
                "lighting": {"type": "string"},
                "negativePrompts": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 16,
                    "items": {"type": "string"},
                },
            },
            "required": ["name", "summary", "realism", "palette", "materials", "lighting", "negativePrompts"],
            "additionalProperties": False,
        },
        "layoutSummary": {"type": "string"},
        "objectCandidates": {"type": "array", "maxItems": 3, "items": OBJECT_CANDIDATE_SCHEMA},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "warnings": {"type": "array", "maxItems": 20, "items": {"type": "string"}},
    },
    "required": ["style", "layoutSummary", "objectCandidates", "confidence", "warnings"],
    "additionalProperties": False,
}

ANALYSIS_INSTRUCTIONS = """
你是写实住宅装修风格分析器。输入可能是一张用户喜欢的普通室内参考图，也可能只有文字需求。
只描述图中可见证据，不虚构被遮挡的家具、品牌、尺寸或材质。

硬性要求：
- 判断参考图是否为照片级写实风格。照片、可信建筑可视化可标记 photorealistic；卡通、动漫、手绘、低多边形标记 not-photorealistic。
- 首要任务是提取整体装修风格、PBR 材质提示、色板、照明和空间布局关系；不要把参考图做成家具清单。
- objectCandidates 只能返回 0–3 个真正决定风格、值得在最终第一人称场景中独立选中的重点物体。普通边几、摆件、植物、电视、窗帘及重复座椅默认不要列出。
- 只有视觉辨识度极高的焦点物体，或用户文字明确点名要复刻/单独建模的物体，才标记 critical 与 requiresLux3d=true。supporting/background 一律 requiresLux3d=false。
- 有参考图时，boundingBox 使用整张图片归一化坐标，左上角为 (0,0)，宽高均在 0..1。
- 只有文字时不得声称看见了物体；候选物体来自用户需求，boundingBox 固定为 {x:0,y:0,width:1,height:1}，并在 warnings 中注明需要用户确认或补充参考图。
- 尺寸无法可靠估算时返回 null，禁止假装精确。
- photorealisticRequired 永远为 true。
- negativePrompts 必须包含 cartoon、anime、hand-painted、low-poly 等反向风格限制。
""".strip()


def validate_and_decode_reference_image(
    data: bytes,
    expected_media_type: str,
    expected_size: int,
) -> DecodedReferenceImage:
    if len(data) != expected_size:
        raise DecorationAnalysisError("unsupported_file", "文件大小与上传授权不一致")
    if len(data) > MAX_FILE_BYTES:
        raise DecorationAnalysisError("file_too_large", "装修参考图不能超过 30 MB")
    detected = detect_media_type(data)
    if detected is None or detected != expected_media_type:
        raise DecorationAnalysisError("unsupported_file", "文件签名与声明的图片类型不一致")
    try:
        Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
        with Image.open(BytesIO(data)) as probe:
            probe.verify()
        with Image.open(BytesIO(data)) as source:
            source.load()
            image = source.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise DecorationAnalysisError("image_decode_failed", "装修参考图无法安全解码") from error
    if image.width < MIN_WIDTH or image.height < MIN_HEIGHT:
        raise DecorationAnalysisError("reference_resolution_too_low", "装修参考图分辨率过低")
    return DecodedReferenceImage(
        rgb=np.asarray(image),
        media_type=detected,
        checksum_sha256=sha256(data).hexdigest(),
        width=image.width,
        height=image.height,
    )


def analyze_decoration_reference(
    image: np.ndarray | None,
    *,
    analysis_id: str,
    session_id: str,
    source_asset_id: str | None,
    brief: str = "",
    client: Any | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    model_id = model or os.getenv("DECORATION_VISION_MODEL", DEFAULT_MODEL)
    if client is None:
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise DecorationAnalysisError(
                "decoration_analysis_ai_unavailable",
                "装修方案理解服务尚未配置 OPENAI_API_KEY",
            )
        try:
            from openai import OpenAI

            client = OpenAI(api_key=api_key, timeout=float(os.getenv("OPENAI_TIMEOUT_SECONDS", "75")))
        except Exception as error:
            raise DecorationAnalysisError(
                "decoration_analysis_ai_unavailable",
                "装修方案理解服务初始化失败",
                retryable=True,
            ) from error

    try:
        source_kind = "image" if image is not None else "text"
        content: list[dict[str, Any]] = [{
            "type": "input_text",
            "text": (
                f"分析这张普通装修参考图。用户补充要求：{brief or '无'}"
                if image is not None
                else f"没有参考图。请仅基于用户文字需求形成写实装修方案：{brief}"
            ),
        }]
        if image is not None:
            content.append({"type": "input_image", "image_url": image_data_url(image), "detail": "high"})
        response = client.responses.create(
            model=model_id,
            store=False,
            reasoning={"effort": os.getenv("DECORATION_REASONING_EFFORT", "medium")},
            max_output_tokens=10_000,
            instructions=ANALYSIS_INSTRUCTIONS,
            input=[{
                "role": "user",
                "content": content,
            }],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "photorealistic_decoration_analysis",
                    "strict": True,
                    "schema": DECORATION_ANALYSIS_SCHEMA,
                },
            },
        )
        output_text = getattr(response, "output_text", "")
        if not output_text:
            raise ValueError("OpenAI response did not contain output_text")
        raw = json.loads(output_text)
    except DecorationAnalysisError:
        raise
    except Exception as error:
        raise DecorationAnalysisError(
            "decoration_analysis_ai_failed",
            "装修方案理解暂时失败，请稍后重试",
            retryable=True,
        ) from error

    candidates = normalize_candidates(raw["objectCandidates"])
    warnings = [str(item).strip() for item in raw["warnings"] if str(item).strip()]
    if raw["style"]["realism"] != "photorealistic":
        warnings.append("参考图未通过写实风格质量门，不能直接进入装修生成")
    negative_prompts = unique_strings([
        *raw["style"]["negativePrompts"],
        "cartoon", "anime", "hand-painted", "low-poly", "toy-like plastic materials",
    ], 16)
    return {
        "schemaVersion": "1.0",
        "analysisId": analysis_id,
        "sessionId": session_id,
        "sourceKind": "image" if image is not None else "text",
        **({"sourceAssetId": source_asset_id} if source_asset_id else {}),
        "sourceBrief": brief,
        "style": {
            **raw["style"],
            "palette": unique_strings(raw["style"]["palette"], 12),
            "materials": unique_strings(raw["style"]["materials"], 16),
            "negativePrompts": negative_prompts,
        },
        "layoutSummary": str(raw["layoutSummary"]).strip(),
        "objectCandidates": candidates,
        "confidence": round(float(raw["confidence"]), 4),
        "warnings": unique_strings(warnings, 20),
        "diagnostics": {
            "provider": "openai-responses",
            "model": model_id,
            "candidateCount": len(candidates),
            "lux3dCandidateCount": sum(candidate["requiresLux3d"] for candidate in candidates),
            "photorealismGate": raw["style"]["realism"],
            "sourceKind": "image" if image is not None else "text",
        },
    }


# Transitional aliases for callers that still use the Iteration 3 step-4 names.
DecodedPanorama = DecodedReferenceImage
validate_and_decode_panorama = validate_and_decode_reference_image
analyze_decoration_panorama = analyze_decoration_reference


def normalize_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    ranked = sorted(
        candidates,
        key=lambda item: {"critical": 0, "supporting": 1, "background": 2}.get(item["importance"], 3),
    )[:3]
    for index, candidate in enumerate(ranked):
        raw_id = re.sub(r"[^a-z0-9-]+", "-", str(candidate["objectId"]).lower()).strip("-")
        object_id = raw_id or f"object-{index + 1}"
        if object_id in seen:
            object_id = f"{object_id}-{index + 1}"
        seen.add(object_id)
        box = candidate["boundingBox"]
        x = clamp(float(box["x"]), 0.0, 0.999)
        y = clamp(float(box["y"]), 0.0, 0.999)
        width = clamp(float(box["width"]), 0.001, 1.0 - x)
        height = clamp(float(box["height"]), 0.001, 1.0 - y)
        importance = candidate["importance"]
        result.append({
            **candidate,
            "objectId": object_id,
            "confidence": round(clamp(float(candidate["confidence"]), 0.0, 1.0), 4),
            "boundingBox": {"x": x, "y": y, "width": width, "height": height},
            "materialHints": unique_strings(candidate["materialHints"], 12),
            "colorHints": unique_strings(candidate["colorHints"], 8),
            "requiresLux3d": importance == "critical",
            "photorealisticRequired": True,
        })
    return result


def image_data_url(image: np.ndarray) -> str:
    buffer = BytesIO()
    Image.fromarray(image).save(buffer, format="JPEG", quality=90, optimize=True)
    payload = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{payload}"


def detect_media_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def unique_strings(values: list[Any], limit: int) -> list[str]:
    result: list[str] = []
    for value in values:
        normalized = str(value).strip()
        if normalized and normalized.lower() not in {item.lower() for item in result}:
            result.append(normalized)
        if len(result) >= limit:
            break
    return result


def clamp(value: float, minimum: float, maximum: float) -> float:
    return round(min(maximum, max(minimum, value)), 5)
