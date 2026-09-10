from sqlalchemy.ext.asyncio import AsyncSession


class TenantSession:
    """Wrapper AsyncSession yang otomatis memfilter by owner_id.

    Lapisan pertahanan kedua terhadap kebocoran lintas tenant (spec §8) - repository
    di control/ tetap wajib memfilter owner_id di query-nya sendiri, ini cuma jaring
    pengaman kalau ada yang lupa."""

    def __init__(self, session: AsyncSession, owner_id: str):
        self._session = session
        self.owner_id = owner_id

    async def get(self, model, ident):
        obj = await self._session.get(model, ident)
        if obj is not None and getattr(obj, "owner_id", None) != self.owner_id:
            return None
        return obj

    async def execute(self, stmt):
        return await self._session.execute(stmt)

    @property
    def session(self) -> AsyncSession:
        return self._session
