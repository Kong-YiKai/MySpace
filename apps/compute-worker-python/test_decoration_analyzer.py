from __future__ import annotations

import copy
import json
import unittest
from types import SimpleNamespace

import numpy as np

from decoration_analyzer import (
    DecorationAnalysisError,
    analyze_decoration_reference,
)


class FakeResponses:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.requests: list[dict] = []

    def create(self, **kwargs):
        self.requests.append(kwargs)
        return SimpleNamespace(output_text=json.dumps(self.payload, ensure_ascii=False))


class DecorationAnalyzerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.payload = {
            "style": {
                "name": "现代写实奶油风",
                "summary": "暖白墙面、木饰面与自然采光组成的写实住宅空间。",
                "realism": "photorealistic",
                "palette": ["暖白", "浅橡木", "灰褐"],
                "materials": ["哑光乳胶漆", "橡木", "亚麻"],
                "lighting": "大面积窗侧自然光与暖色辅助灯",
                "negativePrompts": ["cartoon", "anime"],
            },
            "layoutSummary": "三人沙发面向茶几，落地灯位于沙发左后方。",
            "objectCandidates": [{
                "objectId": "Main Sofa",
                "label": "三人布艺沙发",
                "category": "seating",
                "importance": "critical",
                "confidence": 0.94,
                "boundingBox": {"x": 0.1, "y": 0.35, "width": 0.52, "height": 0.4},
                "description": "米白色低靠背布艺沙发",
                "materialHints": ["亚麻", "浅色木脚"],
                "colorHints": ["米白"],
                "estimatedSizeMeters": {"width": 2.2, "height": 0.82, "depth": 0.9},
                "placement": {"support": "floor", "roomZone": "客厅中央", "notes": "背靠主墙"},
                "requiresLux3d": False,
                "photorealisticRequired": True,
            }],
            "confidence": 0.91,
            "warnings": [],
        }

    def test_returns_normalized_photorealistic_candidates(self) -> None:
        responses = FakeResponses(self.payload)
        client = SimpleNamespace(responses=responses)
        result = analyze_decoration_reference(
            np.zeros((512, 1024, 3), dtype=np.uint8),
            analysis_id="9f073d6d-ed5b-48df-aa28-4b190c9c602a",
            session_id="67784412-a635-4488-8a54-c981e10af269",
            source_asset_id="asset-reference",
            brief="保持真实比例",
            client=client,
            model="gpt-test",
        )
        self.assertEqual(result["objectCandidates"][0]["objectId"], "main-sofa")
        self.assertTrue(result["objectCandidates"][0]["requiresLux3d"])
        self.assertEqual(result["style"]["realism"], "photorealistic")
        self.assertIn("low-poly", result["style"]["negativePrompts"])
        self.assertEqual(result["diagnostics"]["lux3dCandidateCount"], 1)
        self.assertEqual(result["sourceKind"], "image")
        request = responses.requests[0]
        self.assertEqual(request["text"]["format"]["type"], "json_schema")
        self.assertFalse(request["store"])

    def test_flags_non_photorealistic_reference(self) -> None:
        self.payload["style"]["realism"] = "not-photorealistic"
        result = analyze_decoration_reference(
            np.zeros((512, 1024, 3), dtype=np.uint8),
            analysis_id="9f073d6d-ed5b-48df-aa28-4b190c9c602a",
            session_id="67784412-a635-4488-8a54-c981e10af269",
            source_asset_id="asset-reference",
            client=SimpleNamespace(responses=FakeResponses(self.payload)),
        )
        self.assertTrue(any("写实" in warning for warning in result["warnings"]))

    def test_missing_api_key_is_explicit(self) -> None:
        import os

        previous = os.environ.pop("OPENAI_API_KEY", None)
        try:
            with self.assertRaises(DecorationAnalysisError) as context:
                analyze_decoration_reference(
                    np.zeros((512, 1024, 3), dtype=np.uint8),
                    analysis_id="9f073d6d-ed5b-48df-aa28-4b190c9c602a",
                    session_id="67784412-a635-4488-8a54-c981e10af269",
                    source_asset_id="asset-reference",
                )
            self.assertEqual(context.exception.code, "decoration_analysis_ai_unavailable")
        finally:
            if previous is not None:
                os.environ["OPENAI_API_KEY"] = previous

    def test_supports_text_only_photorealistic_analysis(self) -> None:
        responses = FakeResponses(self.payload)
        result = analyze_decoration_reference(
            None,
            analysis_id="9f073d6d-ed5b-48df-aa28-4b190c9c602a",
            session_id="67784412-a635-4488-8a54-c981e10af269",
            source_asset_id=None,
            brief="写实新中式客厅，胡桃木家具与自然光",
            client=SimpleNamespace(responses=responses),
        )
        self.assertEqual(result["sourceKind"], "text")
        self.assertNotIn("sourceAssetId", result)
        content = responses.requests[0]["input"][0]["content"]
        self.assertEqual([item["type"] for item in content], ["input_text"])

    def test_limits_reference_to_three_focal_objects_and_only_critical_uses_lux3d(self) -> None:
        base = self.payload["objectCandidates"][0]
        self.payload["objectCandidates"] = []
        for index, importance in enumerate(["supporting", "background", "critical", "supporting", "critical"]):
            candidate = copy.deepcopy(base)
            candidate["objectId"] = f"object-{index}"
            candidate["importance"] = importance
            candidate["requiresLux3d"] = True
            self.payload["objectCandidates"].append(candidate)

        result = analyze_decoration_reference(
            np.zeros((512, 1024, 3), dtype=np.uint8),
            analysis_id="9f073d6d-ed5b-48df-aa28-4b190c9c602a",
            session_id="67784412-a635-4488-8a54-c981e10af269",
            source_asset_id="asset-reference",
            client=SimpleNamespace(responses=FakeResponses(self.payload)),
        )

        self.assertEqual(len(result["objectCandidates"]), 3)
        self.assertEqual([item["importance"] for item in result["objectCandidates"]], ["critical", "critical", "supporting"])
        self.assertEqual(sum(item["requiresLux3d"] for item in result["objectCandidates"]), 2)


if __name__ == "__main__":
    unittest.main()
