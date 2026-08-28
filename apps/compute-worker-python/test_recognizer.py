from io import BytesIO
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

from recognizer import RecognitionError, recognize_floor_plan, validate_and_decode


def point(x: int, y: int) -> dict[str, int]:
    return {"x": x, "y": y}


def understanding() -> dict:
    walls = [
        ("exterior-north", point(120, 80), point(880, 80), "exterior"),
        ("exterior-east", point(880, 80), point(880, 920), "exterior"),
        ("exterior-south", point(880, 920), point(120, 920), "exterior"),
        ("exterior-west", point(120, 920), point(120, 80), "exterior"),
        ("partition-bedroom", point(430, 80), point(430, 920), "interior"),
        ("partition-bathroom", point(120, 480), point(430, 480), "interior"),
    ]
    return {
        "planType": "decorated_floor_plan",
        "orientation": "portrait",
        "shouldReject": False,
        "rejectionReason": "",
        "bounds": {"left": 100, "top": 50, "right": 900, "bottom": 950},
        "estimatedWidthMeters": 8.0,
        "estimatedDepthMeters": 12.0,
        "scaleConfidence": 0.48,
        "walls": [{
            "id": wall_id,
            "start": start,
            "end": end,
            "thicknessMeters": 0.22 if kind == "exterior" else 0.14,
            "heightMeters": 2.8,
            "kind": kind,
            "confidence": 0.93,
        } for wall_id, start, end, kind in walls],
        "openings": [{
            "id": "entrance-door",
            "kind": "door",
            "wallId": "exterior-east",
            "centerOffset": 0.48,
            "widthMeters": 0.9,
            "heightMeters": 2.1,
            "sillHeightMeters": 0,
            "confidence": 0.94,
        }],
        "rooms": [
            {
                "id": "master-bedroom",
                "kind": "bedroom",
                "label": "主卧",
                "polygon": [point(130, 500), point(420, 500), point(420, 900), point(130, 900)],
                "confidence": 0.95,
            },
            {
                "id": "living-room",
                "kind": "living-room",
                "label": "客厅",
                "polygon": [point(450, 470), point(860, 470), point(860, 900), point(450, 900)],
                "confidence": 0.94,
            },
        ],
        "entrance": {
            "position": point(880, 480),
            "direction": {"x": -1, "y": 0},
            "wallId": "exterior-east",
            "confidence": 0.94,
        },
        "confidence": 0.91,
        "ignoredElements": ["家具", "地砖纹理", "文字"],
        "uncertainRegions": [],
        "warnings": ["图片未提供标注尺寸，比例为估算值"],
    }


def approved_review() -> dict:
    return {
        "approved": True,
        "confidence": 0.88,
        "summary": "墙体、房间关系和右侧入户位置与原图一致",
        "criticalIssues": [],
    }


class FakeResponses:
    def __init__(self, *payloads: dict) -> None:
        self.payloads = list(payloads)
        self.requests = []

    def create(self, **kwargs):
        self.requests.append(kwargs)
        return SimpleNamespace(output_text=json.dumps(self.payloads.pop(0), ensure_ascii=False))


class FakeClient:
    def __init__(self, *payloads: dict) -> None:
        self.responses = FakeResponses(*payloads)


class RecognizerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.image = np.full((1024, 830, 3), 242, dtype=np.uint8)
        cv2.rectangle(self.image, (100, 80), (730, 940), (20, 20, 20), 16)

    def test_uses_gpt_semantics_then_builds_validated_geometry(self) -> None:
        client = FakeClient(understanding(), approved_review())
        progress = []
        plan = recognize_floor_plan(
            self.image,
            client=client,
            model="vision-test-model",
            progress_callback=lambda stage, value, message: progress.append((stage, value, message)),
        )

        self.assertEqual(plan["diagnostics"]["provider"], "openai-vision-geometry-v2")
        self.assertEqual(plan["diagnostics"]["model"], "vision-test-model")
        self.assertEqual(len(plan["walls"]), 6)
        self.assertEqual(plan["entrance"]["direction"], [-1.0, 0.0])
        self.assertEqual([room["label"] for room in plan["rooms"]], ["主卧", "客厅"])
        self.assertFalse(any(wall["id"] == "wall-south" for wall in plan["walls"]))
        self.assertEqual(plan["diagnostics"]["reviewConfidence"], 0.88)
        self.assertEqual(len(client.responses.requests), 2)
        self.assertFalse(client.responses.requests[0]["store"])
        self.assertEqual(client.responses.requests[0]["text"]["format"]["type"], "json_schema")
        self.assertTrue(client.responses.requests[0]["input"][0]["content"][1]["image_url"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(len(client.responses.requests[1]["input"][0]["content"]), 3)
        self.assertEqual([item[0] for item in progress], ["geometry-refining", "gpt-reviewing"])
        self.assertEqual([item[1] for item in progress], [0.58, 0.72])

    def test_rejects_when_gpt_cannot_form_a_trustworthy_plan(self) -> None:
        payload = understanding()
        payload["shouldReject"] = True
        payload["rejectionReason"] = "图片不是完整住宅户型图"
        with self.assertRaises(RecognitionError) as context:
            recognize_floor_plan(self.image, client=FakeClient(payload))
        self.assertEqual(context.exception.code, "low_plan_confidence")

    def test_second_gpt_review_marks_confirmation_instead_of_rejecting_normal_plan(self) -> None:
        review = approved_review()
        review["approved"] = False
        review["confidence"] = 0.93
        review["summary"] = "检测到家具边缘被错误拉伸为墙体"
        review["criticalIssues"] = ["客厅家具被识别为墙"]
        plan = recognize_floor_plan(self.image, client=FakeClient(understanding(), review))
        self.assertFalse(plan["diagnostics"]["reviewApproved"])
        self.assertTrue(plan["diagnostics"]["requiresUserConfirmation"])
        self.assertIn("客厅家具被识别为墙", plan["diagnostics"]["reviewCriticalIssues"])

    def test_open_exterior_wall_loop_becomes_warning_after_gpt_accepts_plan(self) -> None:
        payload = understanding()
        payload["walls"] = [wall for wall in payload["walls"] if wall["id"] != "exterior-west"]
        plan = recognize_floor_plan(self.image, client=FakeClient(payload, approved_review()))
        self.assertEqual(plan["diagnostics"]["admissionDecision"], "gpt-semantic")
        self.assertTrue(any("外轮廓" in warning for warning in plan["diagnostics"]["topologyWarnings"]))

    def test_allows_two_exterior_endpoints_for_a_real_entrance_gap(self) -> None:
        payload = understanding()
        payload["walls"] = [wall for wall in payload["walls"] if wall["id"] != "exterior-east"]
        payload["walls"].extend([
            {
                "id": "exterior-east-upper",
                "start": point(880, 80),
                "end": point(880, 430),
                "thicknessMeters": 0.22,
                "heightMeters": 2.8,
                "kind": "exterior",
                "confidence": 0.93,
            },
            {
                "id": "exterior-east-lower",
                "start": point(880, 530),
                "end": point(880, 920),
                "thicknessMeters": 0.22,
                "heightMeters": 2.8,
                "kind": "exterior",
                "confidence": 0.93,
            },
        ])
        payload["openings"][0]["wallId"] = "exterior-east-upper"
        payload["openings"][0]["centerOffset"] = 1.0
        payload["entrance"]["wallId"] = "exterior-east-upper"
        payload["entrance"]["position"] = point(880, 430)
        plan = recognize_floor_plan(self.image, client=FakeClient(payload, approved_review()))
        self.assertEqual(plan["diagnostics"]["exteriorOpenEndpointCount"], 2)
        self.assertGreater(plan["diagnostics"]["exteriorPerimeterCoverage"], 0.72)

    def test_infers_entrance_door_when_gpt_does_not_link_an_opening(self) -> None:
        payload = understanding()
        payload["openings"] = []
        plan = recognize_floor_plan(self.image, client=FakeClient(payload, approved_review()))
        self.assertTrue(any(opening["id"] == "inferred-entrance-door" for opening in plan["openings"]))
        self.assertTrue(any("门洞" in warning for warning in plan["diagnostics"]["entranceWarnings"]))

    def test_skips_a_bad_room_polygon_when_gpt_accepts_the_floor_plan(self) -> None:
        payload = understanding()
        payload["rooms"][0]["polygon"] = [
            point(130, 500), point(420, 900), point(130, 900), point(420, 500),
        ]
        plan = recognize_floor_plan(self.image, client=FakeClient(payload, approved_review()))
        self.assertEqual([room["label"] for room in plan["rooms"]], ["客厅"])
        self.assertTrue(any("边界异常" in warning for warning in plan["diagnostics"]["semanticWarnings"]))

    def test_requires_server_side_api_key_without_injected_client(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RecognitionError) as context:
                recognize_floor_plan(self.image)
        self.assertEqual(context.exception.code, "floor_plan_ai_unavailable")
        self.assertFalse(context.exception.retryable)

    def test_validates_signature_instead_of_declared_mime(self) -> None:
        output = BytesIO()
        Image.new("RGB", (300, 200), "white").save(output, format="PNG")
        data = output.getvalue()
        with self.assertRaises(RecognitionError) as context:
            validate_and_decode(data, "image/jpeg", len(data))
        self.assertEqual(context.exception.code, "unsupported_file")


if __name__ == "__main__":
    unittest.main()
