"""Mission lifecycle, history inspection, and CSV/JSON export routes."""
import csv
import io
import json
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import select, desc, func
from app.api.telemetry import get_pipeline
from app.database.models import (
    Mission,
    TelemetryPacket,
    TelemetryGap,
    ConnectionEvent,
    current_time_ms,
)
from app.database.session import AsyncSessionLocal

router = APIRouter(prefix="/api/missions", tags=["missions"])


class CreateMissionRequest(BaseModel):
    name: str
    drone_id: Optional[str] = "VEGAPilot-01"


@router.get("")
async def list_missions() -> List[Dict[str, Any]]:
    """Lists all stored missions with duration and packet count summaries."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Mission).order_by(desc(Mission.created_at)))
        missions = result.scalars().all()

        output = []
        for m in missions:
            # Count packets
            count_res = await session.execute(
                select(func.count(TelemetryPacket.id)).where(TelemetryPacket.mission_id == m.mission_id)
            )
            pkt_count = count_res.scalar() or 0

            output.append({
                "id": m.id,
                "mission_id": m.mission_id,
                "drone_id": m.drone_id,
                "name": m.name,
                "started_at": m.started_at,
                "ended_at": m.ended_at,
                "status": m.status,
                "packet_count": pkt_count,
            })
        return output


@router.post("")
async def create_mission(req: CreateMissionRequest) -> Dict[str, Any]:
    """Creates a new mission and activates it in the telemetry pipeline."""
    now_ms = current_time_ms()
    mission_id = f"MIS-{now_ms}"

    async with AsyncSessionLocal() as session:
        mission = Mission(
            mission_id=mission_id,
            drone_id=req.drone_id or "VEGAPilot-01",
            name=req.name,
            started_at=now_ms,
            status="ACTIVE",
        )
        session.add(mission)
        await session.commit()

    pipeline = get_pipeline()
    if pipeline:
        await pipeline.set_active_mission(mission_id)

    return {
        "mission_id": mission_id,
        "name": req.name,
        "drone_id": req.drone_id,
        "status": "ACTIVE",
        "started_at": now_ms,
    }


@router.post("/{mission_id}/stop")
async def stop_mission(mission_id: str) -> Dict[str, Any]:
    """Marks a mission as COMPLETED."""
    now_ms = current_time_ms()
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(Mission).where(Mission.mission_id == mission_id))
        mission = res.scalar_one_or_none()
        if not mission:
            raise HTTPException(status_code=404, detail="Mission not found")
        mission.status = "COMPLETED"
        mission.ended_at = now_ms
        await session.commit()
    return {"mission_id": mission_id, "status": "COMPLETED", "ended_at": now_ms}


@router.get("/{mission_id}")
async def get_mission(mission_id: str) -> Dict[str, Any]:
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(Mission).where(Mission.mission_id == mission_id))
        mission = res.scalar_one_or_none()
        if not mission:
            raise HTTPException(status_code=404, detail="Mission not found")

        count_res = await session.execute(
            select(func.count(TelemetryPacket.id)).where(TelemetryPacket.mission_id == mission_id)
        )
        pkt_count = count_res.scalar() or 0

        return {
            "id": mission.id,
            "mission_id": mission.mission_id,
            "drone_id": mission.drone_id,
            "name": mission.name,
            "started_at": mission.started_at,
            "ended_at": mission.ended_at,
            "status": mission.status,
            "packet_count": pkt_count,
        }


@router.get("/{mission_id}/telemetry")
async def get_mission_telemetry(
    mission_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    message_type: Optional[str] = None,
    is_valid: Optional[bool] = None,
    is_recovered: Optional[bool] = None,
) -> Dict[str, Any]:
    """Paginated mission telemetry inspection with filters."""
    offset = (page - 1) * page_size

    async with AsyncSessionLocal() as session:
        query = select(TelemetryPacket).where(TelemetryPacket.mission_id == mission_id)

        if message_type:
            query = query.where(TelemetryPacket.message_type == message_type)
        if is_valid is not None:
            query = query.where(TelemetryPacket.is_valid == is_valid)
        if is_recovered is not None:
            query = query.where(TelemetryPacket.is_recovered == is_recovered)

        # Count total matching
        count_q = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_q)).scalar() or 0

        # Query page
        paged_q = query.order_by(desc(TelemetryPacket.received_at)).offset(offset).limit(page_size)
        rows = (await session.execute(paged_q)).scalars().all()

        items = []
        for r in rows:
            items.append({
                "id": r.id,
                "source_sequence": r.source_sequence,
                "receive_sequence": r.receive_sequence,
                "message_type": r.message_type,
                "source_timestamp": r.source_timestamp,
                "received_at": r.received_at,
                "processed_at": r.processed_at,
                "is_duplicate": r.is_duplicate,
                "is_out_of_order": r.is_out_of_order,
                "is_recovered": r.is_recovered,
                "is_valid": r.is_valid,
                "payload": json.loads(r.payload_json) if r.payload_json else {},
            })

        return {
            "mission_id": mission_id,
            "page": page,
            "page_size": page_size,
            "total_items": total,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
            "items": items,
        }


@router.get("/{mission_id}/events")
async def get_mission_events(mission_id: str) -> Dict[str, Any]:
    """Retrieve connection and packet gap events for audit trail."""
    async with AsyncSessionLocal() as session:
        gaps_res = await session.execute(
            select(TelemetryGap).where(TelemetryGap.mission_id == mission_id).order_by(desc(TelemetryGap.detected_at))
        )
        gaps = gaps_res.scalars().all()

        conns_res = await session.execute(
            select(ConnectionEvent).where(ConnectionEvent.mission_id == mission_id).order_by(desc(ConnectionEvent.timestamp))
        )
        conns = conns_res.scalars().all()

        return {
            "mission_id": mission_id,
            "gaps": [
                {
                    "id": g.id,
                    "expected_sequence": g.expected_sequence,
                    "detected_at": g.detected_at,
                    "recovered_at": g.recovered_at,
                    "status": g.status,
                }
                for g in gaps
            ],
            "connection_events": [
                {
                    "id": c.id,
                    "event_type": c.event_type,
                    "timestamp": c.timestamp,
                    "details": c.details,
                }
                for c in conns
            ],
        }


@router.get("/{mission_id}/health")
async def get_mission_health(mission_id: str) -> Dict[str, Any]:
    """Returns reliability health summary computed from the database for the mission."""
    async with AsyncSessionLocal() as session:
        total_packets = (
            await session.execute(
                select(func.count(TelemetryPacket.id)).where(TelemetryPacket.mission_id == mission_id)
            )
        ).scalar() or 0

        duplicates = (
            await session.execute(
                select(func.count(TelemetryPacket.id)).where(
                    TelemetryPacket.mission_id == mission_id,
                    TelemetryPacket.is_duplicate == True,
                )
            )
        ).scalar() or 0

        out_of_order = (
            await session.execute(
                select(func.count(TelemetryPacket.id)).where(
                    TelemetryPacket.mission_id == mission_id,
                    TelemetryPacket.is_out_of_order == True,
                )
            )
        ).scalar() or 0

        invalid = (
            await session.execute(
                select(func.count(TelemetryPacket.id)).where(
                    TelemetryPacket.mission_id == mission_id,
                    TelemetryPacket.is_valid == False,
                )
            )
        ).scalar() or 0

        recovered = (
            await session.execute(
                select(func.count(TelemetryPacket.id)).where(
                    TelemetryPacket.mission_id == mission_id,
                    TelemetryPacket.is_recovered == True,
                )
            )
        ).scalar() or 0

        total_gaps = (
            await session.execute(
                select(func.count(TelemetryGap.id)).where(TelemetryGap.mission_id == mission_id)
            )
        ).scalar() or 0

        return {
            "mission_id": mission_id,
            "total_packets": total_packets,
            "duplicates": duplicates,
            "out_of_order": out_of_order,
            "invalid": invalid,
            "gaps_detected": total_gaps,
            "recovered_packets": recovered,
            "unrecovered_packets": max(0, total_gaps - recovered),
        }


@router.get("/{mission_id}/export/csv")
async def export_mission_csv(mission_id: str) -> Response:
    """Exports all mission telemetry packets into CSV format directly from SQLite."""
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(TelemetryPacket)
            .where(TelemetryPacket.mission_id == mission_id)
            .order_by(TelemetryPacket.received_at)
        )
        packets = res.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "source_sequence", "receive_sequence", "message_type",
        "source_timestamp", "received_at", "processed_at",
        "is_duplicate", "is_out_of_order", "is_recovered", "is_valid", "payload_json"
    ])

    for p in packets:
        writer.writerow([
            p.id, p.source_sequence, p.receive_sequence, p.message_type,
            p.source_timestamp, p.received_at, p.processed_at,
            p.is_duplicate, p.is_out_of_order, p.is_recovered, p.is_valid, p.payload_json
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="mission_{mission_id}.csv"'},
    )


@router.get("/{mission_id}/export/json")
async def export_mission_json(mission_id: str) -> Response:
    """Exports full mission telemetry records into JSON."""
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(TelemetryPacket)
            .where(TelemetryPacket.mission_id == mission_id)
            .order_by(TelemetryPacket.received_at)
        )
        packets = res.scalars().all()

    records = [
        {
            "id": p.id,
            "source_sequence": p.source_sequence,
            "receive_sequence": p.receive_sequence,
            "message_type": p.message_type,
            "source_timestamp": p.source_timestamp,
            "received_at": p.received_at,
            "processed_at": p.processed_at,
            "is_duplicate": p.is_duplicate,
            "is_out_of_order": p.is_out_of_order,
            "is_recovered": p.is_recovered,
            "is_valid": p.is_valid,
            "payload": json.loads(p.payload_json) if p.payload_json else {},
        }
        for p in packets
    ]

    return Response(
        content=json.dumps({"mission_id": mission_id, "packets": records}, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="mission_{mission_id}.json"'},
    )
