import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.control.auth import get_current_owner
from app.control.schemas import AgentCreate, AgentOut, AgentUpdate
from app.core.db import get_session
from app.core.models import Agent

router = APIRouter(prefix="/api/agents", tags=["agents"])


async def _get_owned_agent(agent_id: str, owner_id: str, db: AsyncSession) -> Agent:
    try:
        agent_uuid = uuid.UUID(agent_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Agent tidak ditemukan")

    result = await db.execute(
        select(Agent).where(Agent.id == agent_uuid, Agent.owner_id == uuid.UUID(owner_id))
    )
    agent = result.scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent tidak ditemukan")
    return agent


def _to_out(agent: Agent) -> AgentOut:
    return AgentOut(
        id=str(agent.id),
        name=agent.name,
        system_prompt=agent.system_prompt,
        llm_model=agent.llm_model,
        temperature=agent.temperature,
        max_tokens=agent.max_tokens,
        tts_provider=agent.tts_provider,
        tts_voice=agent.tts_voice,
        emotion_level=agent.emotion_level,
        tools_enabled=agent.tools_enabled or [],
        memory_enabled=agent.memory_enabled,
        chat_log_level=agent.chat_log_level,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


@router.get("", response_model=list[AgentOut])
async def list_agents(
    owner_id: str = Depends(get_current_owner), db: AsyncSession = Depends(get_session)
):
    result = await db.execute(select(Agent).where(Agent.owner_id == uuid.UUID(owner_id)))
    return [_to_out(a) for a in result.scalars().all()]


@router.post("", response_model=AgentOut, status_code=201)
async def create_agent(
    body: AgentCreate,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    agent = Agent(owner_id=uuid.UUID(owner_id), **body.model_dump())
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return _to_out(agent)


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(
    agent_id: str,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    agent = await _get_owned_agent(agent_id, owner_id, db)
    return _to_out(agent)


@router.put("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: str,
    body: AgentUpdate,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    agent = await _get_owned_agent(agent_id, owner_id, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(agent, field, value)
    await db.commit()
    await db.refresh(agent)
    return _to_out(agent)


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: str,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    agent = await _get_owned_agent(agent_id, owner_id, db)
    await db.delete(agent)
    await db.commit()
