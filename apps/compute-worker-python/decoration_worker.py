from __future__ import annotations

import asyncio
from contextlib import suppress
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic
from typing import Any
from uuid import uuid4

import boto3
from dotenv import load_dotenv
from nats import errors as nats_errors
from nats.aio.client import Client as NATS
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy
from nats.js.errors import NotFoundError

from decoration_analyzer import (
    DecorationAnalysisError,
    analyze_decoration_reference,
    validate_and_decode_reference_image,
)

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def log(event: str, **fields: Any) -> None:
    print(json.dumps({"time": timestamp(), "event": event, **fields}, ensure_ascii=False), flush=True)


def metadata(source: dict[str, Any], event_type: str) -> dict[str, Any]:
    return {
        "eventId": str(uuid4()),
        "eventType": event_type,
        "version": 1,
        "occurredAt": timestamp(),
        "traceId": source["traceId"],
        "correlationId": source["correlationId"],
        "causationId": source["eventId"],
    }


async def publish(jetstream: Any, event: dict[str, Any]) -> None:
    await jetstream.publish(
        f'{event["eventType"]}.v{event["version"]}',
        json.dumps(event).encode("utf-8"),
        headers={"Nats-Msg-Id": event["eventId"]},
    )


async def process(jetstream: Any, s3: Any, bucket: str, event: dict[str, Any]) -> None:
    payload = event["payload"]
    started = monotonic()
    try:
        decoded = None
        if payload["sourceKind"] == "image":
            await publish(jetstream, {
                **metadata(event, "decoration-analysis.progressed"),
                "payload": {
                    "jobId": payload["jobId"],
                    "status": "validating-file",
                    "progress": 0.18,
                    "message": "正在校验装修参考图的文件签名与像素内容…",
                },
            })
            response = await asyncio.to_thread(s3.get_object, Bucket=bucket, Key=payload["storageKey"])
            data = await asyncio.to_thread(response["Body"].read)
            decoded = validate_and_decode_reference_image(
                data,
                payload["expectedMediaType"],
                payload["expectedSizeBytes"],
            )
        await publish(jetstream, {
            **metadata(event, "decoration-analysis.progressed"),
            "payload": {
                "jobId": payload["jobId"],
                "status": "recognizing",
                "progress": 0.42,
                "message": "AI 正在识别写实风格、PBR 材质与应单独建模的重要物体…",
            },
        })
        analysis = await asyncio.to_thread(
            analyze_decoration_reference,
            decoded.rgb if decoded else None,
            analysis_id=payload["analysisId"],
            session_id=payload["sessionId"],
            source_asset_id=payload.get("assetId"),
            brief=payload.get("brief", ""),
        )
        await publish(jetstream, {
            **metadata(event, "decoration-analysis.completed"),
            "payload": {
                "jobId": payload["jobId"],
                "analysis": analysis,
                **({
                    "checksumSha256": decoded.checksum_sha256,
                    "detectedMediaType": decoded.media_type,
                    "widthPixels": decoded.width,
                    "heightPixels": decoded.height,
                } if decoded else {}),
            },
        })
        log(
            "decoration-analysis.completed",
            jobId=payload["jobId"],
            elapsedSeconds=round(monotonic() - started, 2),
            realism=analysis["style"]["realism"],
            candidateCount=len(analysis["objectCandidates"]),
        )
    except DecorationAnalysisError as error:
        await publish(jetstream, {
            **metadata(event, "decoration-analysis.failed"),
            "payload": {
                "jobId": payload["jobId"],
                **({"assetId": payload["assetId"]} if payload.get("assetId") else {}),
                "errorCode": error.code,
                "errorMessage": str(error),
                "retryable": error.retryable,
            },
        })
        log(
            "decoration-analysis.failed",
            jobId=payload["jobId"],
            elapsedSeconds=round(monotonic() - started, 2),
            errorCode=error.code,
            retryable=error.retryable,
        )
    except Exception as error:
        await publish(jetstream, {
            **metadata(event, "decoration-analysis.failed"),
            "payload": {
                "jobId": payload["jobId"],
                **({"assetId": payload["assetId"]} if payload.get("assetId") else {}),
                "errorCode": "decoration_analysis_failed",
                "errorMessage": "装修方案分析暂时失败，请稍后重试",
                "retryable": True,
            },
        })
        log(
            "decoration-analysis.failed",
            jobId=payload["jobId"],
            elapsedSeconds=round(monotonic() - started, 2),
            errorType=type(error).__name__,
            error=str(error),
        )


async def main() -> None:
    nats = NATS()
    await nats.connect(
        servers=[os.getenv("NATS_URL", "nats://127.0.0.1:4222")],
        name="decoration-analysis-worker",
    )
    jetstream = nats.jetstream()
    try:
        await jetstream.stream_info("MYSPACE_EVENTS")
    except NotFoundError:
        await jetstream.add_stream(
            name="MYSPACE_EVENTS",
            subjects=[
                "generation.*.v1",
                "floor-plan.*.v1",
                "decoration-analysis.*.v1",
                "asset-generation.*.v1",
                "scene.*.v1",
            ],
            max_age=7 * 24 * 60 * 60,
            duplicate_window=2 * 60,
        )
    s3 = boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT", "http://127.0.0.1:9000"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY", "spatial"),
        aws_secret_access_key=os.getenv("S3_SECRET_KEY", "spatial-development-only"),
    )
    bucket = os.getenv("S3_BUCKET", "spatial-assets")
    consumer_config = ConsumerConfig(
        durable_name="decoration-analysis-workers",
        filter_subject="decoration-analysis.requested.v1",
        deliver_policy=DeliverPolicy.ALL,
        ack_policy=AckPolicy.EXPLICIT,
        ack_wait=180,
        max_ack_pending=4,
    )
    await jetstream.add_consumer("MYSPACE_EVENTS", config=consumer_config)
    subscription = await jetstream.pull_subscribe(
        "decoration-analysis.requested.v1",
        durable="decoration-analysis-workers",
        stream="MYSPACE_EVENTS",
        config=consumer_config,
    )
    log(
        "decoration-analysis.worker-ready",
        durable="decoration-analysis-workers",
        model=os.getenv("DECORATION_VISION_MODEL", "gpt-5.5"),
    )

    async def handle(message: Any) -> None:
        heartbeat: asyncio.Task[None] | None = None
        try:
            event = json.loads(message.data)
            if event.get("eventType") != "decoration-analysis.requested" or event.get("version") != 1:
                await message.term()
                return
            log(
                "decoration-analysis.received",
                jobId=event["payload"]["jobId"],
                assetId=event["payload"].get("assetId"),
                sourceKind=event["payload"].get("sourceKind"),
            )

            async def keep_ack_alive() -> None:
                while True:
                    await asyncio.sleep(20)
                    await message.in_progress()

            heartbeat = asyncio.create_task(keep_ack_alive())
            await process(jetstream, s3, bucket, event)
            await message.ack()
        except (json.JSONDecodeError, KeyError, TypeError):
            await message.term()
        except Exception:
            await message.nak(delay=1)
        finally:
            if heartbeat is not None:
                heartbeat.cancel()
                with suppress(asyncio.CancelledError):
                    await heartbeat

    try:
        while True:
            try:
                messages = await subscription.fetch(batch=1, timeout=1)
                for message in messages:
                    await handle(message)
            except asyncio.TimeoutError:
                continue
            except nats_errors.ConnectionClosedError:
                break
    finally:
        if not nats.is_closed:
            with suppress(nats_errors.Error):
                await nats.drain()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("decoration-analysis.worker-stopped")
