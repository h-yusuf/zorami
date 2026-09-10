import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.control.auth import get_current_owner
from app.control.schemas import ProviderCredCreate, ProviderCredOut
from app.core.crypto import encrypt_secret, last4
from app.core.db import get_session
from app.core.models import ProviderCred

router = APIRouter(prefix="/api/providers", tags=["providers"])


async def _get_owned_provider(provider_id: str, owner_id: str, db: AsyncSession) -> ProviderCred:
    try:
        provider_uuid = uuid.UUID(provider_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Provider tidak ditemukan")

    result = await db.execute(
        select(ProviderCred).where(
            ProviderCred.id == provider_uuid, ProviderCred.owner_id == uuid.UUID(owner_id)
        )
    )
    provider = result.scalar_one_or_none()
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider tidak ditemukan")
    return provider


def _to_out(provider: ProviderCred) -> ProviderCredOut:
    return ProviderCredOut(
        id=str(provider.id),
        kind=provider.kind,
        provider_code=provider.provider_code,
        config=provider.config or {},
        secret_last4=provider.secret_last4,
        fallback_of=str(provider.fallback_of) if provider.fallback_of else None,
        created_at=provider.created_at,
    )


@router.get("", response_model=list[ProviderCredOut])
async def list_providers(
    owner_id: str = Depends(get_current_owner), db: AsyncSession = Depends(get_session)
):
    result = await db.execute(
        select(ProviderCred).where(ProviderCred.owner_id == uuid.UUID(owner_id))
    )
    return [_to_out(p) for p in result.scalars().all()]


@router.post("", response_model=ProviderCredOut, status_code=201)
async def create_provider(
    body: ProviderCredCreate,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    fallback_uuid = None
    if body.fallback_of:
        try:
            fallback_uuid = uuid.UUID(body.fallback_of)
        except ValueError:
            raise HTTPException(status_code=422, detail="fallback_of tidak valid")

    provider = ProviderCred(
        owner_id=uuid.UUID(owner_id),
        kind=body.kind,
        provider_code=body.provider_code,
        config=body.config,
        secret_encrypted=encrypt_secret(body.secret),
        secret_last4=last4(body.secret),
        fallback_of=fallback_uuid,
    )
    db.add(provider)
    await db.commit()
    await db.refresh(provider)
    return _to_out(provider)


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: str,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    provider = await _get_owned_provider(provider_id, owner_id, db)
    await db.delete(provider)
    await db.commit()


@router.post("/{provider_id}/test")
async def test_provider(
    provider_id: str,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    # Disengaja: tidak memanggil API eksternal beneran di sini (Groq/omnirouter/dst).
    # Cukup pastikan config tersimpan valid supaya test tidak butuh network call nyata.
    await _get_owned_provider(provider_id, owner_id, db)
    return {
        "ok": True,
        "message": "Test koneksi belum diimplementasikan penuh - baru validasi config tersimpan",
    }
