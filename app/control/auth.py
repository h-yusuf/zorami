from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.models import Owner, User
from app.core.security import create_access_token, decode_access_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer = HTTPBearer()


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    owner_id: str


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email atau password salah")

    owner_result = await db.execute(select(Owner).where(Owner.user_id == user.id))
    owner = owner_result.scalar_one_or_none()
    if owner is None:
        raise HTTPException(status_code=403, detail="User belum punya owner record")

    token = create_access_token(str(user.id))
    return LoginResponse(access_token=token, owner_id=str(owner.id))


async def get_current_owner(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_session),
) -> str:
    """Dependency: returns owner_id string. Gunakan di setiap endpoint REST."""
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Token tidak valid")

    result = await db.execute(select(Owner).where(Owner.user_id == user_id))
    owner = result.scalar_one_or_none()
    if owner is None:
        raise HTTPException(status_code=403, detail="Owner tidak ditemukan")

    return str(owner.id)


@router.get("/me")
async def me(owner_id: str = Depends(get_current_owner)):
    return {"owner_id": owner_id}
