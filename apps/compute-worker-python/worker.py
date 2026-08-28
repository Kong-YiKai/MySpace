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
from nats import errors as nats_errors
from nats.aio.client import Client as NATS
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy
from nats.js.errors import NotFoundError
from dotenv import load_dotenv

from recognizer import RecognitionError, recognize_floor_plan, validate_and_decode

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
        await publish(jetstream, {
            **metadata(event, "floor-plan.progressed"),
            "payload": {"jobId": payload["jobId"], "status": "validating-file", "progress": 0.16, "message": "正在校验文件签名与解码结果…"},
        })
        response = await asyncio.to_thread(s3.get_object, Bucket=bucket, Key=payload["storageKey"])
        data = await asyncio.to_thread(response["Body"].read)
        decoded = validate_and_decode(data, payload["expectedMediaType"], payload["expectedSizeBytes"])
        await publish(jetstream, {
            **metadata(event, "floor-plan.progressed"),
            "payload": {"jobId": payload["jobId"], "status": "recognizing", "progress": 0.36, "message": "GPT 正在理解房间、墙体、门窗与真实入口…"},
        })
        loop = asyncio.get_running_loop()

        def report_progress(stage: str, progress: float, message: str) -> None:
            future = asyncio.run_coroutine_threadsafe(publish(jetstream, {
                **metadata(event, "floor-plan.progressed"),
                "payload": {
                    "jobId": payload["jobId"],
                    "status": "recognizing",
                    "progress": progress,
                    "message": message,
                },
            }), loop)
            future.result(timeout=10)
            log("floor-plan.progress", jobId=payload["jobId"], stage=stage, progress=progress)

        plan = await asyncio.to_thread(
            recognize_floor_plan,
            decoded.rgb,
            progress_callback=report_progress,
        )
        await publish(jetstream, {
            **metadata(event, "floor-plan.progressed"),
            "payload": {"jobId": payload["jobId"], "status": "normalizing", "progress": 0.82, "message": "正在吸附真实墙线并校验空间拓扑…"},
        })
        await publish(jetstream, {
            **metadata(event, "floor-plan.validated"),
            "payload": {
                "jobId": payload["jobId"],
                "assetId": payload["assetId"],
                "confidence": plan["confidence"],
                "plan": plan,
                "checksumSha256": decoded.checksum_sha256,
                "detectedMediaType": decoded.media_type,
                "widthPixels": decoded.width,
                "heightPixels": decoded.height,
            },
        })
        log(
            "floor-plan.completed",
            jobId=payload["jobId"],
            elapsedSeconds=round(monotonic() - started, 2),
            confidence=plan["confidence"],
        )
    except RecognitionError as error:
        rejection_payload = {
            "jobId": payload["jobId"],
            "assetId": payload["assetId"],
            "errorCode": error.code,
            "errorMessage": str(error),
            "retryable": error.retryable,
        }
        if error.confidence is not None:
            rejection_payload["confidence"] = error.confidence
        await publish(jetstream, {
            **metadata(event, "floor-plan.rejected"),
            "payload": rejection_payload,
        })
        log(
            "floor-plan.rejected",
            jobId=payload["jobId"],
            elapsedSeconds=round(monotonic() - started, 2),
            errorCode=error.code,
            retryable=error.retryable,
        )
    except Exception as error:
        await publish(jetstream, {
            **metadata(event, "floor-plan.rejected"),
            "payload": {
                "jobId": payload["jobId"],
                "assetId": payload["assetId"],
                "errorCode": "floor_plan_recognition_failed",
                "errorMessage": "户型识别服务暂时失败，请稍后重试",
                "retryable": True,
            },
        })
        log(
            "floor-plan.failed",
            jobId=payload["jobId"],
            elapsedSeconds=round(monotonic() - started, 2),
            errorType=type(error).__name__,
            error=str(error),
        )


async def main() -> None:
    nats = NATS()
    await nats.connect(servers=[os.getenv("NATS_URL", "nats://127.0.0.1:4222")], name="floor-plan-worker")
    jetstream = nats.jetstream()
    try:
        await jetstream.stream_info("MYSPACE_EVENTS")
    except NotFoundError:
        await jetstream.add_stream(
            name="MYSPACE_EVENTS",
            subjects=["generation.*.v1", "floor-plan.*.v1", "scene.*.v1"],
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
        durable_name="floor-plan-workers",
        filter_subject="floor-plan.validation-requested.v1",
        deliver_policy=DeliverPolicy.ALL,
        ack_policy=AckPolicy.EXPLICIT,
        ack_wait=180,
        max_ack_pending=8,
    )
    await jetstream.add_consumer("MYSPACE_EVENTS", config=consumer_config)
    subscription = await jetstream.pull_subscribe(
        "floor-plan.validation-requested.v1",
        durable="floor-plan-workers",
        stream="MYSPACE_EVENTS",
        config=consumer_config,
    )
    log("floor-plan.worker-ready", durable="floor-plan-workers", model=os.getenv("FLOOR_PLAN_VISION_MODEL", "gpt-5.6-terra"))

    async def handle(message: Any) -> None:
        heartbeat: asyncio.Task[None] | None = None
        try:
            event = json.loads(message.data)
            if event.get("eventType") != "floor-plan.validation-requested" or event.get("version") != 1:
                await message.term()
                return
            log("floor-plan.received", jobId=event["payload"]["jobId"], assetId=event["payload"]["assetId"])

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
        log("floor-plan.worker-stopped")
