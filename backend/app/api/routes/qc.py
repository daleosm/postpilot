"""Tenant-safe QC reports and exception lifecycle endpoints."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import and_, insert, select, update

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import QcIssueCreateRequest, QcIssueUpdateRequest, QcReportCreateRequest
from app.auth import require_permission
from app.db.tables import activity_log, episode_delivery_items, episodes, post_work_orders, qc_issues, qc_reports

router = APIRouter(tags=["qc"])


async def _audit(
    session: DbSession,
    actor: CurrentActor,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    metadata: dict[str, object],
) -> None:
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata=metadata,
        )
    )


async def _episode(session: DbSession, actor: CurrentActor, episode_id: str) -> object:
    episode = (
        await session.execute(
            select(episodes.c.id, episodes.c.editor_id, episodes.c.workflow_stage_id).where(
                and_(episodes.c.id == episode_id, episodes.c.organization_id == actor.organization_id)
            )
        )
    ).first()
    if not episode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found.")
    return episode


@router.post("/qc-reports", status_code=status.HTTP_201_CREATED)
async def create_or_update_qc_report(
    payload: QcReportCreateRequest, response: Response, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_qc")
    episode = await _episode(session, actor, payload.episode_id)
    latest = (
        await session.execute(
            select(qc_reports.c.id, qc_reports.c.status)
            .where(
                and_(
                    qc_reports.c.organization_id == actor.organization_id,
                    qc_reports.c.episode_id == payload.episode_id,
                )
            )
            .order_by(qc_reports.c.created_at.desc(), qc_reports.c.id.desc())
            .limit(1)
        )
    ).first()
    if latest and latest.status in {"passed", "waived"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="QC is already final. No further QC result can be recorded for this episode.",
        )
    if latest and latest.status == "failed" and payload.status not in {"draft", "in_progress", "waived"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Start a new re-QC run before recording another QC decision.",
        )
    if payload.status == "passed":
        open_issue = (
            await session.execute(
                select(qc_issues.c.id)
                .join(qc_reports, qc_reports.c.id == qc_issues.c.qc_report_id)
                .where(
                    and_(
                        qc_issues.c.organization_id == actor.organization_id,
                        qc_reports.c.organization_id == actor.organization_id,
                        qc_reports.c.episode_id == payload.episode_id,
                        qc_issues.c.status == "open",
                    )
                )
                .limit(1)
            )
        ).first()
        open_correction = (
            await session.execute(
                select(post_work_orders.c.id)
                .where(
                    and_(
                        post_work_orders.c.organization_id == actor.organization_id,
                        post_work_orders.c.episode_id == payload.episode_id,
                        post_work_orders.c.kind == "qc_exception",
                        post_work_orders.c.status.not_in(("complete", "cancelled")),
                    )
                )
                .limit(1)
            )
        ).first()
        if open_issue or open_correction:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Resolve or waive every open QC issue and correction work order "
                    "before recording a passed re-QC result."
                ),
            )
    now = datetime.now(UTC)
    qc_status = {
        "passed": "passed",
        "waived": "waived",
        "failed": "needs_attention",
    }.get(payload.status, "in_progress")
    report_values = {
        "status": payload.status,
        "report_url": payload.report_url,
        "checksum": payload.checksum,
        "summary": payload.summary,
        "waiver_reason": payload.waiver_reason,
        "waived_by_person_id": actor.person_id if payload.status == "waived" else None,
        "completed_at": now if payload.status in {"passed", "failed", "waived"} else None,
        "updated_at": now,
    }
    active_run = latest if latest and latest.status in {"draft", "in_progress"} else None
    if active_run:
        response.status_code = status.HTTP_200_OK
        report_id = (
            await session.execute(
                update(qc_reports)
                .where(and_(qc_reports.c.id == active_run.id, qc_reports.c.organization_id == actor.organization_id))
                .values(**report_values)
                .returning(qc_reports.c.id)
            )
        ).scalar_one()
    else:
        report_id = (
            await session.execute(
                insert(qc_reports)
                .values(organization_id=actor.organization_id, episode_id=payload.episode_id, **report_values)
                .returning(qc_reports.c.id)
            )
        ).scalar_one()
    if payload.status == "failed":
        await session.execute(
            insert(post_work_orders).values(
                organization_id=actor.organization_id,
                episode_id=payload.episode_id,
                workflow_stage_id=episode.workflow_stage_id,
                kind="qc_exception",
                status="in_progress",
                title="QC failure — assign and resolve corrections",
                description=payload.summary
                or "A QC report has failed. Review the report and log each correction before re-QC.",
                assignee_person_id=episode.editor_id,
                is_blocking=True,
                external_url=payload.report_url,
                created_by_user_id=actor.user_id,
            )
        )
    await session.execute(
        update(episodes)
        .where(and_(episodes.c.id == payload.episode_id, episodes.c.organization_id == actor.organization_id))
        .values(qc_status=qc_status, updated_at=now)
    )
    reconciled_delivery_qc_items = 0
    reset_non_qc_delivery_items = 0
    if payload.status == "passed":
        # A formal passed re-QC replaces the failed QC outcome for the
        # corrected delivery package.  Delivery still needs to be dispatched
        # and received separately; this only removes the stale QC failure.
        reconciled = await session.execute(
            update(episode_delivery_items)
            .where(
                and_(
                    episode_delivery_items.c.organization_id == actor.organization_id,
                    episode_delivery_items.c.episode_id == payload.episode_id,
                    episode_delivery_items.c.qc_required.is_(True),
                    episode_delivery_items.c.status == "qc_failed",
                )
            )
            .values(status="qc_passed", qc_result="passed", updated_at=now)
        )
        reconciled_delivery_qc_items = reconciled.rowcount or 0
        # A non-QC manifest item cannot meaningfully remain in a `qc_failed`
        # state.  Return it to preparation instead of incorrectly treating it
        # as passed by the facility QC report.
        reset = await session.execute(
            update(episode_delivery_items)
            .where(
                and_(
                    episode_delivery_items.c.organization_id == actor.organization_id,
                    episode_delivery_items.c.episode_id == payload.episode_id,
                    episode_delivery_items.c.qc_required.is_(False),
                    episode_delivery_items.c.status == "qc_failed",
                )
            )
            .values(status="preparing", qc_result="not_required", updated_at=now)
        )
        reset_non_qc_delivery_items = reset.rowcount or 0
    await _audit(
        session,
        actor,
        action=f"qc.{payload.status}",
        entity_type="qc_report",
        entity_id=str(report_id),
        metadata={
            "episodeId": payload.episode_id,
            "reconciledDeliveryQcItems": reconciled_delivery_qc_items,
            "resetNonQcDeliveryItems": reset_non_qc_delivery_items,
        },
    )
    await session.commit()
    return {"id": str(report_id), "status": payload.status, "qc_status": qc_status, "updated": bool(active_run)}


@router.post("/qc-issues", status_code=status.HTTP_201_CREATED)
async def create_qc_issue(payload: QcIssueCreateRequest, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_qc")
    report = (
        await session.execute(
            select(qc_reports.c.id, qc_reports.c.episode_id, episodes.c.editor_id, episodes.c.workflow_stage_id)
            .join(episodes, episodes.c.id == qc_reports.c.episode_id)
            .where(
                and_(
                    qc_reports.c.id == payload.qc_report_id,
                    qc_reports.c.organization_id == actor.organization_id,
                    episodes.c.organization_id == actor.organization_id,
                )
            )
        )
    ).first()
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC report not found.")
    issue_id = (
        await session.execute(
            insert(qc_issues)
            .values(
                organization_id=actor.organization_id,
                qc_report_id=payload.qc_report_id,
                code=payload.code,
                severity=payload.severity,
                description=payload.description.strip(),
                timecode_seconds=payload.timecode_seconds,
                status="open",
            )
            .returning(qc_issues.c.id)
        )
    ).scalar_one()
    await session.execute(
        insert(post_work_orders).values(
            organization_id=actor.organization_id,
            episode_id=report.episode_id,
            workflow_stage_id=report.workflow_stage_id,
            qc_issue_id=issue_id,
            kind="qc_exception",
            status="in_progress",
            title=f"QC {payload.severity} — {payload.code or 'correction required'}",
            description=payload.description.strip(),
            assignee_person_id=report.editor_id,
            is_blocking=True,
            created_by_user_id=actor.user_id,
        )
    )
    await _audit(
        session,
        actor,
        action="qc.issue_created",
        entity_type="qc_issue",
        entity_id=str(issue_id),
        metadata={
            "episodeId": str(report.episode_id),
            "qcReportId": payload.qc_report_id,
            "severity": payload.severity,
        },
    )
    await session.commit()
    return {
        "id": str(issue_id),
        "qc_report_id": payload.qc_report_id,
        "status": "open",
        "code": payload.code,
        "severity": payload.severity,
        "description": payload.description.strip(),
    }


@router.patch("/qc-issues/{issue_id}")
async def update_qc_issue(
    issue_id: str, payload: QcIssueUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_qc")
    issue = (
        await session.execute(
            select(qc_issues.c.id, qc_issues.c.qc_report_id, qc_reports.c.episode_id)
            .join(qc_reports, qc_reports.c.id == qc_issues.c.qc_report_id)
            .where(
                and_(
                    qc_issues.c.id == issue_id,
                    qc_issues.c.organization_id == actor.organization_id,
                    qc_reports.c.organization_id == actor.organization_id,
                )
            )
        )
    ).first()
    if not issue:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC issue not found.")
    now = datetime.now(UTC)
    resolution = payload.resolution.strip() if payload.resolution else None
    result = await session.execute(
        update(qc_issues)
        .where(and_(qc_issues.c.id == issue_id, qc_issues.c.organization_id == actor.organization_id))
        .values(
            status=payload.status,
            resolution=resolution,
            resolved_at=None if payload.status == "open" else now,
            updated_at=now,
        )
        .returning(qc_issues.c.id, qc_issues.c.status, qc_issues.c.resolution, qc_issues.c.resolved_at)
    )
    updated = result.one()
    order_values: dict[str, object]
    if payload.status == "resolved":
        order_values = {
            "status": "complete",
            "completed_by_person_id": actor.person_id,
            "completed_at": now,
            "updated_at": now,
        }
    elif payload.status == "waived":
        order_values = {"status": "cancelled", "completed_at": now, "updated_at": now}
    else:
        order_values = {"status": "open", "completed_by_person_id": None, "completed_at": None, "updated_at": now}
    await session.execute(
        update(post_work_orders)
        .where(
            and_(
                post_work_orders.c.organization_id == actor.organization_id, post_work_orders.c.qc_issue_id == issue_id
            )
        )
        .values(**order_values)
    )
    await _audit(
        session,
        actor,
        action=f"qc.issue_{payload.status}",
        entity_type="qc_issue",
        entity_id=issue_id,
        metadata={"episodeId": str(issue.episode_id), "qcReportId": str(issue.qc_report_id)},
    )
    await session.commit()
    return {
        "id": str(updated.id),
        "status": updated.status,
        "resolution": updated.resolution,
        "resolved_at": updated.resolved_at,
    }
