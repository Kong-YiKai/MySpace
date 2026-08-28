from __future__ import annotations

from io import BytesIO
import json
from urllib.request import Request, urlopen

import cv2
import numpy as np
from PIL import Image

API = "http://127.0.0.1:3000"


def json_request(path: str, payload: dict | None = None, headers: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        f"{API}{path}",
        data=data,
        method="GET" if payload is None else "POST",
        headers={"content-type": "application/json", **(headers or {})},
    )
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def follow(job_id: str, terminal_events: set[str]) -> dict:
    request = Request(f"{API}/v1/jobs/{job_id}/events", headers={"accept": "text/event-stream"})
    event_type = ""
    with urlopen(request, timeout=30) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8").strip()
            if line.startswith("event:"):
                event_type = line.removeprefix("event:").strip()
            elif line.startswith("data:"):
                payload = json.loads(line.removeprefix("data:").strip())
                if event_type in terminal_events:
                    return payload
                if event_type == "snapshot" and payload["job"]["status"] in {"complete", "failed"}:
                    return payload
    raise RuntimeError(f"SSE stream for {job_id} ended without a terminal event")


def sample_floor_plan() -> bytes:
    image = np.full((600, 800, 3), 255, dtype=np.uint8)
    cv2.rectangle(image, (80, 70), (720, 530), (0, 0, 0), 16)
    cv2.line(image, (400, 70), (400, 360), (0, 0, 0), 14)
    cv2.line(image, (400, 360), (720, 360), (0, 0, 0), 14)
    output = BytesIO()
    Image.fromarray(image).save(output, format="PNG")
    return output.getvalue()


def main() -> None:
    image = sample_floor_plan()
    intent = json_request("/v1/assets/upload-intents", {
        "kind": "floor-plan",
        "fileName": "smoke-plan.png",
        "mediaType": "image/png",
        "sizeBytes": len(image),
    })
    upload = Request(intent["uploadUrl"], data=image, method="PUT", headers=intent["headers"])
    with urlopen(upload, timeout=20) as response:
        assert response.status == 200

    validation = json_request("/v1/floor-plans/validate", {"assetId": intent["assetId"]})
    validated = follow(validation["jobId"], {"floor-plan.validated", "floor-plan.rejected"})
    if validated.get("eventType") == "floor-plan.rejected":
        raise RuntimeError(validated["payload"]["errorMessage"])

    session = json_request("/v1/housing-sessions", {
        "source": {"kind": "uploaded-plan", "assetId": intent["assetId"]},
    })
    generated = follow(session["shellJobId"], {"generation.completed", "generation.failed"})
    if generated.get("eventType") == "generation.failed":
        raise RuntimeError(generated["payload"]["errorMessage"])
    restored = json_request(f'/v1/housing-sessions/{session["sessionId"]}')
    assert restored["status"] == "shell-ready"
    assert restored["manifest"]["metadata"]["kind"] == "housing-shell"
    assert len(restored["manifest"]["entities"]) >= 5

    decoration = json_request(
        f'/v1/housing-sessions/{session["sessionId"]}/decorations',
        {"brief": "现代奶油风，加入舒适沙发和绿植。", "wallpaper": "cream-white"},
        {"idempotency-key": f"smoke-decoration-{session['sessionId']}"},
    )
    decorated = follow(decoration["jobId"], {"generation.completed", "generation.failed"})
    if decorated.get("eventType") == "generation.failed":
        raise RuntimeError(decorated["payload"]["errorMessage"])

    print(json.dumps({
        "assetId": intent["assetId"],
        "validationJobId": validation["jobId"],
        "sessionId": session["sessionId"],
        "sceneId": restored["sceneId"],
        "entityCount": len(restored["manifest"]["entities"]),
        "decorationJobId": decoration["jobId"],
        "status": "iteration-2-closed-loop-ok",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
