import os
import time
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.control.auth import get_current_owner
from app.control.schemas import ProviderCredCreate, ProviderCredOut
from app.core.crypto import decrypt_secret, encrypt_secret, last4
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


async def _test_omnirouter(provider: ProviderCred, secret: str) -> dict:
    base_url = provider.config.get("base_url", "").rstrip("/")
    if not base_url:
        return {"ok": False, "message": "config.base_url belum diisi"}

    start = time.monotonic()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{base_url}/models", headers={"Authorization": f"Bearer {secret}"})
    latency_ms = int((time.monotonic() - start) * 1000)

    if resp.status_code != 200:
        return {"ok": False, "message": f"HTTP {resp.status_code} dari {base_url}/models"}
    count = len(resp.json().get("data", []))
    return {"ok": True, "message": f"{count} model terbaca · {latency_ms}ms"}


async def _test_groq(secret: str) -> dict:
    start = time.monotonic()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            "https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {secret}"}
        )
    latency_ms = int((time.monotonic() - start) * 1000)

    if resp.status_code != 200:
        return {"ok": False, "message": f"HTTP {resp.status_code} dari Groq - cek key"}
    count = len(resp.json().get("data", []))
    return {"ok": True, "message": f"key valid · {count} model terbaca · {latency_ms}ms"}


async def _test_piper(provider: ProviderCred) -> dict:
    from app.adapters.tts.piper import PiperAdapter

    binary_path = provider.config.get("binary_path", "")
    model_path = provider.config.get("model_path", "")
    if not os.path.isfile(binary_path) or not os.access(binary_path, os.X_OK):
        return {"ok": False, "message": f"binary tidak ditemukan/tidak executable: {binary_path}"}
    if not os.path.isfile(model_path):
        return {"ok": False, "message": f"model suara tidak ditemukan: {model_path}"}

    adapter = PiperAdapter(binary_path=binary_path, model_path=model_path)
    result = await adapter.synthesize("tes", voice="")
    if not result.pcm_audio:
        return {"ok": False, "message": "Piper jalan tapi tidak menghasilkan audio"}
    return {
        "ok": True,
        "message": f"audio tersintesis · {len(result.pcm_audio)} bytes @ {result.sample_rate}Hz · {result.latency_ms}ms",
    }


async def _test_langsearch(secret: str) -> dict:
    from app.adapters.search.langsearch import LangSearchAdapter

    adapter = LangSearchAdapter(api_key=secret)
    result = await adapter.search("test", max_results=1)
    return {"ok": True, "message": f"{len(result.results)} hasil terbaca · {result.latency_ms}ms"}


@router.post("/{provider_id}/test")
async def test_provider(
    provider_id: str,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    """Tes beneran ke provider asli - bukan cuma validasi row tersimpan.
    Tiap kombinasi (kind, provider_code) yang belum ada implementasinya jatuh ke
    pesan default (config tersimpan, tapi test asli belum ada buat provider ini)."""
    provider = await _get_owned_provider(provider_id, owner_id, db)
    secret = decrypt_secret(provider.secret_encrypted)

    try:
        if provider.kind == "llm" and provider.provider_code == "omnirouter":
            return await _test_omnirouter(provider, secret)
        if provider.kind == "stt" and provider.provider_code == "groq":
            return await _test_groq(secret)
        if provider.kind == "tts" and provider.provider_code == "piper":
            return await _test_piper(provider)
        if provider.kind == "search" and provider.provider_code == "langsearch":
            return await _test_langsearch(secret)
    except httpx.TimeoutException:
        return {"ok": False, "message": "Timeout menghubungi provider"}
    except httpx.HTTPError as exc:
        return {"ok": False, "message": f"Gagal menghubungi provider: {exc}"}
    except Exception as exc:  # noqa: BLE001 - test-connection wajib tidak pernah 500
        return {"ok": False, "message": f"Gagal: {exc}"}

    return {
        "ok": True,
        "message": f"Tes koneksi belum diimplementasikan untuk {provider.kind}/{provider.provider_code} - config tersimpan valid",
    }
